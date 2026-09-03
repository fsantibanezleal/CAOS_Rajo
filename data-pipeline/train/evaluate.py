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

    thresholds = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]

    def run_split(name: str, tiles: list[dict], sam_angle: float | None, thr: dict[str, float] | None) -> dict:
        """thr None: validation, every probability threshold is scored and the best chosen per learned
        method; otherwise the chosen thresholds (and 0.5 for transparency) are applied."""
        rows: dict[str, list[dict]] = {"otsu": [], "kmeans": [], "sam": [], "rf": [], "unet": []}
        sam_grid: dict[float, list[dict]] = {ang: [] for ang in angles} if sam_angle is None else {}
        thr_grid: dict[str, dict[float, list[dict]]] = {"rf": {x: [] for x in thresholds}, "unet": {x: [] for x in thresholds}}
        at_half: dict[str, list[dict]] = {"rf": [], "unet": []}
        haze: dict[str, dict[float, list[dict]]] = {"rf": {h: [] for h in HAZE_LEVELS}, "unet": {h: [] for h in HAZE_LEVELS}}
        t0 = time.time()
        for i, m in enumerate(tiles):
            t = load_tile(tiles_dir / f"{m['tile_id']}.npz")
            bands, gt, valid = t["bands"], t["label"], valid_mask(t["scl"])
            base = {"tile_id": m["tile_id"], "minetype": m["minetype"] or "unknown", "holdout": m.get("holdout")}
            mask, otsu_t = otsu_mask(bands, valid)
            rows["otsu"].append({**base, "threshold": otsu_t, **score_mask(mask, gt, valid)})
            mask, cluster = kmeans_mask(bands, valid)
            rows["kmeans"].append({**base, "cluster": cluster, **score_mask(mask, gt, valid)})
            if sam_angle is None:
                for ang in angles:
                    sam_grid[ang].append({**base, **score_mask(sam_mask(bands, valid, gt.astype(bool), ang), gt, valid)})
            else:
                rows["sam"].append({**base, "angle_rad": sam_angle, **score_mask(sam_mask(bands, valid, gt.astype(bool), sam_angle), gt, valid)})
            for key, fn in (("rf", runner.rf_prob if runner.rf is not None else None), ("unet", runner.unet_prob if runner.unet is not None else None)):
                if fn is None:
                    continue
                prob = fn(bands)
                if thr is None:
                    for x in thresholds:
                        thr_grid[key][x].append({**base, **score_mask(clean_mask(prob, x), gt, valid)})
                else:
                    rows[key].append({**base, "threshold": thr[key], **score_mask(clean_mask(prob, thr[key]), gt, valid)})
                    at_half[key].append({**base, **score_mask(clean_mask(prob, 0.5), gt, valid)})
                    for h in HAZE_LEVELS:
                        p = fn(bands + np.float32(h)) if h else prob
                        haze[key][h].append({**base, **score_mask(clean_mask(p, thr[key]), gt, valid)})
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
        if thr is None:
            out["threshold_chosen"] = {}
            for key, grid in thr_grid.items():
                if not any(grid.values()):
                    continue
                out[f"{key}_threshold_grid"] = {str(x): aggregate(v)["pooled"]["iou"] for x, v in grid.items() if v}
                best_t = max((x for x in grid if grid[x]), key=lambda x: aggregate(grid[x])["pooled"]["iou"])
                out["threshold_chosen"][key] = best_t
                out["methods"][key] = {**aggregate(grid[best_t]), "by_minetype": by_minetype(grid[best_t]), "per_tile": grid[best_t], "threshold": best_t}
        else:
            out["at_threshold_0.5"] = {k: aggregate(v)["pooled"] for k, v in at_half.items() if v}
        out["haze"] = {k: {str(h): aggregate(v)["pooled"] for h, v in d.items() if v} for k, d in haze.items()}
        return out

    result: dict = {"schema": "rajo.benchmark/v1", "generated": time.strftime("%Y-%m-%d"), "engine_version": (REPO / "VERSION").read_text(encoding="utf-8").strip(),
                    "models": {k: {"id": v["id"], "sha256": v["sha256"]} for k, v in runner.models.items()},
                    "metrics": "pixel-pooled IoU, F1, precision, recall over valid pixels; per-tile mean and median IoU; boundary F1 at 2 px",
                    "rf_features": list(RF_FEATURES), "haze_levels": list(HAZE_LEVELS), "splits": {}}
    val = run_split("val", splits["val"], None, None)
    result["splits"]["val"] = val
    sam_angle = val.get("sam_angle_chosen", 0.10)
    thr = {k: float(v) for k, v in (val.get("threshold_chosen") or {}).items()}
    for key in ("rf", "unet"):
        thr.setdefault(key, 0.5)
    log(f"chosen on validation: SAM angle {sam_angle} rad; thresholds rf {thr['rf']} unet {thr['unet']}")
    result["thresholds"] = thr
    for name in ("test", "catalog"):
        if splits[name]:
            result["splits"][name] = run_split(name, splits[name], sam_angle, thr)
    # the registry carries the validation-chosen threshold so the bake and the app use the same cut
    reg_path = models_dir / "registry.json"
    if reg_path.exists():
        reg = json.loads(reg_path.read_text(encoding="utf-8"))
        for m in reg["models"]:
            key = m["id"].split("-")[0]
            if key in thr and key in runner.models:
                m["threshold"] = thr[key]
                m["threshold_rule"] = "pooled IoU on the validation split over 0.3 to 0.8"
        reg_path.write_text(json.dumps(reg, indent=1) + "\n", encoding="utf-8", newline="\n")
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
