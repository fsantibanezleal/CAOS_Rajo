"""Stage masks: one mining-land mask per baked frame and method, on the site's 30 m grid.

Reads the chip cache written by the frames stage (six packed reflectance bands, data, QA-clear, snow)
and the reference polygons, and writes for every year:

- ``otsu``  M4, the bare-ground mask (Otsu on BSI, NDVI below 0.2, MNDWI below 0), every sensor;
- ``rf``    M7, the random forest on the sixteen features, every sensor. Landsat frames are outside the
            training domain (30 m, another sensor), so those years carry the flag ``cross_sensor``;
- ``unet``  M8, the U-Net on the 10 m Sentinel-2 chip (2017 onwards only; it is not run on Landsat).

Every mask is scored inside the site ENVELOPE, the reference polygons dilated by one kilometre, and
the area inside the envelope is what the series stage turns into the mined-area series. The envelope
is stated in the output; a mask over the whole window would measure the desert, not the mine.

Outputs: ``sites/<id>/masks/<year>-<method>.png`` (1-bit, 30 m grid) and ``sites/<id>/masks.json``.
Resumable per site-year-method. The learned methods need the exported models under RAJO_MODELS_ROOT;
when a model file is absent the method is skipped and the reason recorded.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from rasterio.features import rasterize
from scipy import ndimage
from shapely.geometry import shape
from shapely.ops import transform as shp_transform

from ..manifest import read_json, write_json
from ..paths import data_root, models_root
from ..raster import Grid, encode_png_mask, unpack_reflectance
from .frames import LANDSAT_FACTOR, _grid_of

TRAIN_DIR = Path(__file__).resolve().parents[2] / "train"
if str(TRAIN_DIR) not in sys.path:
    sys.path.insert(0, str(TRAIN_DIR))

from baselines import otsu_mask  # noqa: E402
from common import clean_mask, rf_features  # noqa: E402

ENVELOPE_M = 1000.0
METHODS = ("otsu", "rf", "unet")
S2_START = 2017


def _envelope(site_dir: Path, grid30: Grid) -> np.ndarray:
    """The reference polygons rasterised on the 30 m grid and dilated by ENVELOPE_M."""
    from pyproj import CRS, Transformer

    fc = read_json(site_dir / "polygons.geojson")
    fwd = Transformer.from_crs(CRS.from_epsg(4326), CRS.from_epsg(grid30.epsg), always_xy=True).transform
    geoms = [shp_transform(fwd, shape(f["geometry"])) for f in fc.get("features", [])]
    if not geoms:
        return np.ones((grid30.height, grid30.width), dtype=bool)
    ras = rasterize([(g, 1) for g in geoms], out_shape=(grid30.height, grid30.width), transform=grid30.transform, fill=0, dtype="uint8")
    r = int(round(ENVELOPE_M / grid30.pixel_m))
    yy, xx = np.ogrid[-r:r + 1, -r:r + 1]
    disk = (xx * xx + yy * yy) <= r * r
    return ndimage.binary_dilation(ras.astype(bool), structure=disk)


def _to_30m(bands: np.ndarray, valid: np.ndarray, factor: int) -> tuple[np.ndarray, np.ndarray]:
    """Mean-pool a 10 m chip to 30 m over valid pixels; a 30 m pixel is valid when any 10 m pixel was."""
    c, h, w = bands.shape
    h2, w2 = h // factor, w // factor
    b = bands[:, : h2 * factor, : w2 * factor].reshape(c, h2, factor, w2, factor)
    v = valid[: h2 * factor, : w2 * factor].reshape(h2, factor, w2, factor).astype(np.float32)
    cnt = v.sum(axis=(1, 3))
    out = (b * v[None]).sum(axis=(2, 4)) / np.maximum(cnt, 1)[None]
    return out.astype(np.float32), cnt > 0


class Models:
    def __init__(self, root: Path, log):
        import onnxruntime as ort

        self.rf = self.unet = None
        self.why: dict[str, str] = {}
        reg = root / "registry.json"
        if not reg.exists():
            self.why["rf"] = self.why["unet"] = f"no model registry at {reg}"
            return
        entries = {m["method"]: m for m in read_json(reg)["models"]}
        for method, key in (("M7", "rf"), ("M8", "unet")):
            e = entries.get(method)
            if e is None or not (root / e["file"]).exists():
                self.why[key] = f"no {method} model in the registry"
                continue
            sess = ort.InferenceSession(str(root / e["file"]), providers=["CPUExecutionProvider"])
            setattr(self, key, (sess, e))
            log(f"  model {e['id']} loaded ({e['bytes'] / 1e6:.1f} MB)")

    def rf_prob(self, bands: np.ndarray) -> np.ndarray:
        sess, _ = self.rf
        feats = rf_features(bands)
        x = feats.reshape(feats.shape[0], -1).T.astype(np.float32)
        name = sess.get_inputs()[0].name
        out = []
        for i in range(0, len(x), 262144):
            probs = sess.run(None, {name: x[i:i + 262144]})[-1]
            out.append(probs[:, 1] if probs.ndim == 2 else probs)
        return np.concatenate(out).reshape(bands.shape[1:]).astype(np.float32)

    def unet_prob(self, bands: np.ndarray, window: int = 512, overlap: int = 64) -> np.ndarray:
        sess, _ = self.unet
        x = np.clip(bands, 0.0, 0.6) / 0.6
        _, h, w = x.shape
        prob = np.zeros((h, w), dtype=np.float32)
        weight = np.zeros((h, w), dtype=np.float32)
        ramp = np.ones(window, dtype=np.float32)
        r = 0.5 * (1.0 - np.cos(np.linspace(0, np.pi, overlap, dtype=np.float32)))
        ramp[:overlap] = r
        ramp[-overlap:] = r[::-1]
        w2d = ramp[:, None] * ramp[None, :]
        step = window - overlap
        ys = list(range(0, max(1, h - window + 1), step))
        xs = list(range(0, max(1, w - window + 1), step))
        if ys[-1] + window < h:
            ys.append(max(0, h - window))
        if xs[-1] + window < w:
            xs.append(max(0, w - window))
        name = sess.get_inputs()[0].name
        for y0 in ys:
            for x0 in xs:
                patch = x[:, y0:y0 + window, x0:x0 + window]
                ph, pw = patch.shape[1], patch.shape[2]
                if ph < window or pw < window:
                    patch = np.pad(patch, ((0, 0), (0, window - ph), (0, window - pw)), mode="reflect")
                logits = sess.run(None, {name: patch[None].astype(np.float32)})[0][0, 0, :ph, :pw]
                p = 1.0 / (1.0 + np.exp(-logits))
                prob[y0:y0 + ph, x0:x0 + pw] += p * w2d[:ph, :pw]
                weight[y0:y0 + ph, x0:x0 + pw] += w2d[:ph, :pw]
        return prob / np.maximum(weight, 1e-6)


def run_stage(ctx) -> None:
    root = data_root(ctx.repo_root)
    models = Models(models_root(ctx.repo_root), ctx.log)
    for key, why in models.why.items():
        ctx.log(f"  {key}: skipped ({why})")
    for d in sorted(p for p in ctx.sites_dir.iterdir() if p.is_dir()):
        if ctx.sites and d.name not in ctx.sites:
            continue
        frames_path = d / "frames.json"
        if not frames_path.exists():
            ctx.log(f"{d.name}: no frames.json, skipped")
            continue
        site_doc = read_json(d / "site.json")
        frames_doc = read_json(frames_path)
        grid10 = _grid_of(site_doc)
        grid30 = grid10.coarse(LANDSAT_FACTOR)
        envelope = _envelope(d, grid30)
        env_px = int(envelope.sum())
        env_km2 = env_px * grid30.pixel_m * grid30.pixel_m / 1e6
        out_path = d / "masks.json"
        doc = read_json(out_path) if (ctx.resume and out_path.exists()) else {"site_id": d.name, "years": {}}
        doc["envelope"] = f"reference polygons dilated by {ENVELOPE_M:.0f} m on the {grid30.pixel_m:.0f} m grid"
        doc["envelope_km2"] = round(env_km2, 4)
        doc["grid_m"] = grid30.pixel_m
        doc["methods"] = {
            "otsu": {"label": "Otsu bare-ground (M4)", "domain": "all sensors"},
            "rf": {"label": "Random forest (M7)", "domain": "all sensors; Landsat years flagged cross_sensor",
                   "model": models.rf[1]["id"] if models.rf else None, "skipped": models.why.get("rf")},
            "unet": {"label": "U-Net (M8)", "domain": "Sentinel-2 years only",
                     "model": models.unet[1]["id"] if models.unet else None, "skipped": models.why.get("unet")},
        }
        masks_dir = d / "masks"
        for fr in sorted(frames_doc["frames"], key=lambda f: f["year"]):
            year = int(fr["year"])
            if not ctx.wants_year(year):
                continue
            rec = doc["years"].get(str(year), {})
            wanted = [m for m in METHODS if m not in rec and (m == "otsu" or (m == "rf" and models.rf) or (m == "unet" and models.unet and fr["collection"] == "sentinel-2-l2a"))]
            if not wanted:
                continue
            chip = root / "chips" / d.name / f"{d.name}_{year}.npz"
            if not chip.exists():
                ctx.log(f"{d.name} {year}: chip missing ({chip.name}); frames must be baked on this machine")
                rec.setdefault("skipped", {})
                for m in wanted:
                    rec["skipped"][m] = "chip cache missing"
                doc["years"][str(year)] = rec
                continue
            z = np.load(chip)
            bands = unpack_reflectance(z["bands"])
            valid = (z["data"] > 0) & (z["clear"] > 0)
            is_s2 = fr["collection"] == "sentinel-2-l2a"
            if is_s2:
                b30, v30 = _to_30m(bands, valid, LANDSAT_FACTOR)
            else:
                b30, v30 = bands, valid
            if b30.shape[1:] != (grid30.height, grid30.width):
                ctx.log(f"{d.name} {year}: chip is {b30.shape[1:]}, grid is {(grid30.height, grid30.width)}; skipped")
                continue
            env_valid = float((v30 & envelope).sum() / max(1, env_px))
            masks_dir.mkdir(parents=True, exist_ok=True)
            for m in wanted:
                if m == "otsu":
                    mask, thr = otsu_mask(b30, v30)
                    extra = {"threshold": round(thr, 4)}
                    flags: list[str] = []
                elif m == "rf":
                    thr = float(models.rf[1].get("threshold", 0.5))  # chosen on validation by evaluate.py
                    prob = models.rf_prob(b30)
                    prob[~v30] = np.nan
                    mask = clean_mask(prob, thr)
                    extra = {"threshold": thr, "model": models.rf[1]["id"]}
                    flags = [] if is_s2 else ["cross_sensor"]
                else:
                    thr = float(models.unet[1].get("threshold", 0.5))
                    prob10 = models.unet_prob(bands)
                    prob10[~valid] = np.nan
                    # score on the 30 m grid like the others: mean probability per 30 m cell
                    p30, _ = _to_30m(prob10[None].astype(np.float32), valid, LANDSAT_FACTOR)
                    mask = clean_mask(p30[0], thr)
                    extra = {"threshold": thr, "model": models.unet[1]["id"]}
                    flags = []
                inside = mask & envelope
                area = float(inside.sum()) * grid30.pixel_m * grid30.pixel_m / 1e6
                fname = f"masks/{year}-{m}.png"
                (d / fname).write_bytes(encode_png_mask(mask))
                rec[m] = {"file": fname, "area_km2": round(area, 4), "window_area_km2": round(float(mask.sum()) * grid30.pixel_m ** 2 / 1e6, 4),
                          "envelope_valid_frac": round(env_valid, 4), "flags": flags, **extra}
                ctx.log(f"{d.name} {year} {m}: {area:.2f} km2 in the envelope (valid {env_valid:.2f}){' ' + ' '.join(flags) if flags else ''}")
            rec["sensor"] = fr["sensor"]
            rec["envelope_valid_frac"] = round(env_valid, 4)
            doc["years"][str(year)] = rec
            write_json(out_path, doc)
        write_json(out_path, doc)
        ctx.log(f"{d.name}: masks for {len(doc['years'])} years -> {out_path.name}")
