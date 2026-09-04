"""Harvest the frames baked by parallel workers into the canonical tree, then run export and validate.

The frames stage is embarrassingly parallel per site, but a single-stage ``--release`` run is refused by
design (a partial canonical bake is a defect). Workers therefore write into ONE sandbox root on
disjoint site lists, and this script moves their per-site outputs (``frames/`` and ``frames.json``) into
``data/derived``, refusing any site whose ``frames.json`` is missing or whose frame files are not all on
disk, and then runs the canonical ``export`` and ``validate`` stages so the manifests, hashes and the
catalog are rebuilt from what is really on disk.

    python data-pipeline/harvest.py --from build/par            # every site found in the sandbox
    python data-pipeline/harvest.py --from build/par --sites antamina,centinela
    python data-pipeline/harvest.py --from build/par --dry-run
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "data-pipeline"))

from rajo.pipeline import run  # noqa: E402


def _complete(site_dir: Path) -> tuple[bool, str]:
    fj = site_dir / "frames.json"
    if not fj.exists():
        return False, "no frames.json"
    doc = json.loads(fj.read_text(encoding="utf-8"))
    missing = []
    for f in doc.get("frames", []):
        for key in ("image", "swir_image"):
            rel = f.get(key)
            if rel and not (site_dir / rel).exists():
                missing.append(rel)
    if missing:
        return False, f"{len(missing)} frame files named in frames.json are missing (first: {missing[0]})"
    years = json.loads((site_dir / "scenes.json").read_text(encoding="utf-8"))["years"]
    covered = {int(f["year"]) for f in doc.get("frames", [])} | {int(y) for y in doc.get("gaps", {})}
    pending = sorted(int(y) for y in years if int(y) not in covered)
    if pending:
        return False, f"{len(pending)} years neither baked nor declared a gap (first: {pending[0]})"
    return True, f"{len(doc.get('frames', []))} frames, {len(doc.get('gaps', {}))} gaps"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="src", required=True, help="sandbox root the workers wrote to")
    ap.add_argument("--sites", default="", help="comma-separated site ids (default: every complete site)")
    ap.add_argument("--dry-run", action="store_true", help="report, move nothing, run nothing")
    ap.add_argument("--no-stages", action="store_true", help="move only; skip export and validate")
    a = ap.parse_args()
    src = (REPO / a.src).resolve() if not Path(a.src).is_absolute() else Path(a.src)
    dst = REPO / "data" / "derived" / "sites"
    wanted = [s for s in a.sites.split(",") if s] or sorted(p.name for p in (src / "sites").iterdir() if p.is_dir())
    moved, refused = [], []
    for site in wanted:
        sdir = src / "sites" / site
        ok, why = _complete(sdir)
        if not ok:
            refused.append((site, why))
            print(f"refused {site}: {why}")
            continue
        print(f"harvest {site}: {why}")
        if a.dry_run:
            continue
        target = dst / site
        target.mkdir(parents=True, exist_ok=True)
        if (target / "frames").exists():
            shutil.rmtree(target / "frames")
        shutil.copytree(sdir / "frames", target / "frames")
        shutil.copy2(sdir / "frames.json", target / "frames.json")
        moved.append(site)
    print(f"harvested {len(moved)} sites, refused {len(refused)}")
    if a.dry_run or a.no_stages or not moved:
        return 1 if refused and not moved else 0
    for stage in ("export", "validate"):
        run(stage=stage, sites=[], output=REPO / "data" / "derived", release=True, resume=True,
            limit_years=0, years=[], repo_root=REPO)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
