"""Stage frames: one frame per site-year from the ranked candidates.

For each year the candidates are tried in order: the item group is read onto the site grid (six channels
plus the mask band) and two fractions are measured INSIDE the window: ``data`` (pixels with a value) and
``clear`` (pixels the archive's quality mask calls cloud-, shadow- and cirrus-free). The first candidate
with clear at or above CLEAR_TARGET is taken. Over a mine the quality masks flag the mine itself (bright
benches read as cloud, pit floors and wall shadows as cloud shadow: measured 2026-09-03 on a 0.0% cloud
Landsat 5 scene over Chuquicamata, 10.7% flagged with 69% of the flags inside the mining polygons), so a
candidate whose SCENE cloud cover is at most SCENE_CLEAR_PCT is also accepted when clear reaches
CLEAR_RELAXED, flagged ``qa_flagged``. Frames are rendered from every pixel that has data; the clear mask
is kept in the chip cache for the analysis lanes, which never trust a flagged pixel.

A Landsat 7 acquisition after the scan-line corrector failure (2003-05-31) leaves stripes of no data;
those are filled by compositing the next Landsat 7 candidates of the same season (first data wins), and
the frame is flagged ``composite`` and ``slc_off`` with every scene id recorded. A year with no usable
candidate at all is recorded as a gap with its reason, never silently skipped.

Outputs per site: the chip cache (6-band uint16 reflectance x 10000, the data, clear and snow masks)
under the data root, and under <output>/sites/<id>/: frames/<year>.webp (true colour, 1024 px),
frames/<year>-swir.webp (SWIR2, NIR, red composite, 512 px) and frames.json. Resumable per site-year.
"""
from __future__ import annotations

import datetime as dt
import json
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
    pack_reflectance,
    read_onto_grid,
    s2_validity,
    stretch_rgb,
    to_reflectance,
)

CLEAR_TARGET = 0.97
CLEAR_RELAXED = 0.85
SCENE_CLEAR_PCT = 2.0
DATA_TARGET = 0.97
TC_SIZE = 1024
TC_QUALITY = 78
SWIR_SIZE = 512
SWIR_QUALITY = 72
SLC_OFF_DATE = "2003-05-31"
LANDSAT_FACTOR = 3  # 30 m on the 10 m site grid

S2_DEFAULT = (0.0001, -0.1)
LANDSAT_DEFAULT = (0.0000275, -0.2)


def _grid_of(site_doc: dict) -> Grid:
    w = site_doc["window"]
    return Grid(epsg=int(w["epsg"]), left=float(w["left"]), top=float(w["top"]), pixel_m=float(w["pixel_m"]),
                width=int(w["width"]), height=int(w["height"]))


class Read:
    """A same-day group read onto the grid: reflectance bands, data presence, QA clearness, snow."""

    def __init__(self, grid: Grid):
        h, w = grid.height, grid.width
        self.bands = np.zeros((6, h, w), dtype=np.float32)
        self.data = np.zeros((h, w), dtype=bool)
        self.clear = np.zeros((h, w), dtype=bool)
        self.snow = np.zeros((h, w), dtype=bool)

    def data_frac(self) -> float:
        return float(self.data.mean())

    def clear_frac(self) -> float:
        return float(self.clear.mean())


def _read_group(cand: dict, grid: Grid, sensor_kind: str, log, into: Read | None = None) -> Read:
    """Reads a same-day item group onto the grid. Pixels are filled where the destination has no data
    yet (first data wins); clearness is the quality-mask verdict of the pixel that supplied the data."""
    r = into or Read(grid)
    defaults = S2_DEFAULT if sensor_kind == "s2" else LANDSAT_DEFAULT
    h, w = grid.height, grid.width
    for item in cand["items"]:
        assets = item["assets"]
        if sensor_kind == "s2":
            mask_dn = read_onto_grid(assets["scl"]["href"], grid, Resampling.nearest, "uint8")
            iclear, isnow = s2_validity(mask_dn)
        else:
            href = planetary_computer.sign(assets["qa"]["href"])
            mask_dn = read_onto_grid(href, grid, Resampling.nearest, "uint16")
            iclear, isnow = landsat_validity(mask_dn)
        item_bands = np.zeros((6, h, w), dtype=np.float32)
        idata = np.ones((h, w), dtype=bool)
        for k, ch in enumerate(CHANNELS):
            a = assets[ch]
            href = a["href"] if sensor_kind == "s2" else planetary_computer.sign(a["href"])
            dn = read_onto_grid(href, grid, Resampling.bilinear, "float32")
            item_bands[k] = to_reflectance(dn, a.get("scale"), a.get("offset"), *defaults)
            idata &= dn > 0  # DN 0 is no data in both archives
        idata &= np.isfinite(item_bands).all(axis=0)
        fill = (~r.data) & idata
        r.bands[:, fill] = item_bands[:, fill]
        r.clear[fill] = iclear[fill]
        r.snow[fill] = isnow[fill]
        r.data[fill] = True
        log(f"    read {item['id']}: data {idata.mean():.3f} clear {float((iclear & idata).mean()):.3f}")
    return r


def _composite_l7(cands: list[dict], first: int, grid: Grid, log) -> tuple[Read, list[str]]:
    """Scan-line-corrector gaps of a Landsat 7 date are filled from the next Landsat 7 dates of the season
    (first data wins), until the window has data almost everywhere."""
    r = _read_group(cands[first], grid, "landsat", log)
    ids = ["+".join(i["id"] for i in cands[first]["items"])]
    for c in cands[first + 1:]:
        if r.data_frac() >= DATA_TARGET:
            break
        if c["sensor"] != "landsat-7":
            continue
        _read_group(c, grid, "landsat", log, into=r)
        ids.append("+".join(i["id"] for i in c["items"]))
    return r, ids


