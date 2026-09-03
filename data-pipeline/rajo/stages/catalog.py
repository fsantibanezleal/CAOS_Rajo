"""Stage catalog: apply Contract 1 to data/examples/sites.json, select the reference polygons, build the
site windows, and write <output>/sites/<id>/site.json for every accepted site.

Inputs: the site catalog and the Maus 2022 GeoPackage (global_mining_polygons_v2.gpkg) under the data
root (raw/maus2022). If the GeoPackage is absent the stage downloads it from PANGAEA (23.5 MB, CC BY-SA
4.0) into the data root.
"""
from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from urllib.request import Request, urlopen

from shapely.geometry import mapping

from ..contracts import validate_sites
from ..geo import MiningPolygons, site_window
from ..manifest import write_json
from ..paths import raw_dir

MAUS_URL = "https://download.pangaea.de/dataset/942325/files/global_mining_polygons_v2.gpkg"
MAUS_FILE = "global_mining_polygons_v2.gpkg"


def ensure_maus(repo_root: Path, log) -> Path:
    d = raw_dir(repo_root, "maus2022")
    p = d / MAUS_FILE
    if p.exists() and p.stat().st_size > 20_000_000:
        return p
    log(f"downloading the Maus 2022 polygons (CC BY-SA 4.0) from PANGAEA to {p}")
    req = Request(MAUS_URL, headers={"User-Agent": "rajo-bake/1.0"})
    with urlopen(req, timeout=120) as r, p.open("wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    return p


def load_catalog(repo_root: Path) -> list[dict]:
    return json.loads((repo_root / "data" / "examples" / "sites.json").read_text(encoding="utf-8"))["sites"]


def run_stage(ctx) -> None:
    raw = load_catalog(ctx.repo_root)
    if ctx.sites:
        raw = [r for r in raw if r.get("id") in ctx.sites]
        missing = set(ctx.sites) - {r.get("id") for r in raw}
        if missing:
            raise ValueError(f"unknown site ids: {sorted(missing)}")

    gpkg = ensure_maus(ctx.repo_root, ctx.log)
    polys = MiningPolygons(gpkg)
    ctx.log(f"reference polygons: {polys.count()} features in {gpkg.name}")

    report = validate_sites(raw, nearest_polygon_km=polys.nearest_km)
    for r in report.rejected:
        ctx.log(f"REJECTED {r['id']}: {r['reason']}")
    for f in report.flagged:
        ctx.log(f"flagged {f['id']}: {f['flag']}")
    if report.rejected:
        raise ValueError(f"Contract 1 rejected {len(report.rejected)} site(s); fix data/examples/sites.json")

    for site in report.accepted:
        win = site_window(site.lon, site.lat, site.window_km)
        bbox = win.bbox_wgs84()
        found = polys.within_bbox(*bbox)
        features = []
        total_area = 0.0
        for fid, iso3, area, g in found:
            features.append({"type": "Feature", "properties": {"fid": fid, "iso3": iso3, "area_km2": round(area, 4)},
                             "geometry": mapping(g)})
            total_area += area
        site_doc = {
            "site": asdict(site),
            "window": {
                "epsg": win.epsg, "pixel_m": win.pixel_m, "width": win.width, "height": win.height,
                "left": win.left, "top": win.top, "right": win.right, "bottom": win.bottom,
                "transform": list(win.transform), "bbox_wgs84": list(bbox),
            },
            "polygons": {
                "source": "Maus et al. 2022, Global-scale mining polygons v2, doi:10.1594/PANGAEA.942325, CC BY-SA 4.0",
                "n_features": len(features), "area_km2": round(total_area, 3),
                "fids": sorted(f["properties"]["fid"] for f in features),
            },
        }
        d = ctx.site_dir(site.id)
        write_json(d / "site.json", site_doc)
        write_json(d / "polygons.geojson", {"type": "FeatureCollection", "features": features,
                                            "license": "CC-BY-SA-4.0",
                                            "attribution": "Maus et al. 2022 (doi:10.1594/PANGAEA.942325)"})
        ctx.log(f"{site.id}: window {win.width}x{win.height} px EPSG:{win.epsg}, "
                f"{len(features)} polygons ({total_area:.1f} km2)")
    polys.close()
    write_json(ctx.output / "catalog-report.json", {
        "engine_version": ctx.engine_version, "summary": report.summary(),
        "accepted": [s.id for s in report.accepted], "flagged": report.flagged, "rejected": report.rejected,
    })
