"""Stage scenes: for every accepted site and every year from first_year to the current year, search the
archives inside the site's season window and record the ranked candidates (same-day item groups).

Writes <output>/sites/<id>/scenes.json. Resumable: with --resume, years already present are kept.
Landsat (Planetary Computer) covers years up to 2016; Sentinel-2 (Earth Search) covers 2017 onward.
The overlap years 2017 to 2026 also record Landsat 8/9 candidates, which the experiments use to measure
the cross-sensor shift.
"""
from __future__ import annotations

import datetime as dt

from ..manifest import read_json, write_json
from ..stac import landsat_platforms_for, open_clients, search_landsat, search_sentinel2, season_range

SENTINEL_FIRST_YEAR = 2017
LAST_YEAR = dt.date.today().year


def run_stage(ctx) -> None:
    es, pc = open_clients()
    for d in sorted(p for p in ctx.sites_dir.iterdir() if p.is_dir()):
        if ctx.sites and d.name not in ctx.sites:
            continue
        site_doc = read_json(d / "site.json")
        site = site_doc["site"]
        bbox = tuple(site_doc["window"]["bbox_wgs84"])
        out_path = d / "scenes.json"
        doc = read_json(out_path) if (ctx.resume and out_path.exists()) else {"site_id": site["id"], "years": {}}
        years = list(range(int(site["first_year"]), LAST_YEAR + 1))
        if ctx.limit_years:
            years = years[: ctx.limit_years]
        sm, em = site["season"]["start_month"], site["season"]["end_month"]
        n_new = 0
        for y in years:
            key = str(y)
            if not ctx.wants_year(y):
                continue
            if key in doc["years"] and ctx.resume:
                continue
            start, end = season_range(y, sm, em)
            rec = {"season": [start, end], "sentinel2": [], "landsat": []}
            if y >= SENTINEL_FIRST_YEAR:
                rec["sentinel2"] = [c.to_json() for c in search_sentinel2(es, bbox, start, end)]
            rec["landsat"] = [c.to_json() for c in search_landsat(pc, bbox, start, end, landsat_platforms_for(y))]
            doc["years"][key] = rec
            n_new += 1
            if n_new % 10 == 0:
                write_json(out_path, doc)
        write_json(out_path, doc)
        n_s2 = sum(1 for r in doc["years"].values() if r["sentinel2"])
        n_ls = sum(1 for r in doc["years"].values() if r["landsat"])
        empty = [y for y, r in doc["years"].items() if not r["sentinel2"] and not r["landsat"]]
        ctx.log(f"{d.name}: {len(doc['years'])} years, S2 in {n_s2}, Landsat in {n_ls}, empty {empty}")
