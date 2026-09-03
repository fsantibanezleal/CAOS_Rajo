"""The learned lane's shared pieces: the feature stack order (a contract with the browser worker), the
metrics, the mask clean-up, and the Python mirrors of the classical methods on a synthetic chip."""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "data-pipeline" / "train"))

from baselines import kmeans_labels, otsu_mask, otsu_threshold, sam_mask  # noqa: E402
from common import (  # noqa: E402
    RF_FEATURES,
    boundary_f1,
    clean_mask,
    confusion,
    rf_features,
    sample_pixels,
    scores,
)


def synthetic_chip(n: int = 64, seed: int = 3) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """A vegetated chip with a bright bare square in the middle (the 'mine')."""
    rng = np.random.default_rng(seed)
    veg = np.array([0.03, 0.05, 0.04, 0.35, 0.18, 0.09], dtype=np.float32)
    bare = np.array([0.18, 0.22, 0.28, 0.34, 0.45, 0.40], dtype=np.float32)
    bands = np.repeat(veg[:, None, None], n, axis=1).repeat(n, axis=2).copy()
    label = np.zeros((n, n), dtype=np.uint8)
    label[20:44, 20:44] = 1
    bands[:, 20:44, 20:44] = bare[:, None, None]
    bands += rng.normal(0, 0.004, bands.shape).astype(np.float32)
    valid = np.ones((n, n), dtype=bool)
    return bands, label, valid


def test_feature_stack_order_and_definitions():
    bands, _label, _valid = synthetic_chip()
    f = rf_features(bands)
    assert f.shape == (16, 64, 64)
    assert len(RF_FEATURES) == 16
    assert RF_FEATURES[:6] == ("blue", "green", "red", "nir", "swir16", "swir22")
    blue, green, red, nir, swir16, swir22 = bands
    i = RF_FEATURES.index
    np.testing.assert_allclose(f[i("ndvi")], (nir - red) / (nir + red + 1e-6), atol=1e-5)
    np.testing.assert_allclose(f[i("mndwi")], (green - swir16) / (green + swir16 + 1e-6), atol=1e-5)
    np.testing.assert_allclose(f[i("ferrous")], swir22 / (nir + 1e-6), atol=1e-4)  # B12 / B8A, docs/methods/02
    np.testing.assert_allclose(f[i("clay")], swir16 / (swir22 + 1e-6), atol=1e-4)
    np.testing.assert_allclose(f[i("iron")], red / (blue + 1e-6), atol=1e-4)
    assert np.all(np.isfinite(f))


def test_metrics_and_clean_mask():
    gt = np.zeros((32, 32), dtype=np.uint8)
    gt[8:24, 8:24] = 1
    valid = np.ones_like(gt, dtype=bool)
    perfect = scores(confusion(gt.astype(bool), gt, valid))
    assert perfect["iou"] == 1.0 and perfect["f1"] == 1.0
    half = gt.copy()
    half[16:24, 8:24] = 0
    s = scores(confusion(half.astype(bool), gt, valid))
    assert abs(s["iou"] - 0.5) < 1e-9 and abs(s["recall"] - 0.5) < 1e-9 and s["precision"] == 1.0
    assert boundary_f1(gt.astype(bool), gt, valid) == 1.0
    prob = np.zeros((32, 32), dtype=np.float32)
    prob[8:24, 8:24] = 0.9
    prob[2, 2] = 0.95  # an isolated pixel disappears in the clean-up
    m = clean_mask(prob, 0.5, min_px=25)
    assert m[12, 12] and not m[2, 2]


def test_sampling_is_balanced_and_bounded():
    bands, label, valid = synthetic_chip()
    x, y = sample_pixels(rf_features(bands), label, valid, 400, np.random.default_rng(0))
    assert x.shape == (400, 16) and y.shape == (400,)
    assert abs(y.mean() - 0.5) < 1e-9


def test_otsu_threshold_splits_two_modes_and_returns_plateau_midpoint():
    v = np.concatenate([np.full(500, -0.3), np.full(500, 0.4)]).astype(np.float32)
    t = otsu_threshold(v, -0.5, 0.5, 256)
    assert -0.3 < t < 0.4


def test_classical_mirrors_find_the_square():
    bands, label, valid = synthetic_chip()
    m, t = otsu_mask(bands, valid)
    assert scores(confusion(m, label, valid))["iou"] > 0.9
    labels, _cent = kmeans_labels(bands, valid, k=3, seed=7)
    assert labels.max() < 3 and len(np.unique(labels[label == 1])) == 1
    sm = sam_mask(bands, valid, label.astype(bool), 0.05)
    assert scores(confusion(sm, label, valid))["iou"] > 0.9
    labels2, _ = kmeans_labels(bands, valid, k=3, seed=7)
    assert np.array_equal(labels, labels2)  # deterministic PRNG, same seed, same clusters
