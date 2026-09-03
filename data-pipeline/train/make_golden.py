"""Write the golden fixture that pins the browser's feature stack to the Python one.

A deterministic 12 x 10 synthetic chip (vegetation, a bright bare block, a dark water strip, a no-data
corner) goes through common.rf_features; the bands and the sixteen feature planes are written as JSON to
frontend/src/workers/__fixtures__/rf_features_golden.json, which features.test.ts replays in TypeScript
and compares value for value (1e-5). Re-run whenever the feature definition changes, and commit both.

    python data-pipeline/train/make_golden.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "data-pipeline" / "train"))

from common import RF_FEATURES, rf_features  # noqa: E402


def main() -> int:
    w, h = 12, 10
    rng = np.random.default_rng(11)
    veg = np.array([0.03, 0.05, 0.04, 0.35, 0.18, 0.09], dtype=np.float32)
    bare = np.array([0.18, 0.22, 0.28, 0.34, 0.45, 0.40], dtype=np.float32)
    water = np.array([0.06, 0.07, 0.05, 0.03, 0.01, 0.01], dtype=np.float32)
    bands = np.repeat(veg[:, None, None], h, axis=1).repeat(w, axis=2).copy()
    bands[:, 2:7, 3:9] = bare[:, None, None]
    bands[:, 8:10, :] = water[:, None, None]
    bands += rng.normal(0, 0.003, bands.shape).astype(np.float32)
    bands = np.clip(bands, 0, 1).astype(np.float32)
    bands[:, 0:2, 0:2] = 0.0  # no data: the browser holds NaN here, Python 0
    # the fixture carries six-decimal bands; the planes are computed from exactly those values
    bands = np.round(bands, 6).astype(np.float32)
    feats = rf_features(bands)
    out = {
        "width": w, "height": h, "features": list(RF_FEATURES),
        "bands": {k: bands[i].reshape(-1).round(6).tolist() for i, k in enumerate(("blue", "green", "red", "nir", "swir16", "swir22"))},
        "nodata": [[y, x] for y in range(2) for x in range(2)],
        "planes": {k: feats[i].reshape(-1).astype(float).round(7).tolist() for i, k in enumerate(RF_FEATURES)},
    }
    p = REPO / "frontend" / "src" / "workers" / "__fixtures__" / "rf_features_golden.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(out) + "\n", encoding="utf-8", newline="\n")
    print(f"written {p} ({p.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
