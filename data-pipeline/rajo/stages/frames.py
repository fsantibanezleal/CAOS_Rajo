"""Stage frames: one frame per site-year from the ranked candidates.

For each year the candidates are tried in order: the item group is read onto the site grid (six channels
plus the mask band), the cloud-free fraction INSIDE the window is measured, and the first candidate with a
valid fraction at or above VALID_TARGET is taken. A Landsat 7 acquisition after the scan-line corrector
failure (2003-05-31) leaves stripes of no data; those are filled by compositing the next Landsat 7
candidates of the same season, and the frame is flagged ``composite`` with every scene id recorded. If no
candidate reaches the target, the best one is kept and flagged ``low_valid``. A year with no usable
candidate at all is recorded as a gap with its reason, never silently skipped.

Outputs per site: the chip cache (6-band uint16 reflectance x 10000, the validity and snow masks) under the
data root, and under <output>/sites/<id>/: frames/<year>.webp (true colour, 1024 px), frames/<year>-swir.webp
(SWIR2, NIR, red composite, 512 px) and frames.json. Resumable per site-year.
"""
from __future__ import annotations

import datetime as dt
from pathlib import Path

import numpy as np
import planetary_computer
from rasterio.enums import Resampling

from ..manifest import read_json, write_json
from ..raster import (
    CHANNELS,
    Grid,
    encode_webp,
    landsat_validity,
    mosaic_into,
    pack_reflectance,
    read_onto_grid,
    s2_validity,
    stretch_rgb,
    to_reflectance,
)

VALID_TARGET = 0.97
TC_SIZE = 1024
SWIR_SIZE = 512
SLC_OFF_DATE = "2003-05-31"
LANDSAT_FACTOR = 3  # 30 m on the 10 m site grid

S2_DEFAULT = (0.0001, -0.1)
LANDSAT_DEFAULT = (0.0000275, -0.2)


def _grid_of(site_doc: dict) -> Grid:
    w = site_doc["window"]
    return Grid(epsg=int(w["epsg"]), left=float(w["left"]), top=float(w["top"]), pixel_m=float(w["pixel_m"]),
                width=int(w["width"]), height=int(w["height"]))


