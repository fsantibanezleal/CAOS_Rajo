"""Stage validate: the completeness gate over an exported tree. It re-reads every manifest, checks every
declared file (existence, byte size, sha256), the single engine version, and, for each site, that the
frames cover every year from first_year to the bake's last year with either a frame or an explicit
recorded reason (a missing cell is a failure, never an average that silently omits it).
"""
from __future__ import annotations

from ..manifest import read_json, sha256_of

LAST_YEAR = 2026


def run_stage(ctx) -> None:
    cat = ctx.catalog_path
    if not cat.exists():
        raise FileNotFoundError(f"{cat} missing: run export first")
    catalog = read_json(cat)
    errors: list[str] = []
    versions = {catalog["engine_version"]}
    n_files = 0
    for e in catalog["sites"]:
        mp = ctx.output / e["manifest_path"]
        if not mp.exists():
            errors.append(f"missing manifest {mp}")
            continue
        m = read_json(mp)
        versions.add(m["engine_version"])
        for f in m["files"]:
            p = ctx.output / f["path"]
            n_files += 1
            if not p.exists():
                errors.append(f"{e['site_id']}: missing {f['path']}")
                continue
            if p.stat().st_size != f["bytes"]:
                errors.append(f"{e['site_id']}: byte drift {f['path']}")
            elif sha256_of(p) != f["sha256"]:
                errors.append(f"{e['site_id']}: sha256 drift {f['path']}")
        years_have = {fr["year"] for fr in m["frames"]}
        gaps = (m.get("series") or {}).get("gaps", {}) if m.get("series") else {}
        if m["frames"]:
            for y in range(m["site"]["first_year"], LAST_YEAR + 1):
                if y not in years_have and str(y) not in gaps:
                    errors.append(f"{e['site_id']}: year {y} has neither a frame nor a recorded gap reason")
    if len(versions) != 1:
        errors.append(f"mixed engine versions {sorted(versions)}")
    if errors:
        for err in errors:
            ctx.log(f"VALIDATE: {err}")
        raise ValueError(f"validation failed with {len(errors)} error(s)")
    ctx.log(f"VALIDATE OK: {len(catalog['sites'])} sites, {n_files} files, engine {versions.pop()}")
