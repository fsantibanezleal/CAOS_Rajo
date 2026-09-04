#!/usr/bin/env python3
"""Rajo offline bake: the staged pipeline entry point (plain script, invoked by path).

    python data-pipeline/run.py <stage|all> [--sites a,b] [--output DIR | --release] [--resume]

Stages run in the fixed order catalog, scenes, frames, masks, series, dem, export, validate. Without
--release everything is written to a sandbox (default build/local) so the committed evidence under
data/derived is never touched by accident. --release refuses to leave a partial tree behind.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from rajo.pipeline import STAGES, run  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Rajo offline bake")
    parser.add_argument("stage", choices=["all", *STAGES])
    parser.add_argument("--sites", default="", help="comma-separated site ids (default: every site)")
    parser.add_argument("--output", default="build/local", help="sandbox output root (ignored with --release)")
    parser.add_argument("--release", action="store_true", help="write the canonical tree data/derived")
    parser.add_argument("--resume", action="store_true", help="skip site-years already baked")
    parser.add_argument("--limit-years", type=int, default=0, help="bake only the first N years (smoke)")
    parser.add_argument("--years", default="", help="only these years: a list and ranges, e.g. 1990,2012,2023-2025")
    parser.add_argument("--redo", default="", help="masks stage: recompute these methods even when present, e.g. rf,unet (after a threshold or model change)")
    args = parser.parse_args(argv)

    sites = [s.strip() for s in args.sites.split(",") if s.strip()]
    years: set[int] = set()
    for part in [x.strip() for x in args.years.split(",") if x.strip()]:
        if "-" in part:
            a, b = part.split("-", 1)
            years.update(range(int(a), int(b) + 1))
        else:
            years.add(int(part))
    root = HERE.parent
    output = root / "data" / "derived" if args.release else root / args.output
    return run(
        stage=args.stage,
        sites=sites,
        output=output,
        release=args.release,
        resume=args.resume,
        limit_years=args.limit_years,
        years=years,
        repo_root=root,
        redo=[m.strip() for m in args.redo.split(",") if m.strip()],
    )


if __name__ == "__main__":
    sys.exit(main())
