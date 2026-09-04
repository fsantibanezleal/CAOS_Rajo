"""M10 and M11: the detectors find a planted jump and nothing in noise; the in-house PELT agrees with
ruptures on the same penalty; the harmonic fit recovers a planted break."""
import math

import numpy as np
import pytest
from rajo.changepoints import cusum, harmonic_breaks, pelt, robust_sigma


def step_series(n: int = 40, at: int = 22, jump: float = 6.0, noise: float = 0.3, seed: int = 5) -> list[float]:
    rng = np.random.default_rng(seed)
    x = 10.0 + 0.05 * np.arange(n) + rng.normal(0, noise, n)
    x[at:] += jump
    return [float(v) for v in x]


def test_pelt_finds_the_planted_jump_and_nothing_in_noise():
    x = step_series()
    r = pelt(x)
    assert r["breaks"] == [22]
    assert len(r["segments"]) == 2 and r["segments"][1]["mean"] > r["segments"][0]["mean"] + 5
    rng = np.random.default_rng(1)
    flat = [float(v) for v in 10 + rng.normal(0, 0.3, 40)]
    assert pelt(flat)["breaks"] == []


def test_pelt_agrees_with_ruptures_on_the_same_penalty():
    ruptures = pytest.importorskip("ruptures")
    x = step_series(n=44, at=15, jump=4.0)
    x = [v + (3.0 if i >= 33 else 0.0) for i, v in enumerate(x)]
    ours = pelt(x)
    algo = ruptures.Pelt(model="l2", min_size=3, jump=1).fit(np.asarray(x))
    theirs = algo.predict(pen=ours["penalty"])
    assert ours["breaks"] == [b for b in theirs if b < len(x)]


def test_cusum_alarms_once_at_the_jump():
    x = step_series()
    r = cusum(x)
    assert r["alarms"] == [22]
    assert r["h"] > r["k"] > 0
    rng = np.random.default_rng(2)
    assert cusum([float(v) for v in 10 + rng.normal(0, 0.3, 40)])["alarms"] == []


def test_robust_sigma_ignores_one_jump():
    x = step_series(noise=0.2, jump=20.0)
    assert robust_sigma(x) < 1.0


def test_harmonic_breaks_recovers_a_planted_break():
    rng = np.random.default_rng(3)
    t = np.sort(rng.uniform(0, 6 * 365.25, 260))
    season = 0.2 * np.cos(2 * math.pi * t / 365.25)
    y = 0.5 + season + rng.normal(0, 0.03, t.size)
    y[t > 3.4 * 365.25] -= 0.25  # a real land change, not a season
    r = harmonic_breaks([float(v) for v in t], [float(v) for v in y])
    assert len(r["breaks"]) == 1
    b = r["breaks"][0]
    assert abs(t[b] - 3.4 * 365.25) < 60
    assert r["bic"] < r["bic_no_break"]
    flat = harmonic_breaks([float(v) for v in t], [float(v) for v in 0.5 + season + rng.normal(0, 0.03, t.size)])
    assert flat["breaks"] == []
