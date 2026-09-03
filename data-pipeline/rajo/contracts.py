"""CONTRACT 1, ingestion: which sites may enter the catalog (the bring-your-own-site gate).

A site definition is ACCEPTED iff it satisfies the schema below; REJECTED with a reason otherwise (never
silently coerced); plausible-but-suspicious definitions are FLAGGED (accepted, the flag travels into the
manifest). Pure functions, no I/O: the polygon check is injected by the caller so the contract can be
tested without the 24 MB reference dataset. Documented in data/README.md.
"""
from __future__ import annotations

import math
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

CATEGORIES: tuple[str, ...] = (
    "copper-chile", "copper-world", "lithium-brine", "iron", "gold", "lignite", "diamonds",
    "oil-sands", "transition", "closure",
)
ID_RE = re.compile(r"^[a-z0-9-]{3,40}$")
ISO3_RE = re.compile(r"^[A-Z]{3}$")
WINDOW_KM_RANGE = (4.0, 40.0)
YEAR_RANGE = (1984, 2026)
MAX_SEED_TO_POLYGON_KM = 3.0
POLYGON_SEARCH_KM = 12.0
DEFAULT_WINDOW_KM = 20.0


@dataclass
class Season:
    start_month: int
    end_month: int


@dataclass
class Fact:
    text_en: str
    text_es: str
    source: str


@dataclass
class Site:
    id: str
    name_en: str
    name_es: str
    country: str
    categories: list[str]
    lon: float
    lat: float
    window_km: float
    first_year: int
    season: Season
    facts: list[Fact]
    commodity: str = ""
    operator: str = ""
    flags: list[str] = field(default_factory=list)
    no_reference_polygon: bool = False
    tailings_note_en: str = ""
    tailings_note_es: str = ""
    transition_year: int | None = None
    closure_year: int | None = None


@dataclass
class ContractReport:
    accepted: list[Site]
    rejected: list[dict[str, Any]]
    flagged: list[dict[str, Any]]

    @property
    def ok(self) -> bool:
        return len(self.accepted) > 0 and not self.rejected

    def summary(self) -> str:
        return f"{len(self.accepted)} accepted, {len(self.rejected)} rejected, {len(self.flagged)} flagged"


def _num(v: Any) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


NearestPolygon = Callable[[float, float, float], float | None]
"""(lon, lat, search_km) -> distance in km to the nearest reference polygon, or None if none within search."""


def validate_sites(raw: list[dict[str, Any]], nearest_polygon_km: NearestPolygon | None = None) -> ContractReport:
    accepted: list[Site] = []
    rejected: list[dict[str, Any]] = []
    flagged: list[dict[str, Any]] = []
    seen: set[str] = set()

    for i, row in enumerate(raw):
        sid = str(row.get("id", f"row{i}"))
        bad: list[str] = []
        if not ID_RE.match(sid):
            bad.append("id must match ^[a-z0-9-]{3,40}$")
        if sid in seen:
            bad.append("duplicate id")
        seen.add(sid)

        name = row.get("name") or {}
        if not str(name.get("en", "")).strip() or not str(name.get("es", "")).strip():
            bad.append("name.en and name.es are required")
        country = str(row.get("country", ""))
        if not ISO3_RE.match(country):
            bad.append("country must be ISO 3166-1 alpha-3")
        cats = row.get("categories") or []
        if not isinstance(cats, list) or not cats or any(c not in CATEGORIES for c in cats):
            bad.append(f"categories must be a non-empty subset of {list(CATEGORIES)}")

        seed = row.get("seed") or {}
        lon, lat = _num(seed.get("lon")), _num(seed.get("lat"))
        if lon is None or lat is None or not (-180 <= lon <= 180) or not (-85 <= lat <= 85):
            bad.append("seed.lon/lat missing or out of range")

        window = _num(row.get("window_km", DEFAULT_WINDOW_KM))
        if window is None or not (WINDOW_KM_RANGE[0] <= window <= WINDOW_KM_RANGE[1]):
            bad.append(f"window_km must be within {WINDOW_KM_RANGE}")

        fy = row.get("first_year", YEAR_RANGE[0])
        try:
            fy = int(fy)
        except (TypeError, ValueError):
            fy = -1
        if not (YEAR_RANGE[0] <= fy <= YEAR_RANGE[1]):
            bad.append(f"first_year must be within {YEAR_RANGE}")

        season = row.get("season") or {}
        sm, em = season.get("start_month"), season.get("end_month")
        if not (isinstance(sm, int) and isinstance(em, int) and 1 <= sm <= 12 and 1 <= em <= 12):
            bad.append("season.start_month/end_month must be integers in [1, 12]")

        facts: list[Fact] = []
        for j, f in enumerate(row.get("facts") or []):
            t = f.get("text") or {}
            if not str(t.get("en", "")).strip() or not str(t.get("es", "")).strip():
                bad.append(f"facts[{j}] needs text.en and text.es")
                continue
            src = str(f.get("source", "")).strip()
            if not src.startswith(("http://", "https://")):
                bad.append(f"facts[{j}] has no source URL (a fact without a source is rejected)")
                continue
            facts.append(Fact(text_en=t["en"].strip(), text_es=t["es"].strip(), source=src))

        site_flags: list[str] = []
        no_poly = bool(row.get("no_reference_polygon", False))
        if not bad and nearest_polygon_km is not None and lon is not None and lat is not None:
            d = nearest_polygon_km(lon, lat, POLYGON_SEARCH_KM)
            if d is None or d > MAX_SEED_TO_POLYGON_KM:
                if no_poly:
                    site_flags.append("no reference polygon within 3 km (explicit opt-out)")
                else:
                    bad.append(
                        f"seed is {'more than 12' if d is None else f'{d:.1f}'} km from the nearest reference polygon"
                    )
        if not bad and fy < 1985:
            site_flags.append("first_year before 1985: Landsat 5 coverage is sparse before 1985")

        if bad:
            rejected.append({"row": i, "id": sid, "reason": "; ".join(bad)})
            continue
        for fl in site_flags:
            flagged.append({"id": sid, "flag": fl})

        accepted.append(Site(
            id=sid, name_en=name["en"].strip(), name_es=name["es"].strip(), country=country,
            categories=list(cats), lon=float(lon), lat=float(lat), window_km=float(window),
            first_year=fy, season=Season(int(sm), int(em)), facts=facts,
            commodity=str(row.get("commodity", "")), operator=str(row.get("operator", "")),
            flags=site_flags, no_reference_polygon=no_poly,
            tailings_note_en=str((row.get("tailings") or {}).get("en", "")),
            tailings_note_es=str((row.get("tailings") or {}).get("es", "")),
            transition_year=row.get("transition_year"), closure_year=row.get("closure_year"),
        ))
    return ContractReport(accepted=accepted, rejected=rejected, flagged=flagged)
