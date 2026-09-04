"""The forest as plain arrays, the format the browser traverses itself.

onnxruntime-web ships no kernel for ai.onnx.ml TreeEnsembleClassifier (measured 2026-09-03: "No Op
registered for TreeEnsembleClassifier"), so the random forest is exported as flat node arrays and
walked in TypeScript (frontend/src/workers/forest.ts). The ONNX file stays the archival, parity-checked
export; the browser reads this file.

Layout of ``rf-<version>.forest.bin`` (little endian):

    6 bytes  magic  b"RAJOF1"
    4 bytes  uint32 header length
    header   JSON: {n_trees, n_nodes, n_features, features[], offsets[] (node index of each tree's root),
                    rule: "x[feature] <= threshold goes left", class_index: 1}
    int32[n_nodes]   feature   (-1 on a leaf)
    float64[n_nodes] threshold (scikit-learn stores and compares thresholds in float64 against float32
                               features; a float32 threshold re-routes borderline pixels, measured 2026-09-03)
    int32[n_nodes]   left      (absolute node index, -1 on a leaf)
    int32[n_nodes]   right
    float32[n_nodes] value     (probability of the mine class at a leaf, 0 elsewhere)

The forest probability is the mean of the leaf values reached in every tree, exactly scikit-learn's
``predict_proba`` for a RandomForestClassifier with class weights folded into the leaf counts.
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np

MAGIC = b"RAJOF1"


def export_forest(model, feature_names: list[str], path: Path) -> dict:
    feats, thrs, lefts, rights, values, offsets = [], [], [], [], [], []
    base = 0
    for est in model.estimators_:
        t = est.tree_
        n = t.node_count
        offsets.append(base)
        feats.append(t.feature.astype(np.int32))
        thrs.append(t.threshold.astype(np.float64))
        left = t.children_left.astype(np.int32)
        right = t.children_right.astype(np.int32)
        leaf = left < 0
        lefts.append(np.where(leaf, -1, left + base).astype(np.int32))
        rights.append(np.where(leaf, -1, right + base).astype(np.int32))
        counts = t.value[:, 0, :]
        tot = counts.sum(axis=1)
        p1 = np.where(tot > 0, counts[:, 1] / np.maximum(tot, 1e-12), 0.0)
        values.append(np.where(leaf, p1, 0.0).astype(np.float32))
        base += n
    feature = np.concatenate(feats)
    feature[np.concatenate(lefts) < 0] = -1
    header = {"n_trees": len(model.estimators_), "n_nodes": int(base), "n_features": len(feature_names), "features": list(feature_names),
              "offsets": offsets, "rule": "x[feature] <= threshold goes left", "class_index": 1}
    hb = json.dumps(header).encode("utf-8")
    with path.open("wb") as f:
        f.write(MAGIC)
        f.write(struct.pack("<I", len(hb)))
        f.write(hb)
        f.write(feature.tobytes())
        f.write(np.concatenate(thrs).tobytes())
        f.write(np.concatenate(lefts).tobytes())
        f.write(np.concatenate(rights).tobytes())
        f.write(np.concatenate(values).tobytes())
    return header


def load_forest(path: Path) -> dict:
    raw = path.read_bytes()
    assert raw[:6] == MAGIC, "not a Rajo forest file"
    hl = struct.unpack("<I", raw[6:10])[0]
    header = json.loads(raw[10:10 + hl].decode("utf-8"))
    n = header["n_nodes"]
    o = 10 + hl
    feature = np.frombuffer(raw, dtype="<i4", count=n, offset=o)
    o += 4 * n
    threshold = np.frombuffer(raw, dtype="<f8", count=n, offset=o)
    o += 8 * n
    left = np.frombuffer(raw, dtype="<i4", count=n, offset=o)
    o += 4 * n
    right = np.frombuffer(raw, dtype="<i4", count=n, offset=o)
    o += 4 * n
    value = np.frombuffer(raw, dtype="<f4", count=n, offset=o)
    return {"header": header, "feature": feature, "threshold": threshold, "left": left, "right": right, "value": value}


def forest_prob(forest: dict, x: np.ndarray) -> np.ndarray:
    """Reference traversal in Python (used by the parity fixture): x (n, n_features) -> probabilities."""
    feature, threshold, left, right, value = (forest[k] for k in ("feature", "threshold", "left", "right", "value"))
    out = np.zeros(len(x), dtype=np.float64)
    for root in forest["header"]["offsets"]:
        node = np.full(len(x), root, dtype=np.int64)
        active = np.ones(len(x), dtype=bool)
        while active.any():
            f = feature[node]
            is_leaf = f < 0
            done = active & is_leaf
            out[done] += value[node[done]]
            active &= ~is_leaf
            idx = np.flatnonzero(active)
            if idx.size == 0:
                break
            go_left = x[idx, f[idx]] <= threshold[node[idx]]
            node[idx] = np.where(go_left, left[node[idx]], right[node[idx]])
    return out / forest["header"]["n_trees"]
