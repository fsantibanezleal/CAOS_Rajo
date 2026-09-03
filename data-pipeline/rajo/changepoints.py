"""Change points on the mined-area series (M10) and harmonic regression with breaks on a dense index
series (M11). Written to be mirrored line for line in TypeScript (frontend/src/lib/changepoints.ts);
the parity test replays the same inputs through both and compares breaks and scores.

M10, two detectors on a short annual series (n about 40):

- CUSUM (Page 1954, doi:10.1093/biomet/41.1-2.100), one-sided upward on the first differences:
  S_0 = 0, S_t = max(0, S_{t-1} + (x_t - mu_0 - k)), alarm when S_t > h, reset after an alarm.
  mu_0 is the median first difference, k = 0.5 sigma, h = 4 sigma, sigma the MAD-based scale of the
  first differences (a robust scale: one real jump must not inflate the threshold that detects it).
- PELT (Killick, Fearnhead, Eckley 2012, doi:10.1080/01621459.2012.737745) with the L2 cost on a
  piecewise-constant mean, minimum segment length 3, penalty beta = 3 sigma^2 log n. With n about 40
  the exact optimal partition is computed by dynamic programming with pruning, which is what PELT is.
  The offline reference uses ``ruptures`` (Truong, Oudre, Vayatis 2020, doi:10.1016/j.sigpro.2019.107299)
  and the in-house solver must agree with it on every site (checked in the tests).

M11, harmonic regression with breaks (BFAST-style, Verbesselt et al. 2010, doi:10.1016/j.rse.2009.08.014):
  y_t = a + b t + sum_k [c_k cos(2 pi k t / T) + d_k sin(2 pi k t / T)], K = 2, T = 365.25 days,
  fitted by least squares per segment; break dates chosen by an exhaustive search over one or two
  breaks with a minimum segment of 365 days, accepted when they lower the BIC.
"""
from __future__ import annotations

import math

import numpy as np


def robust_sigma(x: np.ndarray) -> float:
    """1.4826 * MAD of the first differences, the scale both detectors use."""
    d = np.diff(np.asarray(x, dtype=np.float64))
    if d.size == 0:
        return 0.0
    mad = float(np.median(np.abs(d - np.median(d))))
    return 1.4826 * mad


def cusum(values: list[float], k_sigma: float = 0.5, h_sigma: float = 4.0) -> dict:
    x = np.asarray(values, dtype=np.float64)
    d = np.diff(x)
    if d.size < 3:
        return {"alarms": [], "k": 0.0, "h": 0.0, "sigma": 0.0, "target": 0.0, "stat": []}
    sigma = robust_sigma(x)
    if sigma <= 0:
        sigma = float(np.std(d)) or 1e-9
    mu0 = float(np.median(d))
    k = k_sigma * sigma
    h = h_sigma * sigma
    s = 0.0
    stat: list[float] = []
    alarms: list[int] = []  # indices into values (the year the jump completes)
    for i, di in enumerate(d):
        s = max(0.0, s + (float(di) - mu0 - k))
        stat.append(s)
        if s > h:
            alarms.append(i + 1)
            s = 0.0
    return {"alarms": alarms, "k": k, "h": h, "sigma": sigma, "target": mu0, "stat": stat}


