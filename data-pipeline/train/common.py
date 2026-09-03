"""Shared pieces of the learned lane: tile loading, the per-pixel feature stack of the random forest
(mirrored pixel for pixel in the browser worker, see frontend/src/workers/features.ts), pixel sampling,
and the segmentation metrics used by every method on the held-out matrix.

Feature order is a contract: the ONNX model, the browser worker and the golden fixture all use it.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from scipy import ndimage

CHANNELS = ("blue", "green", "red", "nir", "swir16", "swir22")
RF_FEATURES = (
    "blue", "green", "red", "nir", "swir16", "swir22",
    "ndvi", "mndwi", "bsi", "ndbi",
    "iron", "clay", "ferrous",
    "bsi_mean3", "bsi_std3", "ndvi_mean3",
)
EPS = np.float32(1e-6)
SCL_INVALID = (0, 1, 3, 8, 9, 10)
REFL_SCALE = 10000.0


def load_tile(npz_path: Path) -> dict:
    z = np.load(npz_path)
    bands = z["bands"].astype(np.float32) / np.float32(REFL_SCALE)
    return {"bands": bands, "scl": z["scl"], "label": z["label"].astype(np.uint8)}


def valid_mask(scl: np.ndarray) -> np.ndarray:
    return (scl > 0) & ~np.isin(scl, SCL_INVALID)


def norm_diff(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return (a - b) / (a + b + EPS)


def ratio(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return a / (b + EPS)


def box_mean(x: np.ndarray, k: int = 3) -> np.ndarray:
    return ndimage.uniform_filter(x, size=k, mode="reflect").astype(np.float32)


def box_std(x: np.ndarray, k: int = 3) -> np.ndarray:
    m = box_mean(x, k)
    m2 = box_mean(x * x, k)
    return np.sqrt(np.maximum(m2 - m * m, 0.0)).astype(np.float32)


def rf_features(bands: np.ndarray) -> np.ndarray:
    """bands (6, H, W) reflectance -> (16, H, W) float32 in RF_FEATURES order."""
    blue, green, red, nir, swir16, swir22 = (bands[i] for i in range(6))
    ndvi = norm_diff(nir, red)
    mndwi = norm_diff(green, swir16)
    bsi = ((swir16 + red) - (nir + blue)) / ((swir16 + red) + (nir + blue) + EPS)
    ndbi = norm_diff(swir16, nir)
    iron = ratio(red, blue)
    clay = ratio(swir16, swir22)
    ferrous = ratio(swir22, nir)  # B12 / B8A, the documented ferrous ratio (docs/methods/02)
    feats = np.stack([
        blue, green, red, nir, swir16, swir22,
        ndvi, mndwi, bsi, ndbi,
        iron, clay, ferrous,
        box_mean(bsi), box_std(bsi), box_mean(ndvi),
    ]).astype(np.float32)
    return feats


def sample_pixels(feats: np.ndarray, label: np.ndarray, valid: np.ndarray, n: int, rng: np.random.Generator,
                  positive_share: float = 0.5) -> tuple[np.ndarray, np.ndarray]:
    """Draws up to n valid pixels, positives and negatives in the requested share (falls back to what exists)."""
    pos = np.flatnonzero(valid & (label == 1))
    neg = np.flatnonzero(valid & (label == 0))
    n_pos = min(len(pos), int(round(n * positive_share)))
    n_neg = min(len(neg), n - n_pos)
    if n_pos < int(round(n * positive_share)):
        n_neg = min(len(neg), n - n_pos)
    idx = np.concatenate([rng.choice(pos, n_pos, replace=False) if n_pos else pos[:0],
                          rng.choice(neg, n_neg, replace=False) if n_neg else neg[:0]])
    f = feats.reshape(feats.shape[0], -1)[:, idx].T
    y = label.reshape(-1)[idx]
    return f.astype(np.float32), y.astype(np.uint8)


def confusion(pred: np.ndarray, gt: np.ndarray, valid: np.ndarray) -> dict:
    p = pred.astype(bool)[valid]
    g = gt.astype(bool)[valid]
    tp = int(np.sum(p & g))
    fp = int(np.sum(p & ~g))
    fn = int(np.sum(~p & g))
    tn = int(np.sum(~p & ~g))
    return {"tp": tp, "fp": fp, "fn": fn, "tn": tn}


def scores(c: dict) -> dict:
    tp, fp, fn = c["tp"], c["fp"], c["fn"]
    iou = tp / (tp + fp + fn) if (tp + fp + fn) else float("nan")
    prec = tp / (tp + fp) if (tp + fp) else float("nan")
    rec = tp / (tp + fn) if (tp + fn) else float("nan")
    f1 = 2 * prec * rec / (prec + rec) if (prec + rec) and not (np.isnan(prec) or np.isnan(rec)) else float("nan")
    return {"iou": iou, "f1": f1, "precision": prec, "recall": rec}


def boundary_f1(pred: np.ndarray, gt: np.ndarray, valid: np.ndarray, tol_px: int = 2) -> float:
    """Boundary F1 (Csurka et al. 2013 style): a boundary pixel counts as matched when the other set has a
    boundary pixel within tol_px. Boundaries of invalid regions are ignored."""
    def edges(m: np.ndarray) -> np.ndarray:
        m = m.astype(bool)
        er = ndimage.binary_erosion(m, border_value=0)
        return m & ~er & valid
    ep, eg = edges(pred), edges(gt)
    if not ep.any() and not eg.any():
        return float("nan")
    if not ep.any() or not eg.any():
        return 0.0
    dg = ndimage.distance_transform_edt(~eg)
    dp = ndimage.distance_transform_edt(~ep)
    prec = float(np.mean(dg[ep] <= tol_px))
    rec = float(np.mean(dp[eg] <= tol_px))
    return 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0


def clean_mask(prob: np.ndarray, threshold: float = 0.5, min_px: int = 25) -> np.ndarray:
    """The same clean-up the browser applies to every mask: threshold, open (3 x 3), drop small blobs."""
    m = prob >= threshold
    m = ndimage.binary_opening(m, structure=np.ones((3, 3), dtype=bool))
    lab, n = ndimage.label(m)
    if n:
        sizes = ndimage.sum(m, lab, index=np.arange(1, n + 1))
        keep = np.zeros(n + 1, dtype=bool)
        keep[1:] = sizes >= min_px
        m = keep[lab]
    return m


def read_index(tiles_dir: Path) -> dict:
    return json.loads((tiles_dir / "index.json").read_text(encoding="utf-8"))


def split_tiles(index: dict) -> dict[str, list[dict]]:
    """train / val / test keep the published split minus every tile that touches a catalog site; those go
    to 'catalog' and are evaluated only."""
    out: dict[str, list[dict]] = {"train": [], "val": [], "test": [], "catalog": []}
    for m in index["tiles"]:
        if m.get("holdout"):
            out["catalog"].append(m)
        else:
            out[m["split"]].append(m)
    return out
