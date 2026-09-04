"""The orchestrator: runs the named stages in order over the requested sites.

Every stage is a function ``stage(ctx) -> None`` that reads its inputs from the context and writes its
outputs under ``ctx.output``. The context carries the site list, the output root, the data root, the
resume flag and the engine version. Stages are imported lazily so that ``run.py --help`` and the
catalog stage work without the heavy raster dependencies being importable.
"""
from __future__ import annotations

import importlib
import json
import time
from dataclasses import dataclass, field
from pathlib import Path

from . import engine_version
from .paths import data_root, models_root

# The stages that exist today, in run order. The bake grows unit by unit (scenes and frames, masks, series,
# dem); a name enters this tuple only when its module is real, never before.
STAGES: tuple[str, ...] = ("catalog", "scenes", "frames", "masks", "series", "dense", "dem", "export", "validate")
# Stages that only ADD per-site side-cars on top of complete frames (resumable, never a partial frames
# tree) may run alone into the canonical tree; validate still enforces completeness afterwards.
DERIVED_STAGES: tuple[str, ...] = ("masks", "series", "dense", "dem")


@dataclass
class Context:
    repo_root: Path
    output: Path
    release: bool
    resume: bool
    sites: list[str]
    limit_years: int
    years: set[int] = field(default_factory=set)
    redo: list[str] = field(default_factory=list)  # masks stage: methods recomputed even when present
    engine_version: str = field(default_factory=engine_version)

    def wants_year(self, year: int) -> bool:
        return not self.years or year in self.years

    @property
    def data_root(self) -> Path:
        return data_root(self.repo_root)

    @property
    def models_root(self) -> Path:
        return models_root(self.repo_root)

    @property
    def sites_dir(self) -> Path:
        return self.output / "sites"

    @property
    def catalog_path(self) -> Path:
        return self.output / "catalog.json"

    def site_dir(self, site_id: str) -> Path:
        d = self.sites_dir / site_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    def log(self, msg: str) -> None:
        print(f"[rajo {time.strftime('%H:%M:%S')}] {msg}", flush=True)


def _stage_fn(name: str):
    module = importlib.import_module(f"rajo.stages.{name}")
    return module.run_stage


def run(*, stage: str, sites: list[str], output: Path, release: bool, resume: bool,
        limit_years: int, repo_root: Path, years: set[int] | None = None, redo: list[str] | None = None) -> int:
    ctx = Context(repo_root=repo_root, output=output, release=release, resume=resume,
                  sites=sites, limit_years=limit_years, years=set(years or ()), redo=list(redo or ()))
    ctx.output.mkdir(parents=True, exist_ok=True)
    names = list(STAGES) if stage == "all" else [stage]
    ctx.log(f"engine {ctx.engine_version} | output {ctx.output} | release={release} | sites={sites or 'all'}")

    if release and stage != "all" and stage not in ("export", "validate", *DERIVED_STAGES):
        # A single stage into the canonical tree is how a partial bake happens; allow it only for the
        # final assembly stages that re-read everything and re-validate, and for the derived stages that
        # add side-cars on top of complete frames.
        ctx.log("refusing: --release accepts only 'all', 'export', 'validate' or a derived stage (masks, series, dense, dem); "
                "a partial canonical bake of frames is a defect")
        return 2

    for name in names:
        t0 = time.time()
        ctx.log(f"stage {name}: start")
        try:
            _stage_fn(name)(ctx)
        except Exception as exc:  # the stage reports, the orchestrator stops the chain
            ctx.log(f"stage {name}: FAILED ({type(exc).__name__}: {exc})")
            raise
        ctx.log(f"stage {name}: done in {time.time() - t0:.1f}s")

    report = {"engine_version": ctx.engine_version, "stages": names, "sites": sites or "all",
              "release": release, "output": str(ctx.output)}
    (ctx.output / "run-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8",
                                                newline="\n")
    return 0