def _l2_cost_table(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    c1 = np.concatenate([[0.0], np.cumsum(x)])
    c2 = np.concatenate([[0.0], np.cumsum(x * x)])
    return c1, c2


def _seg_cost(c1: np.ndarray, c2: np.ndarray, a: int, b: int) -> float:
    """L2 cost of x[a:b] around its mean."""
    n = b - a
    s1 = c1[b] - c1[a]
    s2 = c2[b] - c2[a]
    return float(s2 - s1 * s1 / n)


def pelt(values: list[float], penalty: float | None = None, min_size: int = 3, sigma: float | None = None) -> dict:
    """Optimal partition under the L2 cost with a linear penalty per change point (PELT with pruning).
    Returns break indices (the first index of each new segment) and the segments."""
    x = np.asarray(values, dtype=np.float64)
    n = int(x.size)
    if sigma is None:
        sigma = robust_sigma(x)
        if sigma <= 0:
            sigma = float(np.std(np.diff(x))) if n > 1 else 0.0
    if penalty is None:
        penalty = 3.0 * sigma * sigma * math.log(max(n, 2))
    if n < 2 * min_size:
        return {"breaks": [], "segments": [_segment(x, 0, n)], "penalty": penalty, "sigma": sigma,
                "cost": "l2", "min_size": min_size}
    c1, c2 = _l2_cost_table(x)
    f = np.full(n + 1, np.inf)
    f[0] = -penalty
    last = np.zeros(n + 1, dtype=np.int64)
    cands = [0]
    for t in range(min_size, n + 1):
        best = np.inf
        arg = 0
        for s in cands:
            if t - s < min_size:
                continue
            v = f[s] + _seg_cost(c1, c2, s, t) + penalty
            if v < best:
                best = v
                arg = s
        f[t] = best
        last[t] = arg
        # pruning: a candidate that cannot beat the best even without the penalty is dropped
        cands = [s for s in cands if t - s < min_size or f[s] + _seg_cost(c1, c2, s, t) <= best] + [t]
    breaks: list[int] = []
    t = n
    while t > 0:
        s = int(last[t])
        if s > 0:
            breaks.append(s)
        t = s
    breaks.sort()
    bounds = [0, *breaks, n]
    segments = [_segment(x, bounds[i], bounds[i + 1]) for i in range(len(bounds) - 1)]
    return {"breaks": breaks, "segments": segments, "penalty": penalty, "sigma": sigma, "cost": "l2", "min_size": min_size}


def _segment(x: np.ndarray, a: int, b: int) -> dict:
    seg = x[a:b]
    t = np.arange(a, b, dtype=np.float64)
    slope = float(np.polyfit(t, seg, 1)[0]) if b - a >= 2 else 0.0
    return {"start": a, "end": b - 1, "mean": float(seg.mean()), "slope": slope}


# --- M11 harmonic regression with breaks ------------------------------------------------------------

def harmonic_design(t_days: np.ndarray, k: int = 2, period: float = 365.25) -> np.ndarray:
    cols = [np.ones_like(t_days), t_days / period]
    for j in range(1, k + 1):
        w = 2.0 * math.pi * j * t_days / period
        cols.append(np.cos(w))
        cols.append(np.sin(w))
    return np.stack(cols, axis=1)


def _fit(t: np.ndarray, y: np.ndarray, k: int, period: float) -> tuple[np.ndarray, float]:
    X = harmonic_design(t, k, period)
    coef, *_ = np.linalg.lstsq(X, y, rcond=None)
    r = y - X @ coef
    return coef, float(r @ r)


def harmonic_breaks(t_days: list[float], y: list[float], k: int = 2, period: float = 365.25,
                    min_segment_days: float = 365.0, max_breaks: int = 2, step: int = 1) -> dict:
    """Exhaustive search over one or two break positions (on observation indices, every ``step``-th
    candidate) minimising the total RSS; a configuration is kept only when its BIC beats the previous."""
    t = np.asarray(t_days, dtype=np.float64)
    yv = np.asarray(y, dtype=np.float64)
    n = int(t.size)
    p = 2 + 2 * k

    def bic(rss: float, n_params: int) -> float:
        return n * math.log(max(rss / n, 1e-12)) + n_params * math.log(n)

    coef0, rss0 = _fit(t, yv, k, period)
    best = {"breaks": [], "rss": rss0, "bic": bic(rss0, p), "segments": [(0, n, coef0, rss0)]}
    bic_no_break = best["bic"]

    def valid(i: int, j: int) -> bool:
        return (t[j - 1] - t[i]) >= min_segment_days and (j - i) > p

    candidates = list(range(0, n, step))
    if max_breaks >= 1:
        for b1 in candidates:
            if not (valid(0, b1) and valid(b1, n)):
                continue
            c_a, r_a = _fit(t[:b1], yv[:b1], k, period)
            c_b, r_b = _fit(t[b1:], yv[b1:], k, period)
            rss = r_a + r_b
            score = bic(rss, 2 * p + 1)
            if score < best["bic"]:
                best = {"breaks": [b1], "rss": rss, "bic": score, "segments": [(0, b1, c_a, r_a), (b1, n, c_b, r_b)]}
    if max_breaks >= 2 and n >= 3 * (p + 1):
        for b1 in candidates:
            if not valid(0, b1):
                continue
            c_a, r_a = _fit(t[:b1], yv[:b1], k, period)
            for b2 in candidates:
                if b2 <= b1 or not (valid(b1, b2) and valid(b2, n)):
                    continue
                c_b, r_b = _fit(t[b1:b2], yv[b1:b2], k, period)
                c_c, r_c = _fit(t[b2:], yv[b2:], k, period)
                rss = r_a + r_b + r_c
                score = bic(rss, 3 * p + 2)
                if score < best["bic"]:
                    best = {"breaks": [b1, b2], "rss": rss, "bic": score,
                            "segments": [(0, b1, c_a, r_a), (b1, b2, c_b, r_b), (b2, n, c_c, r_c)]}
    return {
        "breaks": best["breaks"], "k": k, "period_days": period, "bic": best["bic"], "bic_no_break": bic_no_break,
        "rss": best["rss"], "min_segment_days": min_segment_days,
        "segments": [{"start": int(a), "end": int(b) - 1, "coef": [float(c) for c in coef], "rss": float(r), "n": int(b - a)}
                     for a, b, coef, r in best["segments"]],
    }
