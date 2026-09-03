"""The orchestrator refuses a partial canonical bake and every named stage module exists."""
from __future__ import annotations

import importlib
import pathlib

from rajo import engine_version
from rajo.pipeline import STAGES, run

REPO = pathlib.Path(__file__).resolve().parents[1]


def test_engine_version_matches_version_file():
    assert engine_version() == (REPO / "VERSION").read_text(encoding="utf-8").strip()


def test_every_stage_module_exists():
    for name in STAGES:
        mod = importlib.import_module(f"rajo.stages.{name}")
        assert callable(mod.run_stage), name


def test_release_refuses_a_single_stage(sandbox: pathlib.Path):
    code = run(stage="frames", sites=[], output=sandbox, release=True, resume=False,
               limit_years=0, repo_root=REPO)
    assert code == 2
