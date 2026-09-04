"""Stage dense: the dense Sentinel-2 index series of the site envelope (2017 onwards), the input of
the harmonic regression with breaks (M11).

Every Sentinel-2 L2A same-day group over the window since 2017-01-01 with scene cloud below 40% and
at least 90% coverage is read at 60 m onto a coarse grid (six times the 10 m grid: a window of
1600 px becomes 266 px, which the COG overviews serve in a few hundred milliseconds per band), and
the envelope mean of the bare-ground index BSI (NDVI and MNDWI are stored too) is kept for the dates
whose envelope is at least 70% clear by the scene classification. The output is one small side-car
per site, ``dense.json``: dates, index values, clear fractions, rejected dates with the reason.
Resumable: dates already seen are not read again, so a killed run continues.

This stage is the most expensive per site after the frames (about 4 s per date, 600 to 700 dates per
site); run it detached, in parallel over disjoint site lists, like the frames.
"""
from __future__ import annotations

import numpy as np
from rasterio.enums import Resampling
from shapely.geometry import box, shape
from shapely.ops import unary_union

from ..manifest import read_json, write_json
from ..raster import GDAL_ENV, Grid, s2_validity, to_reflectance
from ..stac import EARTH_SEARCH, S2_BANDS, _asset, _epsg
from .frames import S2_DEFAULT, _grid_of
from .masks import ENVELOPE_M, _envelope

START = "2017-01-01"
END = "2026-12-31"
CLOUD_MAX = 40.0
MIN_COVERAGE = 0.90
MIN_CLEAR = 0.70
COARSE_FACTOR = 6
BANDS = ("blue", "green", "red", "nir", "swir16")


def search_dates(client, bbox: tuple[float, float, float, float], start: str = START, end: str = END) -> list[dict]:
    """Every same-day group of Sentinel-2 L2A items over the bbox, year by year (the API pages), with
    the union coverage of the window; groups under MIN_COVERAGE are dropped. No cap on the count."""
    w = box(*bbox)
    out: list[dict] = []
    for y in range(int(start[:4]), int(end[:4]) + 1):
        a = f"{y}-01-01" if y > int(start[:4]) else start
        b = f"{y}-12-31" if y < int(end[:4]) else end
        search = client.search(collections=["sentinel-2-l2a"], intersects=w.__geo_interface__,
                               datetime=f"{a}T00:00:00Z/{b}T23:59:59Z", query={"eo:cloud_cover": {"lt": CLOUD_MAX}}, max_items=1000)
        by_date: dict[str, list] = {}
        for it in search.items():
            p = it.properties
            assets = {k: _asset(it.assets[v]) for k, v in S2_BANDS.items() if v in it.assets}
            if len(assets) < len(S2_BANDS) or it.geometry is None:
                continue
            by_date.setdefault(str(p.get("datetime", ""))[:10], []).append((it, assets, float(p.get("eo:cloud_cover", 100.0))))
        for date, rows in by_date.items():
            union = unary_union([shape(it.geometry) for it, _a, _c in rows])
            cov = float(union.intersection(w).area / w.area) if w.area > 0 else 0.0
            if cov < MIN_COVERAGE:
                continue
            out.append({"date": date, "coverage": round(cov, 4), "cloud": round(sum(c for _i, _a, c in rows) / len(rows), 2),
                        "items": [{"id": it.id, "epsg": _epsg(it.properties), "assets": {k: v.to_json() for k, v in a.items()}} for it, a, _c in rows]})
    out.sort(key=lambda g: g["date"])
    return out


def _coarse_grid(grid10: Grid) -> Grid:
    n = grid10.width // COARSE_FACTOR
    return Grid(grid10.epsg, grid10.left, grid10.top, grid10.pixel_m * COARSE_FACTOR, n, n)


def _read_coarse(href: str, grid: Grid, resampling: Resampling, dtype: str) -> np.ndarray:
    """A decimated windowed read in the item's own zone (the site grid shares it), so GDAL serves the
    COG overview that matches the 60 m cells instead of warping the full-resolution tile."""
    import rasterio
    from rasterio.windows import Window, from_bounds

    out = np.zeros((grid.height, grid.width), dtype=dtype)
    with rasterio.open(href) as src:
        right = grid.left + grid.width * grid.pixel_m
        bottom = grid.top - grid.height * grid.pixel_m
        want = from_bounds(grid.left, bottom, right, grid.top, src.transform)
        # clip to the tile (a boundless read would give up the overviews and pull full-resolution data)
        full = Window(0, 0, src.width, src.height)
        try:
            win = want.intersection(full)
        except Exception:  # no overlap
            return out
        if win.width <= 0 or win.height <= 0:
            return out
        factor = grid.pixel_m / src.res[0]
        oh = max(1, int(round(win.height / factor)))
        ow = max(1, int(round(win.width / factor)))
        arr = src.read(1, window=win, out_shape=(oh, ow), resampling=resampling)
        r0 = int(round((win.row_off - want.row_off) / factor))
        c0 = int(round((win.col_off - want.col_off) / factor))
        r0, c0 = max(0, r0), max(0, c0)
        h = min(oh, grid.height - r0)
        w = min(ow, grid.width - c0)
        if h > 0 and w > 0:
            out[r0:r0 + h, c0:c0 + w] = arr[:h, :w]
    return out


