#!/usr/bin/env python3
"""Repository integrity guards for Rajo. Exit 1 on any failure, printing what and where.

Checks (each one a defect that has shipped in a sibling product):
  1. VERSION, frontend/package.json and the newest CHANGELOG entry agree (display X.XX.XXX vs semver).
  2. Every tracked .sh file carries the executable bit (mode 100755), so a Linux clone can run it.
  3. No local machine path leaks into tracked files (a D:\\_Repos style path or an E:\\_Datos path).
  4. No directional arrow glyph in user-visible product strings (frontend/src/locales), per ADR-0067.
  5. No real .env, virtualenv, native binary or heavy data file is tracked.
Stdlib only, so it runs in CI before anything is installed.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

ARROWS = {0x2190, 0x2192, 0x2194, 0x21D0, 0x21D2, 0x27F5, 0x27F6}
LOCAL_PATH = re.compile(r"[A-Za-z]:\\_(Repos|Datos|Models|Temp)")


def tracked() -> list[tuple[str, str]]:
    out = subprocess.run(["git", "ls-files", "-s"], cwd=ROOT, capture_output=True, text=True, check=True)
    rows = []
    for line in out.stdout.splitlines():
        mode, _sha, _stage, path = line.split(maxsplit=3)
        rows.append((mode, path))
    return rows


def display_to_semver(display: str) -> str:
    major, minor, patch = display.split(".")
    return f"{int(major)}.{int(minor)}.{int(patch)}"


def main() -> int:
    errors: list[str] = []

    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"\d+\.\d{2}\.\d{3}", version):
        errors.append(f"VERSION '{version}' is not X.XX.XXX")
    pkg = json.loads((ROOT / "frontend" / "package.json").read_text(encoding="utf-8"))
    if pkg.get("version") != display_to_semver(version):
        errors.append(f"frontend/package.json version {pkg.get('version')} != VERSION {version} (semver form)")
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    m = re.search(r"^## \[(\d+\.\d{2}\.\d{3})\]", changelog, re.M)
    if not m or m.group(1) != version:
        errors.append(f"CHANGELOG newest entry {m.group(1) if m else None} != VERSION {version}")
    # the display version is injected at build time from VERSION; a literal copy in the source went
    # stale on the first deploy (the footer printed 0.01.000 for 0.02.000)
    version_ts = ROOT / "frontend" / "src" / "lib" / "version.ts"
    if version_ts.exists() and re.search(r"\d\.\d\d\.\d\d\d", version_ts.read_text(encoding="utf-8").replace("0.00.000", "")):
        errors.append("frontend/src/lib/version.ts carries a version literal; it must come from VERSION through vite's define")

    rows = tracked()
    for mode, path in rows:
        if path.endswith(".sh") and mode != "100755":
            errors.append(f"{path}: tracked with mode {mode}, must be 100755 (git update-index --chmod=+x)")
        low = path.lower()
        if re.search(r"(^|/)\.env(\..+)?$", low) and not low.endswith(".env.example"):
            errors.append(f"{path}: a real .env is tracked")
        if re.search(r"(^|/)\.?venv", low) or low.endswith((".dll", ".so", ".dylib", ".pt", ".pth", ".ckpt")):
            errors.append(f"{path}: virtualenv or native/heavy binary tracked")
        if low.endswith((".parquet", ".h5", ".hdf5", ".nc", ".npy", ".npz", ".tif", ".tiff", ".gpkg", ".rar")):
            errors.append(f"{path}: raw or heavy data tracked (commit only compact derived artifacts)")

    text_suffixes = (".py", ".ts", ".tsx", ".js", ".mjs", ".md", ".json", ".yml", ".yaml", ".toml",
                     ".txt", ".css", ".html", ".svg", ".sh", ".ps1", ".cfg", ".ini")
    for _mode, path in rows:
        if not path.endswith(text_suffixes) or path == "scripts/check_repo_standards.py":
            continue
        try:
            text = (ROOT / path).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        if LOCAL_PATH.search(text):
            errors.append(f"{path}: leaked local machine path")
        if path.startswith("frontend/src/locales/"):
            for lineno, line in enumerate(text.splitlines(), 1):
                if any(ord(ch) in ARROWS for ch in line):
                    errors.append(f"{path}:{lineno}: arrow glyph in user-visible prose (write the word)")

    if errors:
        print("::error::repository standards failed:")
        for e in errors:
            print("  -", e)
        return 1
    print(f"check_repo_standards: OK ({len(rows)} tracked files, version {version})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
