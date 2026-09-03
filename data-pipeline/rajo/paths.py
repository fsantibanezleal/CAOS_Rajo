"""Where the heavy things live. Raw downloads and chips are never in git; the roots are environment
variables with repository-local defaults so a fresh clone works without configuration."""
from __future__ import annotations

import os
from pathlib import Path


def data_root(repo_root: Path) -> Path:
    p = Path(os.environ.get("RAJO_DATA_ROOT", repo_root / "data" / "cache"))
    p.mkdir(parents=True, exist_ok=True)
    return p


def models_root(repo_root: Path) -> Path:
    p = Path(os.environ.get("RAJO_MODELS_ROOT", repo_root / "models"))
    p.mkdir(parents=True, exist_ok=True)
    return p


def raw_dir(repo_root: Path, name: str) -> Path:
    p = data_root(repo_root) / "raw" / name
    p.mkdir(parents=True, exist_ok=True)
    return p
