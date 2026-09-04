"""Export a trained random forest (the joblib next to its ONNX) as the flat-array forest file the browser
traverses, check the Python traversal against scikit-learn on held-out pixels, and record the file in
the registry.

    python data-pipeline/train/export_forest.py --version v1
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "data-pipeline"))
sys.path.insert(0, str(REPO / "data-pipeline" / "train"))

from common import (  # noqa: E402
    RF_FEATURES,
    load_tile,
    read_index,
    rf_features,
    sample_pixels,
    split_tiles,
    valid_mask,
)
from forest_format import export_forest, forest_prob, load_forest  # noqa: E402
from rajo.paths import data_root, models_root  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", default="v1")
    ap.add_argument("--tiles", default="")
    a = ap.parse_args()
    import joblib

    out_dir = models_root(REPO) / "rf"
    model = joblib.load(out_dir / f"rf-{a.version}.joblib")
    path = out_dir / f"rf-{a.version}.forest.bin"
    header = export_forest(model, list(RF_FEATURES), path)
    print(f"[forest] {path.name}: {header['n_trees']} trees, {header['n_nodes']:,} nodes, {path.stat().st_size / 1e6:.1f} MB")

    # parity of the traversal against scikit-learn on 50,000 held-out pixels
    tiles_dir = Path(a.tiles) if a.tiles else data_root(REPO) / "train" / "tiles"
    splits = split_tiles(read_index(tiles_dir))
    rng = np.random.default_rng(3)
    xs = []
    for m in splits["val"][:10]:
        t = load_tile(tiles_dir / f"{m['tile_id']}.npz")
        x, _y = sample_pixels(rf_features(t["bands"]), t["label"], valid_mask(t["scl"]), 5000, rng)
        xs.append(x)
    x = np.concatenate(xs)
    forest = load_forest(path)
    p_ours = forest_prob(forest, x.astype(np.float32))
    p_skl = model.predict_proba(x)[:, 1]
    diff = float(np.abs(p_ours - p_skl).max())
    print(f"[forest] traversal vs scikit-learn on {len(x):,} pixels: max |dp| {diff:.2e} -> {'PASS' if diff < 1e-6 else 'FAIL'}")

    reg_path = models_root(REPO) / "registry.json"
    reg = json.loads(reg_path.read_text(encoding="utf-8"))
    h = hashlib.sha256(path.read_bytes()).hexdigest()
    for m in reg["models"]:
        if m["id"] == f"rf-{a.version}":
            m["file_forest"] = f"rf/{path.name}"
            m["bytes_forest"] = path.stat().st_size
            m["sha256_forest"] = h
            m["forest_parity"] = {"n": int(len(x)), "max_abs_diff": diff, "threshold": 1e-6, "pass": bool(diff < 1e-6)}
            m["browser_runtime"] = "flat-array traversal in the worker (onnxruntime-web has no TreeEnsembleClassifier kernel)"
    reg_path.write_text(json.dumps(reg, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("[forest] registry updated")
    return 0 if diff < 1e-6 else 1


if __name__ == "__main__":
    raise SystemExit(main())
