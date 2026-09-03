"""Rajo offline bake modules (plain scripts, not an installable package).

The engine version is read from the repository VERSION file so the manifests, the CHANGELOG and the
UI never disagree.
"""
from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def engine_version() -> str:
    return (REPO_ROOT / "VERSION").read_text(encoding="utf-8").strip()


__version__ = engine_version()
