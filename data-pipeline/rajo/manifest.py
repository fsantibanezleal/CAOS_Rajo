"""CONTRACT 2, artifact: the per-site manifest and the catalog index the web app reads.

The manifest is the authoritative, versioned record of a baked site. The frontend loads ONLY manifests
and the files they declare; frontend/src/lib/contract.ts mirrors these shapes so a drift fails the web
build. Everything here is a pure function of its inputs (no wall-clock), so re-baking an unchanged site
produces byte-identical manifests and git stays clean.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

SITE_SCHEMA = "rajo.site/v1"
CATALOG_SCHEMA = "rajo.catalog/v1"


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def file_ref(site_dir: Path, derived_root: Path, path: Path, kind: str, **extra: Any) -> dict[str, Any]:
    rel = path.relative_to(derived_root).as_posix()
    return {"path": rel, "kind": kind, "bytes": path.stat().st_size, "sha256": sha256_of(path), **extra}


def build_site_manifest(*, site: dict[str, Any], window: dict[str, Any], polygons: dict[str, Any],
                        frames: list[dict[str, Any]], series: dict[str, Any] | None,
                        dem: dict[str, Any] | None, models: list[dict[str, Any]],
                        files: list[dict[str, Any]], engine_version: str) -> dict[str, Any]:
    return {
        "schema": SITE_SCHEMA,
        "engine_version": engine_version,
        "site_id": site["id"],
        "site": site,
        "window": window,
        "polygons": polygons,
        "frames": sorted(frames, key=lambda f: (f["year"], f["date"])),
        "series": series,
        "dem": dem,
        "models": models,
        "files": sorted(files, key=lambda f: f["path"]),
    }


def build_catalog(entries: list[dict[str, Any]], engine_version: str) -> dict[str, Any]:
    return {
        "schema": CATALOG_SCHEMA,
        "engine_version": engine_version,
        "n_sites": len(entries),
        "sites": sorted(entries, key=lambda e: e["site_id"]),
    }


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=1, ensure_ascii=False, sort_keys=False) + "\n", encoding="utf-8")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))
