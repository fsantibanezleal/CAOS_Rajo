"""Fetch the training tiles of the learned lane: Jasansky et al. 2024 geometry + Earth Search pixels.

The Global ML-ready dataset for mining areas in satellite images (Jasansky, Maus, Popa, Wilbik 2024,
doi:10.5281/zenodo.14195737, CC BY-SA 4.0) ships, per tile, the 2048 x 2048 footprint of a Sentinel-2
Level-2A product, the product id, the preferred mining-area polygons (Maus 2022 or Tang 2023, chosen by
the authors) and a train/validation/test split. The pixels are not in the zip: this script finds the
product on Earth Search (same MGRS tile and acquisition date; the highest processing baseline wins, and
its reflectance scale and offset are applied), reads the six bands and the scene classification onto the
tile's own 10 m grid (the 20 m SWIR bands are resampled bilinearly, which is what the browser does too),
rasterizes the preferred polygons on that grid, and stores one compressed npz per tile:

    bands  uint16 (6, H, W)   reflectance x 10000, order blue green red nir swir16 swir22
    scl    uint8  (H, W)      Sentinel-2 scene classification
    label  uint8  (H, W)      1 inside the preferred mining polygons
    meta   json               tile id, product, item, epsg, grid, split, mine type, holdout, cloud fraction

Leakage rule (research-05): every tile whose footprint touches a Rajo catalog site window is removed from
train and validation and marked ``holdout=catalog``; the numbers shown on the site cards are never
in-sample. The published split is kept for everything else.

    python data-pipeline/train/fetch_tiles.py --workers 6
    python data-pipeline/train/fetch_tiles.py --split test --limit 20
    python data-pipeline/train/fetch_tiles.py --index-only        # rebuild index.json from what is on disk
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "data-pipeline"))

from rajo.geo import _gpkg_geom  # noqa: E402
from rajo.paths import data_root  # noqa: E402

CHANNELS = ("blue", "green", "red", "nir", "swir16", "swir22")
TILE_PX = 2048
PIXEL_M = 10.0
CLOUD_SCL = (0, 1, 3, 8, 9, 10)


def _catalog_boxes() -> list[tuple[str, tuple[float, float, float, float]]]:
    out = []
    for p in sorted((REPO / "data" / "derived" / "sites").glob("*/site.json")):
        doc = json.loads(p.read_text(encoding="utf-8"))
        out.append((doc["site"]["id"], tuple(doc["window"]["bbox_wgs84"])))
    return out


def _touches(bbox: tuple[float, float, float, float], boxes) -> str | None:
    minx, miny, maxx, maxy = bbox
    for site_id, (a, b, c, d) in boxes:
        if maxx >= a and minx <= c and maxy >= b and miny <= d:
            return site_id
    return None


def list_tiles(gpkg: Path, splits: set[str]) -> list[dict]:
    from shapely.geometry import mapping

    con = sqlite3.connect(f"file:{gpkg.as_posix()}?mode=ro", uri=True)
    rows = con.execute(
        "select tile_id, s2_tile_id, split, minetype1, minetype2, source_dataset, preferred_dataset, geom "
        "from tiles where split is not null").fetchall()
    boxes = _catalog_boxes()
    tiles = []
    for tile_id, s2_id, split, mt1, mt2, src, pref, blob in rows:
        if split not in splits:
            continue
        g = _gpkg_geom(blob)
        if g is None:
            continue
        b = g.bounds
        hold = _touches(b, boxes)
        tiles.append({"tile_id": int(tile_id), "product": s2_id, "split": split, "minetype": mt1, "scale": mt2,
                      "source": src, "preferred": pref, "footprint": mapping(g), "bbox": list(b),
                      "holdout": hold})
    con.close()
    return tiles


def _label_polygons(gpkg: Path, tile_id: int):
    con = sqlite3.connect(f"file:{gpkg.as_posix()}?mode=ro", uri=True)
    blobs = [r[0] for r in con.execute("select geom from preferred_polygons where tile_id=?", (tile_id,))]
    con.close()
    return [g for g in (_gpkg_geom(b) for b in blobs) if g is not None and not g.is_empty]


def fetch_one(tile: dict, gpkg: str, out_dir: str) -> dict:
    """Worker: one tile end to end. Returns the meta record (with an ``error`` key on failure)."""
    import rasterio
    from pyproj import CRS, Transformer
    from pystac_client import Client
    from rajo.raster import GDAL_ENV, Grid, pack_reflectance, read_onto_grid, to_reflectance
    from rajo.stac import EARTH_SEARCH, S2_BANDS, _asset, _epsg
    from rasterio.enums import Resampling
    from rasterio.features import rasterize
    from shapely.geometry import shape
    from shapely.ops import transform as shp_transform

    t0 = time.time()
    out = Path(out_dir)
    tid = tile["tile_id"]
    meta_path = out / f"{tid}.json"
    npz_path = out / f"{tid}.npz"
    try:
        parts = tile["product"].split("_")
        date = parts[2][:8]
        mgrs = parts[4][1:]
        day = f"{date[:4]}-{date[4:6]}-{date[6:]}"
        client = Client.open(EARTH_SEARCH)
        items = []
        collection = ""
        # the Level-2A collection first; the Collection-1 reprocessing holds scenes the first lacks
        # (2016 to 2017 acquisitions and some later gaps)
        for collection in ("sentinel-2-l2a", "sentinel-2-c1-l2a"):
            search = client.search(collections=[collection], datetime=f"{day}T00:00:00Z/{day}T23:59:59Z",
                                   query={"grid:code": {"eq": f"MGRS-{mgrs}"}}, max_items=6)
            items = list(search.items())
            if items:
                break
        if not items:
            raise RuntimeError(f"no Earth Search item for {mgrs} on {day}")
        items.sort(key=lambda it: str(it.properties.get("s2:processing_baseline", "")), reverse=True)
        it = items[0]
        epsg = _epsg(it.properties)
        if epsg is None:
            raise RuntimeError("item without proj:epsg")
        assets = {k: _asset(it.assets[v]) for k, v in S2_BANDS.items() if v in it.assets}
        if len(assets) < len(S2_BANDS):
            raise RuntimeError("item missing band assets")
        # the tile grid: the footprint projected into the item's zone, snapped to 10 m, 2048 px square
        fwd = Transformer.from_crs(CRS.from_epsg(4326), CRS.from_epsg(epsg), always_xy=True).transform
        foot = shp_transform(fwd, shape(tile["footprint"]))
        minx, miny, maxx, maxy = foot.bounds
        left = round(minx / PIXEL_M) * PIXEL_M
        top = round(maxy / PIXEL_M) * PIXEL_M
        width = int(round((maxx - minx) / PIXEL_M))
        height = int(round((maxy - miny) / PIXEL_M))
        # a footprint drawn in a neighbouring zone lands a few pixels wider here; keep its real size
        if not (TILE_PX - 128 <= width <= TILE_PX + 128 and TILE_PX - 128 <= height <= TILE_PX + 128):
            raise RuntimeError(f"footprint is {width}x{height} px, expected about {TILE_PX}")
        grid = Grid(epsg=epsg, left=left, top=top, pixel_m=PIXEL_M, width=width, height=height)
        bands = np.zeros((len(CHANNELS), height, width), dtype=np.uint16)
        with rasterio.Env(**GDAL_ENV):
            scl = read_onto_grid(assets["scl"].href, grid, Resampling.nearest, dtype="uint8")
            for i, ch in enumerate(CHANNELS):
                a = assets[ch]
                dn = read_onto_grid(a.href, grid, Resampling.bilinear, dtype="float32")
                refl = to_reflectance(dn, a.scale, a.offset, 0.0001, 0.0)
                refl[dn <= 0] = 0.0
                bands[i] = pack_reflectance(refl)
        polys = [shp_transform(fwd, g) for g in _label_polygons(Path(gpkg), tid)]
        label = rasterize([(g, 1) for g in polys], out_shape=(height, width), transform=grid.transform,
                          fill=0, dtype="uint8") if polys else np.zeros((height, width), dtype=np.uint8)
        data = scl > 0
        cloud = float(np.isin(scl, CLOUD_SCL).mean())
        meta = {"tile_id": tid, "product": tile["product"], "item": it.id, "collection": collection,
                "baseline": it.properties.get("s2:processing_baseline"),
                "offset_applied": it.properties.get("earthsearch:boa_offset_applied"),
                "epsg": epsg, "grid": {"left": left, "top": top, "pixel_m": PIXEL_M, "width": width, "height": height},
                "split": tile["split"], "minetype": tile["minetype"], "scale": tile["scale"],
                "source": tile["source"], "preferred": tile["preferred"], "holdout": tile["holdout"],
                "bbox_wgs84": tile["bbox"], "cloud_frac": round(cloud, 4), "data_frac": round(float(data.mean()), 4),
                "label_frac": round(float(label.mean()), 4), "n_polygons": len(polys),
                "seconds": round(time.time() - t0, 1)}
        np.savez_compressed(npz_path, bands=bands, scl=scl.astype(np.uint8), label=label)
        meta_path.write_text(json.dumps(meta, indent=1) + "\n", encoding="utf-8", newline="\n")
        return meta
    except Exception as exc:  # recorded, never fatal for the batch
        return {"tile_id": tid, "product": tile["product"], "error": f"{type(exc).__name__}: {exc}",
                "seconds": round(time.time() - t0, 1)}


def build_index(out: Path) -> dict:
    metas = []
    for p in sorted(out.glob("*.json")):
        if p.name == "index.json":
            continue
        try:
            m = json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if "error" not in m and (out / f"{m['tile_id']}.npz").exists():
            metas.append(m)
    by_split: dict[str, int] = {}
    for m in metas:
        key = "catalog-holdout" if m.get("holdout") else m["split"]
        by_split[key] = by_split.get(key, 0) + 1
    index = {"schema": "rajo.train-tiles/v1", "source": "Jasansky et al. 2024, doi:10.5281/zenodo.14195737, CC BY-SA 4.0",
             "pixels": "Sentinel-2 L2A, Earth Search v1 (Element 84, AWS Open Data)", "tile_px": TILE_PX,
             "pixel_m": PIXEL_M, "channels": list(CHANNELS), "n": len(metas), "by_split": by_split, "tiles": metas}
    (out / "index.json").write_text(json.dumps(index, indent=1) + "\n", encoding="utf-8", newline="\n")
    return index


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--gpkg", default="")
    ap.add_argument("--out", default="")
    ap.add_argument("--split", default="train,val,test")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--index-only", action="store_true")
    a = ap.parse_args()
    root = data_root(REPO)
    gpkg = Path(a.gpkg) if a.gpkg else root / "raw" / "jasansky2024" / "mining_area_data.gpkg"
    out = Path(a.out) if a.out else root / "train" / "tiles"
    out.mkdir(parents=True, exist_ok=True)
    if a.index_only:
        idx = build_index(out)
        print(f"index: {idx['n']} tiles {idx['by_split']}")
        return 0
    if not gpkg.exists():
        print(f"missing {gpkg}: download mining_area_data.zip from doi:10.5281/zenodo.14195737 and unzip it there")
        return 2
    tiles = list_tiles(gpkg, {s for s in a.split.split(",") if s})
    todo = [t for t in tiles if not ((out / f"{t['tile_id']}.npz").exists() and (out / f"{t['tile_id']}.json").exists())]
    if a.limit:
        todo = todo[: a.limit]
    print(f"{len(tiles)} tiles in {a.split}; {len(todo)} to fetch; {sum(1 for t in tiles if t['holdout'])} touch a catalog site "
          f"(held out); workers={a.workers}; out={out}", flush=True)
    done = errors = 0
    t0 = time.time()
    with ProcessPoolExecutor(max_workers=a.workers) as ex:
        futs = [ex.submit(fetch_one, t, str(gpkg), str(out)) for t in todo]
        for f in as_completed(futs):
            m = f.result()
            if "error" in m:
                errors += 1
                print(f"  ERROR tile {m['tile_id']} {m['product']}: {m['error']}", flush=True)
            else:
                done += 1
                print(f"  tile {m['tile_id']} {m['split']}{' HOLDOUT ' + m['holdout'] if m['holdout'] else ''} "
                      f"cloud {m['cloud_frac']:.3f} label {m['label_frac']:.3f} {m['seconds']}s "
                      f"[{done + errors}/{len(todo)} {(time.time() - t0) / 60:.1f} min]", flush=True)
    idx = build_index(out)
    print(f"done: {done} fetched, {errors} errors; index {idx['n']} tiles {idx['by_split']}")
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    os.environ.setdefault("OMP_NUM_THREADS", "2")
    raise SystemExit(main())
