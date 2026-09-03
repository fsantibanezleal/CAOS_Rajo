"""Python mirrors of the browser's classical delineation methods (M4 Otsu, M5 k-means, M6 SAM), written
to score them on the same held-out tiles as the learned methods. Each mirror follows the worker
(frontend/src/workers/indices.worker.ts) operation for operation; the golden fixture test keeps them
aligned.

Benchmark rules that the app leaves to the user:
- k-means: the mining cluster is the cluster with the highest mean BSI (bare ground) among clusters
  whose mean NDVI is below 0.2; the app shows every cluster and lets the user pick.
- SAM: the endmember is the mean spectrum of the valid pixels inside the reference polygons (what the
  app does when a site has polygons); the angle threshold is chosen on the validation split and then
  frozen for test and catalog.
"""
from __future__ import annotations

import numpy as np
from common import clean_mask

EPS = 1e-6


def norm_diff(a: np.ndarray, b: np.ndarray, valid: np.ndarray) -> np.ndarray:
    out = np.full(a.shape, np.nan, dtype=np.float32)
    den = a + b
    ok = valid & (np.abs(den) > 1e-6)
    out[ok] = (a[ok] - b[ok]) / den[ok]
    return out


def bsi_index(bands: np.ndarray, valid: np.ndarray) -> np.ndarray:
    blue, red, nir, swir16 = bands[0], bands[2], bands[3], bands[4]
    a = swir16 + red
    b = nir + blue
    out = np.full(red.shape, np.nan, dtype=np.float32)
    ok = valid & (a + b > 1e-6)
    out[ok] = (a[ok] - b[ok]) / (a[ok] + b[ok])
    return out


def percentiles(values: np.ndarray, qs: list[float]) -> list[float]:
    v = values[np.isfinite(values)]
    if v.size == 0:
        return [0.0 for _ in qs]
    return [float(x) for x in np.percentile(v, qs)]


