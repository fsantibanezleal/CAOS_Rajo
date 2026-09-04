"""Stage series: the mined-area time series per method and their change points (M10), plus the
envelope means of three indices per year, and, when the dense stage has run, the harmonic regression
with breaks on the dense Sentinel-2 series (M11).

Reads ``masks.json`` (areas inside the envelope per year and method), the chips (index means) and the
optional ``dense.json``; writes ``series.json`` in the shape the web contract declares (SeriesBlock):
years, sensor, valid fraction, area per method with null where the year had no usable mask, the
detectors' output per method, the change points flattened, and the gaps carried from the frames.

A year whose envelope was less than 70% clear is a null in every series (a cloud is not a shrinking
mine). Detectors run on the non-null values only, so a break index maps back to a real year.
"""
from __future__ import annotations

import numpy as np
from baselines import BSI_FLOOR, ND_FLOOR  # noqa: E402

from ..changepoints import cusum, harmonic_breaks, pelt
from ..manifest import read_json, write_json
from ..paths import data_root
from ..raster import unpack_reflectance
from .frames import LANDSAT_FACTOR, _grid_of
from .masks import METHODS, _envelope, _to_30m  # puts data-pipeline/train on sys.path

MIN_VALID = 0.70
INDICES = ("ndvi", "mndwi", "bsi")


def index_means(bands: np.ndarray, sel: np.ndarray) -> dict[str, float | None]:
    """Envelope means of NDVI, MNDWI and BSI with the shared denominator floors (baselines.py): a pixel
    whose reflectance sum is below the floor contributes nothing, so one dark pixel cannot blow up a mean."""
    if sel.sum() < 10:
        return {k: None for k in INDICES}
    bands = np.maximum(bands, 0.0)
    b, g, r, n, s1 = (bands[i][sel].astype(np.float64) for i in range(5))
    out: dict[str, float | None] = {}
    for key, num, den, floor in (("ndvi", n - r, n + r, ND_FLOOR), ("mndwi", g - s1, g + s1, ND_FLOOR),
                                  ("bsi", (s1 + r) - (n + b), (s1 + r) + (n + b), BSI_FLOOR)):
        ok = den > floor
        out[key] = round(float((num[ok] / den[ok]).mean()), 5) if ok.sum() >= 10 else None
    return out


def _index_means(bands: np.ndarray, valid: np.ndarray, envelope: np.ndarray) -> dict[str, float | None]:
    return index_means(bands, valid & envelope)


def _detect(years: list[int], values: list[float | None]) -> dict:
    idx = [i for i, v in enumerate(values) if v is not None]
    x = [values[i] for i in idx]
    if len(x) < 6:
        return {"pelt": {"breaks": [], "segments": [], "penalty": 0.0, "sigma": 0.0, "cost": "l2", "min_size": 3},
                "cusum": {"alarms": [], "k": 0.0, "h": 0.0, "sigma": 0.0, "target": 0.0}, "n": len(x)}
    p = pelt(x)
    c = cusum(x)
    to_year = lambda i: years[idx[i]]  # noqa: E731
    return {
        "pelt": {"breaks": [to_year(b) for b in p["breaks"]],
                 "segments": [{"start": to_year(s["start"]), "end": to_year(s["end"]), "mean": round(s["mean"], 4),
                               "slope": round(s["slope"], 4)} for s in p["segments"]],
                 "penalty": round(p["penalty"], 6), "sigma": round(p["sigma"], 6), "cost": p["cost"], "min_size": p["min_size"]},
        "cusum": {"alarms": [to_year(a) for a in c["alarms"]], "k": round(c["k"], 6), "h": round(c["h"], 6),
                  "sigma": round(c["sigma"], 6), "target": round(c["target"], 6)},
        "n": len(x),
    }


