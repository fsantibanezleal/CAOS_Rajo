"""M7: the random-forest pixel classifier, trained offline, exported to ONNX for the browser.

Data: the training tiles fetched by fetch_tiles.py (Jasansky et al. 2024 geometry and split, Earth
Search pixels). Every tile that touches a Rajo catalog site is held out (research-05 leakage rule).
Features: the 16 per-pixel features of common.rf_features (six bands, four indices, three mineral
ratios, three 3 x 3 textures), mirrored in the browser worker. Labels: the preferred mining polygons.

The forest is bounded (depth, leaf size, tree count) because it ships to the browser as an ONNX
TreeEnsembleClassifier: an unbounded 200-tree forest on two million pixels is hundreds of megabytes.
The bound and the resulting size are recorded in the registry next to the held-out scores.

Outputs (under RAJO_MODELS_ROOT, default models/):
    rf/rf-<version>.onnx          the shipped model (float32 features in, probabilities out)
    rf/rf-<version>.metrics.json  held-out matrix: test, catalog holdout, per mine type; parity result
    rf/rf-<version>.joblib        the scikit-learn estimator (not committed)
    registry.json                 one entry per model version (append or replace)

    python data-pipeline/train/train_rf.py --n-pixels 2000000 --trees 64 --max-depth 12
    python data-pipeline/train/train_rf.py --max-tiles 20 --n-pixels 200000   # smoke
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "data-pipeline"))
sys.path.insert(0, str(REPO / "data-pipeline" / "train"))

from common import (  # noqa: E402
    RF_FEATURES,
    boundary_f1,
    clean_mask,
    confusion,
    load_tile,
    read_index,
    rf_features,
    sample_pixels,
    scores,
    split_tiles,
    valid_mask,
)
from rajo.paths import data_root, models_root  # noqa: E402

VERSION_FILE = REPO / "VERSION"


def _engine_version() -> str:
    return VERSION_FILE.read_text(encoding="utf-8").strip()


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _tile_ok(m: dict, min_clear: float) -> bool:
    return m["data_frac"] >= 0.98 and (1.0 - m["cloud_frac"]) >= min_clear


def gather(tiles: list[dict], tiles_dir: Path, n_pixels: int, seed: int, log) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    per_tile = max(1000, n_pixels // max(1, len(tiles)))
    xs, ys = [], []
    t0 = time.time()
    for i, m in enumerate(tiles):
        t = load_tile(tiles_dir / f"{m['tile_id']}.npz")
        feats = rf_features(t["bands"])
        valid = valid_mask(t["scl"])
        x, y = sample_pixels(feats, t["label"], valid, per_tile, rng)
        xs.append(x)
        ys.append(y)
        if (i + 1) % 25 == 0 or i + 1 == len(tiles):
            log(f"  sampled {i + 1}/{len(tiles)} tiles, {sum(len(v) for v in ys):,} pixels, {(time.time() - t0) / 60:.1f} min")
    x = np.concatenate(xs)
    y = np.concatenate(ys)
    return x, y


def evaluate(model, tiles: list[dict], tiles_dir: Path, log, label: str, threshold: float = 0.5) -> dict:
    """Pixel-pooled and per-tile scores of the cleaned mask over valid pixels; per mine type."""
    pooled = {"tp": 0, "fp": 0, "fn": 0, "tn": 0}
    per_tile = []
    by_type: dict[str, dict] = {}
    t0 = time.time()
    for i, m in enumerate(tiles):
        t = load_tile(tiles_dir / f"{m['tile_id']}.npz")
        feats = rf_features(t["bands"])
        valid = valid_mask(t["scl"])
        x = feats.reshape(feats.shape[0], -1).T
        prob = model.predict_proba(x)[:, 1].reshape(t["label"].shape).astype(np.float32)
        pred = clean_mask(prob, threshold)
        c = confusion(pred, t["label"], valid)
        s = scores(c)
        bf = boundary_f1(pred, t["label"], valid)
        for k in pooled:
            pooled[k] += c[k]
        rec = {"tile_id": m["tile_id"], "minetype": m["minetype"], "holdout": m.get("holdout"), **s, "boundary_f1": bf,
               "label_frac": m["label_frac"], "cloud_frac": m["cloud_frac"]}
        per_tile.append(rec)
        bt = by_type.setdefault(m["minetype"] or "unknown", {"tp": 0, "fp": 0, "fn": 0, "tn": 0, "n": 0})
        for k in ("tp", "fp", "fn", "tn"):
            bt[k] += c[k]
        bt["n"] += 1
        if (i + 1) % 25 == 0 or i + 1 == len(tiles):
            log(f"  {label}: {i + 1}/{len(tiles)} tiles, pooled IoU {scores(pooled)['iou']:.3f}, {(time.time() - t0) / 60:.1f} min")
    finite = [r["iou"] for r in per_tile if np.isfinite(r["iou"])]
    bfs = [r["boundary_f1"] for r in per_tile if np.isfinite(r["boundary_f1"])]
    return {
        "n_tiles": len(tiles),
        "pooled": {**scores(pooled), **pooled},
        "per_tile_mean_iou": float(np.mean(finite)) if finite else float("nan"),
        "per_tile_median_iou": float(np.median(finite)) if finite else float("nan"),
        "boundary_f1_mean": float(np.mean(bfs)) if bfs else float("nan"),
        "by_minetype": {k: {**scores(v), "n_tiles": v["n"]} for k, v in by_type.items()},
        "per_tile": per_tile,
    }


def export_onnx(model, out_path: Path, n_features: int) -> None:
    from skl2onnx import convert_sklearn
    from skl2onnx.common.data_types import FloatTensorType

    onx = convert_sklearn(model, initial_types=[("features", FloatTensorType([None, n_features]))],
                          options={id(model): {"zipmap": False}}, target_opset={"": 17, "ai.onnx.ml": 3})
    out_path.write_bytes(onx.SerializeToString())


def parity(model, onnx_path: Path, x: np.ndarray) -> dict:
    import onnxruntime as ort

    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    name = sess.get_inputs()[0].name
    outs = sess.run(None, {name: x.astype(np.float32)})
    probs = outs[-1]
    p_onnx = probs[:, 1] if probs.ndim == 2 else np.asarray(probs, dtype=np.float32)
    p_skl = model.predict_proba(x)[:, 1]
    diff = np.abs(p_onnx.astype(np.float64) - p_skl.astype(np.float64))
    return {"n": int(len(x)), "max_abs_diff": float(diff.max()), "mean_abs_diff": float(diff.mean()),
            "threshold": 1e-5, "pass": bool(diff.max() < 1e-5)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tiles", default="")
    ap.add_argument("--version", default="v1")
    ap.add_argument("--n-pixels", type=int, default=2_000_000)
    ap.add_argument("--trees", type=int, default=64)
    ap.add_argument("--max-depth", type=int, default=12)
    ap.add_argument("--min-leaf", type=int, default=50)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--min-clear", type=float, default=0.90)
    ap.add_argument("--max-tiles", type=int, default=0, help="smoke: cap every split")
    a = ap.parse_args()

    def log(msg: str) -> None:
        print(f"[rf {time.strftime('%H:%M:%S')}] {msg}", flush=True)

    tiles_dir = Path(a.tiles) if a.tiles else data_root(REPO) / "train" / "tiles"
    index = read_index(tiles_dir)
    splits = split_tiles(index)
    for k in splits:
        splits[k] = [m for m in splits[k] if _tile_ok(m, a.min_clear)]
        if a.max_tiles:
            splits[k] = splits[k][: a.max_tiles]
    log("tiles after the clear filter: " + ", ".join(f"{k} {len(v)}" for k, v in splits.items()))
    if not splits["train"]:
        log("no training tiles")
        return 2

    from sklearn.ensemble import RandomForestClassifier

    log(f"sampling {a.n_pixels:,} pixels from {len(splits['train'])} training tiles")
    x, y = gather(splits["train"], tiles_dir, a.n_pixels, a.seed, log)
    log(f"fit: {len(x):,} pixels, positives {y.mean():.3f}, {a.trees} trees, depth {a.max_depth}, leaf {a.min_leaf}")
    t0 = time.time()
    model = RandomForestClassifier(n_estimators=a.trees, max_depth=a.max_depth, min_samples_leaf=a.min_leaf,
                                   class_weight="balanced", n_jobs=-1, random_state=a.seed)
    model.fit(x, y)
    fit_s = time.time() - t0
    log(f"fit done in {fit_s / 60:.1f} min; OOB not used; feature importances:")
    imps = sorted(zip(RF_FEATURES, model.feature_importances_.tolist(), strict=True), key=lambda t: -t[1])
    for name, imp in imps:
        log(f"    {name:12s} {imp:.4f}")

    out_dir = models_root(REPO) / "rf"
    out_dir.mkdir(parents=True, exist_ok=True)
    onnx_path = out_dir / f"rf-{a.version}.onnx"
    export_onnx(model, onnx_path, len(RF_FEATURES))
    log(f"onnx: {onnx_path.name} {onnx_path.stat().st_size / 1e6:.1f} MB")

    # parity on held-out pixels (validation tiles), the gate that the browser sees the same forest
    rng = np.random.default_rng(a.seed + 1)
    xv, _yv = gather(splits["val"][: max(1, min(20, len(splits["val"])))], tiles_dir, 100_000, a.seed + 1, log) \
        if splits["val"] else (x[rng.choice(len(x), min(100_000, len(x)), replace=False)], None)
    par = parity(model, onnx_path, xv)
    log(f"parity sklearn vs onnxruntime on {par['n']:,} pixels: max |dp| {par['max_abs_diff']:.2e} -> {'PASS' if par['pass'] else 'FAIL'}")

    metrics = {"model": "rf", "version": a.version, "engine_version": _engine_version(),
               "params": {"trees": a.trees, "max_depth": a.max_depth, "min_samples_leaf": a.min_leaf, "seed": a.seed,
                          "n_pixels": int(len(x)), "positive_share": float(y.mean()), "min_clear": a.min_clear,
                          "class_weight": "balanced"},
               "features": list(RF_FEATURES), "importances": dict(imps), "fit_seconds": round(fit_s, 1),
               "tiles": {k: len(v) for k, v in splits.items()}, "parity": par}
    for name in ("val", "test", "catalog"):
        if splits[name]:
            log(f"evaluating {name} ({len(splits[name])} tiles)")
            metrics[name] = evaluate(model, splits[name], tiles_dir, log, name)
            p = metrics[name]["pooled"]
            log(f"  {name}: pooled IoU {p['iou']:.3f} F1 {p['f1']:.3f} P {p['precision']:.3f} R {p['recall']:.3f}; "
                f"per-tile mean IoU {metrics[name]['per_tile_mean_iou']:.3f}; boundary F1 {metrics[name]['boundary_f1_mean']:.3f}")
    metrics_path = out_dir / f"rf-{a.version}.metrics.json"
    metrics_path.write_text(json.dumps(metrics, indent=1) + "\n", encoding="utf-8", newline="\n")

    import joblib

    joblib.dump(model, out_dir / f"rf-{a.version}.joblib")

    reg_path = models_root(REPO) / "registry.json"
    reg = json.loads(reg_path.read_text(encoding="utf-8")) if reg_path.exists() else {"schema": "rajo.models/v1", "models": []}
    entry = {"id": f"rf-{a.version}", "method": "M7", "name": "Random forest pixel classifier", "file": f"rf/rf-{a.version}.onnx",
             "bytes": onnx_path.stat().st_size, "sha256": _sha256(onnx_path), "opset": 17, "input": "features[N,16] float32",
             "output": "probabilities[N,2]", "features": list(RF_FEATURES), "training_data": index["source"],
             "pixels": index["pixels"], "split": "published train/val/test; catalog sites held out",
             "params": metrics["params"], "engine_version": metrics["engine_version"],
             "scores": {k: {"pooled_iou": metrics[k]["pooled"]["iou"], "pooled_f1": metrics[k]["pooled"]["f1"],
                            "n_tiles": metrics[k]["n_tiles"]} for k in ("val", "test", "catalog") if k in metrics},
             "parity": par, "license": "MIT (weights); training data CC BY-SA 4.0 (Jasansky et al. 2024)",
             "trained": time.strftime("%Y-%m-%d")}
    reg["models"] = [m for m in reg["models"] if m["id"] != entry["id"]] + [entry]
    reg_path.write_text(json.dumps(reg, indent=1) + "\n", encoding="utf-8", newline="\n")
    log(f"registry updated: {reg_path}")
    return 0 if par["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