def otsu_threshold(values: np.ndarray, lo: float, hi: float, bins: int = 256) -> float:
    """Otsu on a histogram over [lo, hi]; the midpoint of the plateau of equally optimal bins; the
    threshold is the upper edge of that bin (the worker's convention)."""
    v = values[np.isfinite(values)]
    if v.size == 0 or hi <= lo:
        return lo
    h, _ = np.histogram(np.clip(v, lo, hi), bins=bins, range=(lo, hi))
    h = h.astype(np.float64)
    total = h.sum()
    if total == 0:
        return lo
    p = h / total
    mids = (np.arange(bins) + 0.5) / bins
    w0 = np.cumsum(p)
    m0 = np.cumsum(p * mids)
    mt = m0[-1]
    w1 = 1.0 - w0
    with np.errstate(divide="ignore", invalid="ignore"):
        mu0 = m0 / w0
        mu1 = (mt - m0) / w1
        between = w0 * w1 * (mu0 - mu1) ** 2
    between = np.where(np.isfinite(between), between, -1.0)
    best = between.max()
    ks = np.flatnonzero(np.isclose(between, best, rtol=0, atol=1e-12))
    k = int((ks[0] + ks[-1]) // 2)
    return lo + ((k + 1) / bins) * (hi - lo)


def otsu_mask(bands: np.ndarray, valid: np.ndarray, pixel_m: float = 10.0, threshold: float | None = None) -> tuple[np.ndarray, float]:
    """M4: BSI above the Otsu threshold, NDVI below 0.2, MNDWI below 0, then the standard clean-up."""
    bsi = bsi_index(bands, valid)
    lo, hi = percentiles(bsi, [0.5, 99.5])
    t = otsu_threshold(bsi, lo, hi) if threshold is None else threshold
    ndvi = norm_diff(bands[3], bands[2], valid)
    mndwi = norm_diff(bands[1], bands[4], valid)
    raw = valid & (bsi > t) & (ndvi < 0.2) & (mndwi < 0)
    return clean_mask(raw.astype(np.float32), 0.5, min_px=20), float(t)


def _mulberry32(seed: int):
    a = seed & 0xFFFFFFFF

    def rand() -> float:
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = a
        t = (t ^ (t >> 15)) * (t | 1) & 0xFFFFFFFF
        t ^= (t + ((t ^ (t >> 7)) * (t | 61) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return rand


def kmeans_labels(bands: np.ndarray, valid: np.ndarray, k: int = 5, seed: int = 7, sample_n: int = 20000,
                  iterations: int = 30) -> tuple[np.ndarray, np.ndarray]:
    """M5: k-means++ on a deterministic sample of standardised features (six bands, NDVI, MNDWI), Lloyd
    iterations on the sample, then every valid pixel assigned. Returns (labels with 255 = invalid,
    centroids in feature units)."""
    ndvi = norm_diff(bands[3], bands[2], valid)
    mndwi = norm_diff(bands[1], bands[4], valid)
    feats = np.stack([*bands, ndvi, mndwi]).reshape(8, -1).T.astype(np.float64)
    vflat = valid.reshape(-1) & np.all(np.isfinite(feats), axis=1)
    idx = np.flatnonzero(vflat)
    labels = np.full(feats.shape[0], 255, dtype=np.uint8)
    if idx.size < k:
        return labels.reshape(valid.shape), np.zeros((k, 8))
    mean = feats[idx].mean(axis=0)
    std = feats[idx].std(axis=0) + 1e-9
    z = (feats - mean) / std
    rand = _mulberry32(seed)
    stride = max(1, idx.size // sample_n)
    sample = idx[::stride][:sample_n]
    zs = z[sample]
    cent = [zs[int(rand() * len(sample)) % len(sample)].copy()]
    dist2 = np.full(len(sample), np.inf)
    while len(cent) < k:
        d = ((zs - cent[-1]) ** 2).sum(axis=1)
        dist2 = np.minimum(dist2, d)
        total = dist2.sum()
        r = rand() * total
        pick = len(sample) - 1
        acc = 0.0
        for s in range(len(sample)):
            acc += dist2[s]
            if r - acc <= 0:
                pick = s
                break
        cent.append(zs[pick].copy())
    c = np.array(cent)
    assign = np.zeros(len(sample), dtype=np.int64)
    for _ in range(iterations):
        d = ((zs[:, None, :] - c[None, :, :]) ** 2).sum(axis=2)
        new = d.argmin(axis=1)
        changed = int((new != assign).sum())
        assign = new
        for j in range(k):
            m = assign == j
            if m.any():
                c[j] = zs[m].mean(axis=0)
        if changed == 0:
            break
    d = ((z[idx][:, None, :] - c[None, :, :]) ** 2).sum(axis=2)
    labels[idx] = d.argmin(axis=1).astype(np.uint8)
    return labels.reshape(valid.shape), c * std + mean


def kmeans_mask(bands: np.ndarray, valid: np.ndarray, k: int = 5, seed: int = 7) -> tuple[np.ndarray, int]:
    """Benchmark rule: the cluster with the highest mean BSI among clusters with mean NDVI below 0.2."""
    labels, cent = kmeans_labels(bands, valid, k, seed)
    bsi = bsi_index(bands, valid)
    ndvi = norm_diff(bands[3], bands[2], valid)
    best, best_bsi = -1, -np.inf
    for j in range(k):
        m = labels == j
        if not m.any():
            continue
        mb = float(np.nanmean(bsi[m]))
        mn = float(np.nanmean(ndvi[m]))
        if mn < 0.2 and mb > best_bsi:
            best, best_bsi = j, mb
    if best < 0:
        return np.zeros(valid.shape, dtype=bool), -1
    return clean_mask((labels == best).astype(np.float32), 0.5, min_px=20), best


def sam_angles(bands: np.ndarray, valid: np.ndarray, endmember_mask: np.ndarray | None) -> np.ndarray:
    """M6: spectral angle (radians) of every valid pixel to the endmember (mean spectrum inside the
    mask, or the BSI top quartile when no mask is given)."""
    chans = bands.reshape(6, -1).T
    vflat = valid.reshape(-1)
    if endmember_mask is not None and (endmember_mask.reshape(-1) & vflat).any():
        sel = endmember_mask.reshape(-1) & vflat
    else:
        bsi = bsi_index(bands, valid).reshape(-1)
        q75 = percentiles(bsi, [75])[0]
        sel = vflat & (bsi >= q75)
    e = chans[sel].mean(axis=0)
    en = np.sqrt((e * e).sum()) or 1.0
    dot = chans @ e
    nn = np.sqrt((chans * chans).sum(axis=1))
    nn[nn == 0] = 1.0
    cos = np.clip(dot / (nn * en), -1, 1)
    ang = np.arccos(cos).astype(np.float32)
    ang[~vflat] = np.nan
    return ang.reshape(valid.shape)


def sam_mask(bands: np.ndarray, valid: np.ndarray, endmember_mask: np.ndarray | None, angle_rad: float) -> np.ndarray:
    ang = sam_angles(bands, valid, endmember_mask)
    raw = valid & np.isfinite(ang) & (ang <= angle_rad)
    return clean_mask(raw.astype(np.float32), 0.5, min_px=20)
