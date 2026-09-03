"""Write the golden fixture that pins the browser's change-point code to the Python one.

Three deterministic series (a step with drift, pure noise, a two-jump series) and one dense harmonic
series with a planted break go through rajo.changepoints; inputs and outputs are written to
frontend/src/lib/__fixtures__/changepoints_golden.json, which changepoints.test.ts replays in
TypeScript. Re-run whenever a detector changes, and commit both.

    python data-pipeline/make_changepoint_golden.py
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "data-pipeline"))

from rajo.changepoints import cusum, harmonic_breaks, pelt  # noqa: E402


def step(n: int, at: int, jump: float, noise: float, seed: int, drift: float = 0.05) -> list[float]:
    rng = np.random.default_rng(seed)
    x = 10.0 + drift * np.arange(n) + rng.normal(0, noise, n)
    x[at:] += jump
    return [round(float(v), 6) for v in x]


def main() -> int:
    series = {
        "step": step(40, 22, 6.0, 0.3, 5),
        "flat": [round(float(v), 6) for v in 10 + np.random.default_rng(1).normal(0, 0.3, 40)],
        "two_jumps": [round(v + (3.0 if i >= 33 else 0.0), 6) for i, v in enumerate(step(44, 15, 4.0, 0.3, 5))],
        "short": [1.0, 1.1, 0.9, 5.0, 5.2],
    }
    cases = {}
    for name, x in series.items():
        p = pelt(x)
        c = cusum(x)
        cases[name] = {
            "values": x,
            "pelt": {"breaks": p["breaks"], "penalty": p["penalty"], "sigma": p["sigma"], "min_size": p["min_size"],
                     "segments": p["segments"]},
            "cusum": {"alarms": c["alarms"], "k": c["k"], "h": c["h"], "sigma": c["sigma"], "target": c["target"], "stat": c["stat"]},
        }
    rng = np.random.default_rng(3)
    t = np.sort(rng.uniform(0, 6 * 365.25, 200))
    y = 0.5 + 0.2 * np.cos(2 * math.pi * t / 365.25) + rng.normal(0, 0.03, t.size)
    y[t > 3.4 * 365.25] -= 0.25
    tl = [round(float(v), 4) for v in t]
    yl = [round(float(v), 6) for v in y]
    h = harmonic_breaks(tl, yl)
    dense = {"t_days": tl, "values": yl, "breaks": h["breaks"], "bic": h["bic"], "bic_no_break": h["bic_no_break"], "rss": h["rss"],
             "segments": h["segments"], "k": h["k"], "period_days": h["period_days"], "min_segment_days": h["min_segment_days"]}
    out = {"cases": cases, "dense": dense}
    p = REPO / "frontend" / "src" / "lib" / "__fixtures__" / "changepoints_golden.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(out) + "\n", encoding="utf-8", newline="\n")
    print(f"written {p} ({p.stat().st_size} bytes): " + ", ".join(f"{k} pelt {v['pelt']['breaks']} cusum {v['cusum']['alarms']}" for k, v in cases.items())
          + f"; dense breaks {h['breaks']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