def run_stage(ctx) -> None:
    root = data_root(ctx.repo_root)
    for d in sorted(p for p in ctx.sites_dir.iterdir() if p.is_dir()):
        if ctx.sites and d.name not in ctx.sites:
            continue
        masks_path = d / "masks.json"
        if not masks_path.exists():
            ctx.log(f"{d.name}: no masks.json, skipped")
            continue
        site_doc = read_json(d / "site.json")
        frames_doc = read_json(d / "frames.json")
        masks_doc = read_json(masks_path)
        grid30 = _grid_of(site_doc).coarse(LANDSAT_FACTOR)
        envelope = _envelope(d, grid30)
        frames = sorted(frames_doc["frames"], key=lambda f: f["year"])
        years = [int(f["year"]) for f in frames]
        sensor = [f["sensor"] for f in frames]
        valid_frac: list[float] = []
        area: dict[str, list[float | None]] = {m: [] for m in METHODS}
        index_mean: dict[str, list[float | None]] = {k: [] for k in INDICES}
        flags: dict[str, set[str]] = {m: set() for m in METHODS}
        for f in frames:
            y = str(f["year"])
            rec = masks_doc["years"].get(y, {})
            vf = float(rec.get("envelope_valid_frac", 0.0))
            valid_frac.append(round(vf, 4))
            usable = vf >= MIN_VALID
            for m in METHODS:
                r = rec.get(m)
                area[m].append(round(float(r["area_km2"]), 4) if (r and usable) else None)
                if r:
                    flags[m].update(r.get("flags", []))
            chip = root / "chips" / d.name / f"{d.name}_{y}.npz"
            if chip.exists() and usable:
                z = np.load(chip)
                bands = unpack_reflectance(z["bands"])
                valid = (z["data"] > 0) & (z["clear"] > 0)
                if f["collection"] == "sentinel-2-l2a":
                    bands, valid = _to_30m(bands, valid, LANDSAT_FACTOR)
                means = _index_means(bands, valid, envelope) if bands.shape[1:] == envelope.shape else {k: None for k in INDICES}
            else:
                means = {k: None for k in INDICES}
            for k in INDICES:
                index_mean[k].append(means[k])
        methods_out = {}
        change_points = []
        for m in METHODS:
            if all(v is None for v in area[m]):
                continue
            det = _detect(years, area[m])
            meta = masks_doc.get("methods", {}).get(m, {})
            methods_out[m] = {"label": meta.get("label", m), "domain": meta.get("domain", ""), "model": meta.get("model"),
                              "flags": sorted(flags[m]), "n": det["n"], "pelt": det["pelt"], "cusum": det["cusum"]}
            for b in det["pelt"]["breaks"]:
                change_points.append({"year": b, "method": "pelt", "series": m, "score": det["pelt"]["penalty"]})
            for a in det["cusum"]["alarms"]:
                change_points.append({"year": a, "method": "cusum", "series": m, "score": det["cusum"]["h"]})
        dense = None
        dense_path = d / "dense.json"
        if dense_path.exists():
            dd = read_json(dense_path)
            if dd.get("status") != "complete":
                # a checkpoint of a walk still in progress (or a file written before the status field
                # existed) is not a series: the harmonic model would fit a truncated record
                ctx.log(f"{d.name}: dense.json is {dd.get('status', 'without status')}, not used until the walk completes")
                dd = {}
            if dd.get("dates"):
                t0 = np.datetime64(dd["dates"][0])
                t_days = [float((np.datetime64(x) - t0) / np.timedelta64(1, "D")) for x in dd["dates"]]
                h = harmonic_breaks(t_days, dd["values"])
                dates = list(dd["dates"])

                def to_date(i: int, dates: list[str] = dates) -> str:
                    return dates[i]

                dense = {"index": dd["index"], "dates": dd["dates"], "values": dd["values"], "clear_frac": dd["clear_frac"],
                         "envelope": dd.get("envelope"), "n": len(dd["dates"]),
                         "harmonic": {"breaks": [to_date(b) for b in h["breaks"]], "k": h["k"], "period_days": h["period_days"],
                                      "segments": [{"start": to_date(s["start"]), "end": to_date(s["end"]), "coef": s["coef"],
                                                    "rss": round(s["rss"], 6), "n": s["n"]} for s in h["segments"]],
                                      "bic": round(h["bic"], 4), "bic_no_break": round(h["bic_no_break"], 4),
                                      "min_segment_days": h["min_segment_days"]}}
                for b in dense["harmonic"]["breaks"]:
                    change_points.append({"year": int(b[:4]), "method": "harmonic", "series": dd["index"], "score": round(h["bic_no_break"] - h["bic"], 4)})
        series = {
            "years": years, "sensor": sensor, "valid_frac": valid_frac,
            "envelope_km2": masks_doc.get("envelope_km2"), "envelope": masks_doc.get("envelope"), "min_valid_frac": MIN_VALID,
            "area_km2": {m: v for m, v in area.items() if m in methods_out},
            "index_mean": index_mean, "methods": methods_out,
            "change_points": sorted(change_points, key=lambda c: (c["year"], c["series"], c["method"])),
            "gaps": frames_doc.get("gaps", {}), "dense": dense,
        }
        write_json(d / "series.json", series)
        summary = "; ".join(f"{m}: pelt {v['pelt']['breaks']} cusum {v['cusum']['alarms']}" for m, v in methods_out.items())
        ctx.log(f"{d.name}: series over {len(years)} years -> {summary or 'no usable method'}"
                f"{' | dense ' + str(dense['harmonic']['breaks']) if dense else ''}")