def _save_chip(cache_dir: Path, site_id: str, year: int, r: Read, meta: dict) -> Path:
    cache_dir.mkdir(parents=True, exist_ok=True)
    p = cache_dir / f"{site_id}_{year}.npz"
    np.savez_compressed(p, bands=pack_reflectance(r.bands), data=r.data.astype(np.uint8),
                        clear=r.clear.astype(np.uint8), snow=r.snow.astype(np.uint8),
                        meta=np.array([json.dumps(meta)]))
    return p


def _render(r: Read, frames_dir: Path, year: int) -> tuple[dict, dict]:
    frames_dir.mkdir(parents=True, exist_ok=True)
    tc, tc_clips = stretch_rgb(r.bands[[2, 1, 0]], r.data)  # red, green, blue
    (frames_dir / f"{year}.webp").write_bytes(encode_webp(tc, TC_SIZE, quality=TC_QUALITY))
    sw, sw_clips = stretch_rgb(r.bands[[5, 3, 2]], r.data)  # swir22, nir, red
    (frames_dir / f"{year}-swir.webp").write_bytes(encode_webp(sw, SWIR_SIZE, quality=SWIR_QUALITY))
    return {"true_colour": tc_clips, "swir": sw_clips}, {"image": f"frames/{year}.webp", "swir_image": f"frames/{year}-swir.webp"}


def _accepted(c: dict, clear_f: float, data_f: float) -> bool:
    if data_f < DATA_TARGET:
        return False
    if clear_f >= CLEAR_TARGET:
        return True
    return float(c["cloud_scene_pct"]) <= SCENE_CLEAR_PCT and clear_f >= CLEAR_RELAXED


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
                write_json(out_path, doc)
                ctx.log(f"{d.name} {y}: GAP (no candidates)")
                continue
            best: tuple[float, float, dict, Read, list[str]] | None = None
            for i, c in enumerate(cands):
                ctx.log(f"{d.name} {y}: trying {c['sensor']} {c['date']} (scene cloud {c['cloud_scene_pct']}%, coverage {c['coverage']})")
                try:
                    if c["sensor"] == "landsat-7" and c["date"] >= SLC_OFF_DATE:
                        r, ids = _composite_l7(cands, i, grid, ctx.log)
                    else:
                        r = _read_group(c, grid, kind, ctx.log)
                        ids = ["+".join(it["id"] for it in c["items"])]
                except Exception as exc:  # a broken remote read moves to the next candidate, recorded
                    ctx.log(f"{d.name} {y}: read failed for {c['date']}: {type(exc).__name__}: {exc}")
                    continue
                clear_f, data_f = r.clear_frac(), r.data_frac()
                score = clear_f if data_f >= DATA_TARGET else clear_f * data_f
                if best is None or score > best[0]:
                    best = (score, clear_f, c, r, ids)
                if _accepted(c, clear_f, data_f):
                    break
            if best is None:
                doc["gaps"][str(y)] = "every candidate failed to read"
                write_json(out_path, doc)
                ctx.log(f"{d.name} {y}: GAP (reads failed)")
                continue
            _score, clear_f, c, r, ids = best
            data_f = r.data_frac()
            flags = []
            if data_f < DATA_TARGET:
                flags.append("low_data")
            if clear_f < CLEAR_TARGET:
                flags.append("qa_flagged")
            if len(ids) > 1:
                flags.append("composite")
            if c["sensor"] == "landsat-7" and c["date"] >= SLC_OFF_DATE:
                flags.append("slc_off")
            if float(r.snow.mean()) > 0.05:
                flags.append("snow")
            meta = {"site": d.name, "year": y, "sensor": c["sensor"], "date": c["date"], "ids": ids,
                    "data": data_f, "clear": clear_f, "pixel_m": grid.pixel_m, "epsg": grid.epsg,
                    "baked": dt.date.today().isoformat()}
            _save_chip(cache_dir, d.name, y, r, meta)
            clips, files = _render(r, d / "frames", y)
            frame = {
                "year": y, "sensor": c["sensor"], "scene_id": ids[0], "scene_ids": ids, "date": c["date"],
                "cloud_pct": round(100.0 * (1.0 - clear_f), 2), "valid_pct": round(100.0 * clear_f, 2),
                "data_pct": round(100.0 * data_f, 2), "scene_cloud_pct": round(float(c["cloud_scene_pct"]), 2),
                "snow_pct": round(100.0 * float(r.snow.mean()), 2), "pixel_m": grid.pixel_m,
                "image": files["image"], "image_px": TC_SIZE, "swir_image": files["swir_image"],
                "stretch": clips, "flags": flags, "collection": c["collection"],
            }
            doc["frames"] = [f for f in doc["frames"] if f["year"] != y] + [frame]
            doc["frames"].sort(key=lambda f: f["year"])
            doc["gaps"].pop(str(y), None)
            write_json(out_path, doc)
            ctx.log(f"{d.name} {y}: {c['sensor']} {c['date']} data {data_f:.3f} clear {clear_f:.3f} {flags}")
        write_json(out_path, doc)
        ctx.log(f"{d.name}: {len(doc['frames'])} frames, {len(doc['gaps'])} gaps")
