#!/usr/bin/env python3
"""Validate CONTRACT 2 on disk: the artifact contract between the offline bake and the web app.

The catalog index (data/derived/catalog.json) must reference every site manifest; every file a manifest
declares must exist with the declared byte size and sha256; the engine version must be one value across
the whole tree (a partial bake mixing two versions passes every per-site check and is exactly the failure
this script exists to refuse). Stdlib only; exit 1 on any drift. An empty derived tree (no catalog.json)
is reported and accepted only when --allow-empty is passed (the scaffold stage of the repo).
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DERIVED = ROOT / "data" / "derived"


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main(argv: list[str]) -> int:
    allow_empty = "--allow-empty" in argv
    catalog_path = DERIVED / "catalog.json"
    if not catalog_path.exists():
        if allow_empty:
            print("CONTRACT 2: no catalog.json yet (allowed at this stage)")
            return 0
        print(f"FAIL: missing {catalog_path} (run the bake: python data-pipeline/run.py all --release)")
        return 1

    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    errors: list[str] = []
    versions: set[str] = {str(catalog.get("engine_version"))}
    declared = catalog.get("sites", [])
    if catalog.get("n_sites") != len(declared):
        errors.append(f"catalog n_sites={catalog.get('n_sites')} but {len(declared)} entries declared")

    n_files = 0
    for entry in declared:
        mp = DERIVED / entry["manifest_path"]
        if not mp.exists():
            errors.append(f"missing manifest: {mp}")
            continue
        m = json.loads(mp.read_text(encoding="utf-8"))
        versions.add(str(m.get("engine_version")))
        if m.get("site_id") != entry["site_id"]:
            errors.append(f"{mp}: site_id {m.get('site_id')} != index {entry['site_id']}")
        for f in m.get("files", []):
            p = DERIVED / f["path"]
            n_files += 1
            if not p.exists():
                errors.append(f"missing file: {p}")
                continue
            size = p.stat().st_size
            if size == 0:
                errors.append(f"empty file: {p}")
            if size != f["bytes"]:
                errors.append(f"byte drift {p}: manifest={f['bytes']} disk={size}")
            if f.get("sha256") and sha256_of(p) != f["sha256"]:
                errors.append(f"sha256 drift {p}")
            if p.suffix in (".json", ".geojson") and b"\r" in p.read_bytes():
                errors.append(f"CR bytes in text artifact {p}: text artifacts are LF")

    if len(versions) != 1:
        errors.append(f"mixed engine versions across the tree: {sorted(versions)} (partial bake)")

    if errors:
        print("CONTRACT 2 DRIFT:")
        for e in errors:
            print("  -", e)
        return 1
    print(f"CONTRACT 2 OK: {len(declared)} sites, {n_files} files, engine {versions.pop()}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
