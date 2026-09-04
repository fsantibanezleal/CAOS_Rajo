"""Rajo offline bake modules (plain scripts, not an installable package).

The engine version is read from the repository VERSION file so the manifests, the CHANGELOG and the
UI never disagree.
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

# The learned lane's shared modules (feature stack, classical mirrors, metrics) live next to the training
# scripts in data-pipeline/train and are plain modules by path; the stages import them by name.
_TRAIN_DIR = REPO_ROOT / "data-pipeline" / "train"
if str(_TRAIN_DIR) not in sys.path:
    sys.path.insert(0, str(_TRAIN_DIR))


def engine_version() -> str:
    return (REPO_ROOT / "VERSION").read_text(encoding="utf-8").strip()


__version__ = engine_version()
