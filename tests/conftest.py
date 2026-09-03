"""Make the pipeline modules importable by path (the repository declares no package) and give every
test a sandbox output directory so no test can ever write the committed artifacts."""
from __future__ import annotations

import pathlib
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "data-pipeline"))


@pytest.fixture
def sandbox(tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch) -> pathlib.Path:
    monkeypatch.setenv("RAJO_DATA_ROOT", str(tmp_path / "cache"))
    monkeypatch.setenv("RAJO_MODELS_ROOT", str(tmp_path / "models"))
    out = tmp_path / "out"
    out.mkdir()
    return out