def _read_group(cand: dict, grid: Grid, sensor_kind: str, log) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Reads a same-day item group onto the grid. Returns (bands[6,H,W] float32 reflectance, valid, snow)."""
    h, w = grid.height, grid.width
    bands = np.zeros((6, h, w), dtype=np.float32)
    valid = np.zeros((h, w), dtype=bool)
    snow = np.zeros((h, w), dtype=bool)
    defaults = S2_DEFAULT if sensor_kind == "s2" else LANDSAT_DEFAULT
    for item in cand["items"]:
        assets = item["assets"]
        if sensor_kind == "s2":
            mask_dn = read_onto_grid(assets["scl"]["href"], grid, Resampling.nearest, "uint8")
            iv, isnow = s2_validity(mask_dn)
        else:
            href = planetary_computer.sign(assets["qa"]["href"])
            mask_dn = read_onto_grid(href, grid, Resampling.nearest, "uint16")
            iv, isnow = landsat_validity(mask_dn)
        item_bands = np.zeros((6, h, w), dtype=np.float32)
        for k, ch in enumerate(CHANNELS):
            a = assets[ch]
            href = a["href"] if sensor_kind == "s2" else planetary_computer.sign(a["href"])
            dn = read_onto_grid(href, grid, Resampling.bilinear, "float32")
            refl = to_reflectance(dn, a.get("scale"), a.get("offset"), *defaults)
            iv &= dn > 0  # DN 0 is no data in both archives
            item_bands[k] = refl
        iv &= np.isfinite(item_bands).all(axis=0)
        mosaic_into(bands, valid, item_bands, iv)
        snow |= isnow & iv
        log(f"    read {item['id']}: valid {iv.mean():.3f}")
    return bands, valid, snow


def _composite_l7(cands: list[dict], first: int, grid: Grid, log) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[str]]:
    bands, valid, snow = _read_group(cands[first], grid, "landsat", log)
    ids = [cands[first]["id"] if "id" in cands[first] else "+".join(i["id"] for i in cands[first]["items"])]
    for c in cands[first + 1:]:
        if valid.mean() >= VALID_TARGET:
            break
        if c["sensor"] != "landsat-7":
            continue
        b2, v2, s2 = _read_group(c, grid, "landsat", log)
        mosaic_into(bands, valid, b2, v2)
        snow |= s2 & v2
        ids.append("+".join(i["id"] for i in c["items"]))
    return bands, valid, snow, ids


def _save_chip(cache_dir: Path, site_id: str, year: int, bands: np.ndarray, valid: np.ndarray, snow: np.ndarray,
               meta: dict) -> Path:
    cache_dir.mkdir(parents=True, exist_ok=True)
    p = cache_dir / f"{site_id}_{year}.npz"
    np.savez_compressed(p, bands=pack_reflectance(bands), valid=valid.astype(np.uint8), snow=snow.astype(np.uint8),
                        meta=np.array([str(meta)], dtype=object))
    return p


def _render(bands: np.ndarray, valid: np.ndarray, frames_dir: Path, year: int) -> tuple[dict, dict]:
    frames_dir.mkdir(parents=True, exist_ok=True)
    tc, tc_clips = stretch_rgb(bands[[2, 1, 0]], valid)  # red, green, blue
    (frames_dir / f"{year}.webp").write_bytes(encode_webp(tc, TC_SIZE))
    sw, sw_clips = stretch_rgb(bands[[5, 3, 2]], valid)  # swir22, nir, red
    (frames_dir / f"{year}-swir.webp").write_bytes(encode_webp(sw, SWIR_SIZE, quality=74))
    return {"true_colour": tc_clips, "swir": sw_clips}, {"image": f"frames/{year}.webp", "swir_image": f"frames/{year}-swir.webp"}


def run_stage(ctx) -> None:
    for d in sorted(p for p in ctx.sites_dir.iterdir() if p.is_dir()):
        if ctx.sites and d.name not in ctx.sites:
            continue
        site_doc = read_json(d / "site.json")
        scenes = read_json(d / "scenes.json")
        grid10 = _grid_of(site_doc)
        grid30 = grid10.coarse(LANDSAT_FACTOR)
        out_path = d / "frames.json"
        doc = read_json(out_path) if (ctx.resume and out_path.exists()) else {"site_id": d.name, "frames": [], "gaps": {}}
        have = {f["year"] for f in doc["frames"]}
        cache_dir = ctx.data_root / "chips" / d.name
        years = sorted(int(y) for y in scenes["years"])
        if ctx.limit_years:
            years = years[: ctx.limit_years]
        for y in years:
            if not ctx.wants_year(y):
                continue
            if y in have and ctx.resume:
                continue
            rec = scenes["years"][str(y)]
            cands = rec["sentinel2"] or rec["landsat"]
            kind = "s2" if rec["sentinel2"] else "landsat"
            grid = grid10 if kind == "s2" else grid30
            if not cands:
                doc["gaps"][str(y)] = "no scene under 60% cloud inside the season window in either archive"
                ctx.log(f"{d.name} {y}: GAP (no candidates)")
                continue
            best = None
            for i, c in enumerate(cands):
                ctx.log(f"{d.name} {y}: trying {c['sensor']} {c['date']} (scene cloud {c['cloud_scene_pct']}%, coverage {c['coverage']})")
                ids = ["+".join(it["id"] for it in c["items"])]
                try:
                    if c["sensor"] == "landsat-7" and c["date"] >= SLC_OFF_DATE:
                        bands, valid, snow, ids = _composite_l7(cands, i, grid, ctx.log)
                    else:
                        bands, valid, snow = _read_group(c, grid, kind, ctx.log)
                except Exception as exc:  # a broken remote read moves to the next candidate, recorded
                    ctx.log(f"{d.name} {y}: read failed for {c['date']}: {type(exc).__name__}: {exc}")
                    continue
                vf = float(valid.mean())
                if best is None or vf > best[0]:
                    best = (vf, c, bands, valid, snow, ids)
                if vf >= VALID_TARGET:
                    break
            if best is None:
                doc["gaps"][str(y)] = "every candidate failed to read"
                ctx.log(f"{d.name} {y}: GAP (reads failed)")
                continue
            vf, c, bands, valid, snow, ids = best
            flags = []
            if vf < VALID_TARGET:
                flags.append("low_valid")
            if len(ids) > 1:
                flags.append("composite")
            if c["sensor"] == "landsat-7" and c["date"] >= SLC_OFF_DATE:
                flags.append("slc_off")
            if snow.mean() > 0.05:
                flags.append("snow")
            meta = {"site": d.name, "year": y, "sensor": c["sensor"], "date": c["date"], "ids": ids, "valid": vf,
                    "pixel_m": grid.pixel_m, "epsg": grid.epsg, "baked": dt.date.today().isoformat()}
            _save_chip(cache_dir, d.name, y, bands, valid, snow, meta)
            clips, files = _render(bands, valid, d / "frames", y)
            frame = {
                "year": y, "sensor": c["sensor"], "scene_id": ids[0], "scene_ids": ids, "date": c["date"],
                "cloud_pct": round(100.0 * (1.0 - vf), 2), "valid_pct": round(100.0 * vf, 2),
                "snow_pct": round(100.0 * float(snow.mean()), 2), "pixel_m": grid.pixel_m,
                "image": files["image"], "image_px": TC_SIZE, "swir_image": files["swir_image"],
                "stretch": clips, "flags": flags, "collection": c["collection"],
            }
            doc["frames"] = [f for f in doc["frames"] if f["year"] != y] + [frame]
            doc["frames"].sort(key=lambda f: f["year"])
            doc["gaps"].pop(str(y), None)
            write_json(out_path, doc)
            ctx.log(f"{d.name} {y}: {c['sensor']} {c['date']} valid {vf:.3f} {flags}")
        write_json(out_path, doc)
        ctx.log(f"{d.name}: {len(doc['frames'])} frames, {len(doc['gaps'])} gaps")