def _read_date(g: dict, grid: Grid) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    h, w = grid.height, grid.width
    data = np.zeros((h, w), dtype=bool)
    clear = np.zeros((h, w), dtype=bool)
    bands = np.zeros((len(BANDS), h, w), dtype=np.float32)
    for item in g["items"]:
        if item["epsg"] != grid.epsg:
            continue
        scl = _read_coarse(item["assets"]["scl"]["href"], grid, Resampling.nearest, "uint8")
        iclear, _snow = s2_validity(scl)
        idata = scl > 0
        ib = np.zeros_like(bands)
        for k, ch in enumerate(BANDS):
            a = item["assets"][ch]
            dn = _read_coarse(a["href"], grid, Resampling.average, "float32")
            ib[k] = to_reflectance(dn, a.get("scale"), a.get("offset"), *S2_DEFAULT)
            idata &= dn > 0
        fill = (~data) & idata
        bands[:, fill] = ib[:, fill]
        clear[fill] = iclear[fill]
        data[fill] = True
    return bands, data, clear


def _fresh_doc(site_id: str, grid: Grid) -> dict:
    # status is "partial" while the walk through the archive checkpoints every twenty kept dates and
    # "complete" only after the last candidate date; the series stage consumes a complete file only
    return {"site_id": site_id, "index": "bsi", "grid_m": grid.pixel_m, "envelope": f"reference polygons dilated by {ENVELOPE_M:.0f} m",
            "min_clear_frac": MIN_CLEAR, "status": "partial", "n_candidates": 0,
            "dates": [], "values": [], "ndvi": [], "mndwi": [], "clear_frac": [], "rejected": {}, "seen": []}


def _sorted(doc: dict) -> dict:
    order = sorted(range(len(doc["dates"])), key=lambda i: doc["dates"][i])
    for key in ("dates", "values", "ndvi", "mndwi", "clear_frac"):
        doc[key] = [doc[key][i] for i in order]
    doc["seen"] = sorted(set(doc["seen"]))
    return doc


def run_stage(ctx) -> None:
    import rasterio
    from pystac_client import Client

    client = Client.open(EARTH_SEARCH)
    for d in sorted(p for p in ctx.sites_dir.iterdir() if p.is_dir()):
        if ctx.sites and d.name not in ctx.sites:
            continue
        site_doc = read_json(d / "site.json")
        grid = _coarse_grid(_grid_of(site_doc))
        envelope = _envelope(d, grid)
        env_n = int(envelope.sum())
        out_path = d / "dense.json"
        doc = read_json(out_path) if (ctx.resume and out_path.exists()) else _fresh_doc(d.name, grid)
        seen = set(doc["seen"])
        bbox = tuple(site_doc["window"]["bbox_wgs84"])
        ctx.log(f"{d.name}: searching Sentinel-2 dates since {START}")
        groups = search_dates(client, bbox)
        todo = [g for g in groups if g["date"] not in seen and ctx.wants_year(int(g["date"][:4]))
                and any(it["epsg"] == grid.epsg for it in g["items"])]
        ctx.log(f"{d.name}: {len(groups)} covering dates, {len(todo)} to read at {grid.pixel_m:.0f} m ({grid.width} px)")
        doc["status"] = "partial"
        doc["n_candidates"] = len(groups)
        n_done = 0
        with rasterio.Env(**GDAL_ENV):
            for g in todo:
                try:
                    bands, data, clear = _read_date(g, grid)
                except Exception as exc:  # one unreadable date is recorded, the series goes on
                    doc["rejected"][g["date"]] = f"read failed: {type(exc).__name__}"
                    doc["seen"].append(g["date"])
                    continue
                doc["seen"].append(g["date"])
                sel = data & clear & envelope
                cf = float(sel.sum() / max(1, env_n))
                if cf < MIN_CLEAR:
                    doc["rejected"][g["date"]] = round(cf, 3)
                    continue
                from .series import index_means  # the same guarded means as the yearly series

                means = index_means(bands, sel)
                if means["bsi"] is None:
                    doc["rejected"][g["date"]] = "no pixel above the reflectance floor"
                    continue
                doc["dates"].append(g["date"])
                doc["values"].append(means["bsi"])
                doc["ndvi"].append(means["ndvi"])
                doc["mndwi"].append(means["mndwi"])
                doc["clear_frac"].append(round(cf, 3))
                n_done += 1
                if n_done % 20 == 0:
                    write_json(out_path, _sorted(doc))
                    ctx.log(f"  {d.name}: {len(doc['dates'])} dates kept, {len(doc['rejected'])} rejected, last {g['date']} bsi {doc['values'][-1]:.3f}")
        doc["status"] = "complete"
        write_json(out_path, _sorted(doc))
        ctx.log(f"{d.name}: dense series with {len(doc['dates'])} dates ({len(doc['rejected'])} rejected) -> dense.json (complete)")
