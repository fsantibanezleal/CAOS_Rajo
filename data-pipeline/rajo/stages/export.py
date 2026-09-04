"""Stage export: assemble every site's manifest from what the earlier stages wrote under
<output>/sites/<id>/ and write the catalog index. Byte sizes and sha256 of every declared file are
recorded so the web contract can be verified on disk (scripts/check_artifacts.py) and at deploy time.

The export never recomputes science; it only reads the per-stage JSON side-cars (site.json, frames.json,
series.json, dem.json) and the files they point at.
"""
from __future__ import annotations

from pathlib import Path

from ..manifest import build_catalog, build_site_manifest, file_ref, read_json, write_json


def _optional(path: Path):
    return read_json(path) if path.exists() else None


def run_stage(ctx) -> None:
    sites_dir = ctx.sites_dir
    entries = []
    if not sites_dir.exists():
        raise FileNotFoundError(f"{sites_dir} does not exist: run the catalog stage first")
    for d in sorted(p for p in sites_dir.iterdir() if p.is_dir()):
        if ctx.sites and d.name not in ctx.sites:
            continue
        site_doc = _optional(d / "site.json")
        if site_doc is None:
            ctx.log(f"{d.name}: no site.json, skipped")
            continue
        frames_doc = _optional(d / "frames.json") or {"frames": [], "gaps": {}}
        masks_doc = _optional(d / "masks.json")
        series_doc = _optional(d / "series.json")
        dem_doc = _optional(d / "dem.json")
        models_doc = _optional(d / "models.json") or {"models": []}

        files = [file_ref(d, ctx.output, d / "polygons.geojson", "polygons")]
        for fr in frames_doc["frames"]:
            for key in ("image", "swir_image", "chip_preview"):
                if fr.get(key):
                    files.append(file_ref(d, ctx.output, d / fr[key], "frame", year=fr["year"]))
            # the masks stage writes one file per year and method; the frame record points at them
            year_masks = ((masks_doc or {}).get("years") or {}).get(str(fr["year"]), {})
            # a year record also carries the sensor and the valid fraction; only the method records name a file
            fr["masks"] = {mk: rec["file"] for mk, rec in year_masks.items() if isinstance(rec, dict) and rec.get("file")}
            for mk, mfile in fr["masks"].items():
                files.append(file_ref(d, ctx.output, d / mfile, "mask", year=fr["year"], method=mk))
        if dem_doc:
            for key in ("delta_png", "srtm_png", "cop_png"):
                if dem_doc.get(key):
                    files.append(file_ref(d, ctx.output, d / dem_doc[key], "dem"))
            for tile in dem_doc.get("terrain_tiles", []):
                files.append(file_ref(d, ctx.output, d / tile, "terrain"))

        manifest = build_site_manifest(
            site=site_doc["site"], window=site_doc["window"], polygons=site_doc["polygons"],
            frames=frames_doc["frames"], series=series_doc, dem=dem_doc, models=models_doc["models"],
            files=files, engine_version=ctx.engine_version, gaps=frames_doc.get("gaps", {}),
        )
        write_json(d / "manifest.json", manifest)
        entries.append({
            "site_id": manifest["site_id"], "name": site_doc["site"]["name_en"],
            "name_es": site_doc["site"]["name_es"], "country": site_doc["site"]["country"],
            "categories": site_doc["site"]["categories"], "lon": site_doc["site"]["lon"],
            "lat": site_doc["site"]["lat"], "n_frames": len(frames_doc["frames"]),
            "first_year": site_doc["site"]["first_year"],
            "manifest_path": f"sites/{d.name}/manifest.json",
        })
        ctx.log(f"{d.name}: manifest with {len(files)} files, {len(frames_doc['frames'])} frames")

    if ctx.release and not entries:
        raise ValueError("refusing to write an empty canonical catalog")
    write_json(ctx.catalog_path, build_catalog(entries, ctx.engine_version))
    ctx.log(f"catalog: {len(entries)} sites -> {ctx.catalog_path}")
