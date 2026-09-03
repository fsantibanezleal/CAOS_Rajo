"""The held-out matrix: every delineation method scored on the same tiles with the same metrics.

Methods: M4 Otsu bare-ground mask, M5 k-means (benchmark cluster rule), M6 SAM (reference endmember,
angle chosen on validation), M7 random forest (ONNX, the shipped file), M8 U-Net (ONNX fp32, the shipped
file). Splits: validation (used only to choose the SAM angle and the RF/U-Net thresholds), test (the
published test split minus catalog tiles), catalog (tiles that touch a Rajo site window, never seen in
training). Metrics: pixel-pooled IoU, F1, precision, recall; per-tile mean and median IoU; boundary F1 at
2 px; per mine type; the degradation curve of the learned methods under added haze (constant
reflectance added to every band). Output: models/benchmark.json, consumed by the app's Methods page and
the model cards. The worse arm is what the docs quote.

    python data-pipeline/train/evaluate.py
    python data-pipeline/train/evaluate.py --max-tiles 10        # smoke
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "data-pipeline"))
sys.path.insert(0, str(REPO / "data-pipeline" / "train"))

from baselines import kmeans_mask, otsu_mask, sam_mask  # noqa: E402
from common import (  # noqa: E402
    RF_FEATURES,
    boundary_f1,
    clean_mask,
    confusion,
    load_tile,
    read_index,
    rf_features,
    scores,
    split_tiles,
    valid_mask,
)
from rajo.paths import data_root, models_root  # noqa: E402

HAZE_LEVELS = (0.0, 0.02, 0.05, 0.10)


def log(msg: str) -> None:
    print(f"[bench {time.strftime('%H:%M:%S')}] {msg}", flush=True)


class Runner:
    def __init__(self, models_dir: Path):
        import onnxruntime as ort

        reg = json.loads((models_dir / "registry.json").read_text(encoding="utf-8"))
        self.models = {m["id"].split("-")[0]: m for m in reg["models"]}
        self.rf = ort.InferenceSession(str(models_dir / self.models["rf"]["file"]), providers=["CPUExecutionProvider"]) if "rf" in self.models else None
        self.unet = ort.InferenceSession(str(models_dir / self.models["unet"]["file"]), providers=["CPUExecutionProvider"]) if "unet" in self.models else None

    def rf_prob(self, bands: np.ndarray) -> np.ndarray:
        feats = rf_features(bands)
        x = feats.reshape(feats.shape[0], -1).T.astype(np.float32)
        out = []
        for i in range(0, len(x), 262144):
            probs = self.rf.run(None, {self.rf.get_inputs()[0].name: x[i:i + 262144]})[-1]
            out.append(probs[:, 1] if probs.ndim == 2 else probs)
        return np.concatenate(out).reshape(bands.shape[1:]).astype(np.float32)

    def unet_prob(self, bands: np.ndarray, window: int = 512, overlap: int = 64) -> np.ndarray:
        x = np.clip(bands, 0.0, 0.6) / 0.6
        _, h, w = x.shape
        prob = np.zeros((h, w), dtype=np.float32)
        weight = np.zeros((h, w), dtype=np.float32)
        ramp = np.ones(window, dtype=np.float32)
        r = 0.5 * (1.0 - np.cos(np.linspace(0, np.pi, overlap, dtype=np.float32)))
        ramp[:overlap] = r
        ramp[-overlap:] = r[::-1]
        w2d = ramp[:, None] * ramp[None, :]
        step = window - overlap
        ys = list(range(0, max(1, h - window + 1), step))
        xs = list(range(0, max(1, w - window + 1), step))
        if ys[-1] + window < h:
            ys.append(h - window)
        if xs[-1] + window < w:
            xs.append(w - window)
        name = self.unet.get_inputs()[0].name
        for y0 in ys:
            for x0 in xs:
                patch = x[None, :, y0:y0 + window, x0:x0 + window].astype(np.float32)
                logits = self.unet.run(None, {name: patch})[0][0, 0]
                p = 1.0 / (1.0 + np.exp(-logits))
                prob[y0:y0 + window, x0:x0 + window] += p * w2d
                weight[y0:y0 + window, x0:x0 + window] += w2d
        return prob / np.maximum(weight, 1e-6)


def score_mask(pred: np.ndarray, gt: np.ndarray, valid: np.ndarray) -> dict:
    c = confusion(pred, gt, valid)
    return {**scores(c), **c, "boundary_f1": boundary_f1(pred, gt, valid)}


def aggregate(rows: list[dict]) -> dict:
    pooled = {k: int(sum(r[k] for r in rows)) for k in ("tp", "fp", "fn", "tn")}
    ious = [r["iou"] for r in rows if np.isfinite(r["iou"])]
    bfs = [r["boundary_f1"] for r in rows if np.isfinite(r["boundary_f1"])]
    return {"n_tiles": len(rows), "pooled": {**scores(pooled), **pooled},
            "per_tile_mean_iou": float(np.mean(ious)) if ious else float("nan"),
            "per_tile_median_iou": float(np.median(ious)) if ious else float("nan"),
            "boundary_f1_mean": float(np.mean(bfs)) if bfs else float("nan")}


def by_minetype(rows: list[dict]) -> dict:
    out = {}
    for mt in sorted({r["minetype"] for r in rows}):
        out[mt] = aggregate([r for r in rows if r["minetype"] == mt])
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tiles", default="")
    ap.add_argument("--max-tiles", type=int, default=0)
    ap.add_argument("--sam-angles", default="0.05,0.08,0.10,0.12,0.15,0.20,0.25")
    ap.add_argument("--out", default="")
    a = ap.parse_args()
    root = data_root(REPO)
    tiles_dir = Path(a.tiles) if a.tiles else root / "train" / "tiles"
    models_dir = models_root(REPO)
    runner = Runner(models_dir)
    splits = split_tiles(read_index(tiles_dir))
    for k in splits:
        splits[k] = [m for m in splits[k] if m["data_frac"] >= 0.98 and m["cloud_frac"] <= 0.10]
        if a.max_tiles:
            splits[k] = splits[k][: a.max_tiles]
    log("tiles: " + ", ".join(f"{k} {len(v)}" for k, v in splits.items()))
    angles = [float(x) for x in a.sam_angles.split(",")]

    def run_split(name: str, tiles: list[dict], sam_angle: float | None) -> dict:
        rows: dict[str, list[dict]] = {"otsu": [], "kmeans": [], "sam": [], "rf": [], "unet": []}
        sam_grid: dict[float, list[dict]] = {ang: [] for ang in angles} if sam_angle is None else {}
        haze: dict[str, dict[float, list[dict]]] = {"rf": {h: [] for h in HAZE_LEVELS}, "unet": {h: [] for h in HAZE_LEVELS}}
        t0 = time.time()
        for i, m in enumerate(tiles):
            t = load_tile(tiles_dir / f"{m['tile_id']}.npz")
            bands, gt, valid = t["bands"], t["label"], valid_mask(t["scl"])
            base = {"tile_id": m["tile_id"], "minetype": m["minetype"] or "unknown", "holdout": m.get("holdout")}
            mask, thr = otsu_mask(bands, valid)
            rows["otsu"].append({**base, "threshold": thr, **score_mask(mask, gt, valid)})
            mask, cluster = kmeans_mask(bands, valid)
            rows["kmeans"].append({**base, "cluster": cluster, **score_mask(mask, gt, valid)})
            if sam_angle is None:
                for ang in angles:
                    sam_grid[ang].append({**base, **score_mask(sam_mask(bands, valid, gt.astype(bool), ang), gt, valid)})
            else:
                rows["sam"].append({**base, "angle_rad": sam_angle, **score_mask(sam_mask(bands, valid, gt.astype(bool), sam_angle), gt, valid)})
            if runner.rf is not None:
                for h in HAZE_LEVELS:
                    prob = runner.rf_prob(bands + np.float32(h)) if h else runner.rf_prob(bands)
                    rec = {**base, **score_mask(clean_mask(prob), gt, valid)}
                    haze["rf"][h].append(rec)
                    if h == 0.0:
                        rows["rf"].append(rec)
            if runner.unet is not None:
                for h in HAZE_LEVELS:
                    prob = runner.unet_prob(bands + np.float32(h)) if h else runner.unet_prob(bands)
                    rec = {**base, **score_mask(clean_mask(prob), gt, valid)}
                    haze["unet"][h].append(rec)
                    if h == 0.0:
                        rows["unet"].append(rec)
            if (i + 1) % 10 == 0 or i + 1 == len(tiles):
                log(f"  {name}: {i + 1}/{len(tiles)} tiles, {(time.time() - t0) / 60:.1f} min")
        out: dict = {"n_tiles": len(tiles), "methods": {}}
        for k, v in rows.items():
            if v:
                out["methods"][k] = {**aggregate(v), "by_minetype": by_minetype(v), "per_tile": v}
        if sam_angle is None and sam_grid:
            out["sam_angle_grid"] = {str(ang): aggregate(v)["pooled"]["iou"] for ang, v in sam_grid.items()}
            best = max(sam_grid, key=lambda ang: aggregate(sam_grid[ang])["pooled"]["iou"])
            out["sam_angle_chosen"] = best
            out["methods"]["sam"] = {**aggregate(sam_grid[best]), "by_minetype": by_minetype(sam_grid[best]), "per_tile": sam_grid[best], "angle_rad": best}
        out["haze"] = {k: {str(h): aggregate(v)["pooled"] for h, v in d.items() if v} for k, d in haze.items()}
        return out

    result: dict = {"schema": "rajo.benchmark/v1", "generated": time.strftime("%Y-%m-%d"), "engine_version": (REPO / "VERSION").read_text(encoding="utf-8").strip(),
                    "models": {k: {"id": v["id"], "sha256": v["sha256"]} for k, v in runner.models.items()},
                    "metrics": "pixel-pooled IoU, F1, precision, recall over valid pixels; per-tile mean and median IoU; boundary F1 at 2 px",
                    "rf_features": list(RF_FEATURES), "haze_levels": list(HAZE_LEVELS), "splits": {}}
    val = run_split("val", splits["val"], None)
    result["splits"]["val"] = val
    sam_angle = val.get("sam_angle_chosen", 0.10)
    log(f"SAM angle chosen on validation: {sam_angle} rad")
    for name in ("test", "catalog"):
        if splits[name]:
            result["splits"][name] = run_split(name, splits[name], sam_angle)
    for name, s in result["splits"].items():
        log(f"{name}: " + "; ".join(f"{k} IoU {v['pooled']['iou']:.3f} F1 {v['pooled']['f1']:.3f}" for k, v in s["methods"].items()))
    out_path = Path(a.out) if a.out else models_dir / "benchmark.json"
    slim = json.loads(json.dumps(result))
    for s in slim["splits"].values():
        for v in s["methods"].values():
            v.pop("per_tile", None)
    out_path.write_text(json.dumps(slim, indent=1) + "\n", encoding="utf-8", newline="\n")
    (out_path.with_suffix(".per-tile.json")).write_text(json.dumps(result, indent=0) + "\n", encoding="utf-8", newline="\n")
    log(f"written {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
