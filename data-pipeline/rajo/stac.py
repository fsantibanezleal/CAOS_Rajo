"""STAC search for the two archives the bake reads.

Sentinel-2 L2A (2017 to today) comes from Earth Search v1 (Element 84, AWS Open Data); Landsat Collection 2
Level-2 (1982 to today) comes from Microsoft Planetary Computer, whose assets are signed with an anonymous
SAS token at read time. Both searches return CANDIDATES for a site-year. A candidate is a DATE GROUP: every
item acquired on the same day whose footprint touches the site window (a window can straddle a Sentinel-2
tile edge or a Landsat row boundary; the same-day neighbours are the same orbit pass, so the frames stage
mosaics them). Candidates are ordered by union coverage, then scene cloud cover. The frames stage decides
among them from the cloud fraction measured INSIDE the window, which the scene-wide number cannot tell.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Any

from pystac_client import Client
from shapely.geometry import box, shape
from shapely.ops import unary_union

EARTH_SEARCH = "https://earth-search.aws.element84.com/v1"
PLANETARY_COMPUTER = "https://planetarycomputer.microsoft.com/api/stac/v1"

# channel -> asset key in each collection
S2_BANDS = {"blue": "blue", "green": "green", "red": "red", "nir": "nir", "swir16": "swir16", "swir22": "swir22", "scl": "scl"}
LANDSAT_BANDS = {"blue": "blue", "green": "green", "red": "red", "nir": "nir08", "swir16": "swir16", "swir22": "swir22", "qa": "qa_pixel"}

MAX_CANDIDATES = 6
SCENE_CLOUD_MAX = 60.0


@dataclass
class Asset:
    href: str
    scale: float | None = None
    offset: float | None = None

    def to_json(self) -> dict[str, Any]:
        return {"href": self.href, "scale": self.scale, "offset": self.offset}


@dataclass
class Item:
    id: str
    assets: dict[str, Asset]
    epsg: int | None
    coverage: float
    extra: dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        return {"id": self.id, "assets": {k: v.to_json() for k, v in self.assets.items()}, "epsg": self.epsg,
                "coverage": round(self.coverage, 4), "extra": self.extra}


@dataclass
class Candidate:
    """A same-day group of items over the window."""
    date: str
    sensor: str
    collection: str
    cloud_scene_pct: float
    coverage: float
    items: list[Item]

    @property
    def id(self) -> str:
        return "+".join(i.id for i in self.items)

    def to_json(self) -> dict[str, Any]:
        return {"date": self.date, "sensor": self.sensor, "collection": self.collection,
                "cloud_scene_pct": round(self.cloud_scene_pct, 2), "coverage": round(self.coverage, 4),
                "items": [i.to_json() for i in self.items]}


def season_range(year: int, start_month: int, end_month: int) -> tuple[str, str]:
    """The season window that names frame ``year``. A wrapping season (start > end, e.g. November to
    March) starts in the previous calendar year and ends in ``year``."""
    if start_month > end_month:
        start = dt.date(year - 1, start_month, 1)
    else:
        start = dt.date(year, start_month, 1)
    if end_month == 12:
        end = dt.date(year, 12, 31)
    else:
        end = dt.date(year, end_month + 1, 1) - dt.timedelta(days=1)
    return start.isoformat(), end.isoformat()


def _sensor_of(platform: str) -> str:
    p = platform.lower().replace("_", "-")
    if p.startswith("sentinel-2"):
        return p if p in ("sentinel-2a", "sentinel-2b", "sentinel-2c") else "sentinel-2a"
    return p


def _epsg(props: dict[str, Any]) -> int | None:
    v = props.get("proj:epsg")
    if isinstance(v, int):
        return v
    code = props.get("proj:code")
    if isinstance(code, str) and code.upper().startswith("EPSG:"):
        try:
            return int(code.split(":")[1])
        except ValueError:
            return None
    return None


def _asset(item_asset) -> Asset:
    bands = item_asset.extra_fields.get("raster:bands") or []
    scale = offset = None
    if bands and isinstance(bands, list) and isinstance(bands[0], dict):
        scale = bands[0].get("scale")
        offset = bands[0].get("offset")
    return Asset(href=item_asset.href, scale=scale, offset=offset)


def group_by_date(records: list[tuple[str, str, float, Item]], collection: str,
                  window_bbox: tuple[float, float, float, float]) -> list[Candidate]:
    """records: (date, sensor, cloud_scene_pct, item) -> same-day candidates ranked by coverage then cloud."""
    w = box(*window_bbox)
    groups: dict[tuple[str, str], list[tuple[float, Item]]] = {}
    for date, sensor, cloud, item in records:
        groups.setdefault((date, sensor), []).append((cloud, item))
    out: list[Candidate] = []
    for (date, sensor), rows in groups.items():
        rows.sort(key=lambda r: -r[1].coverage)
        items = [r[1] for r in rows]
        union = unary_union([shape(i.extra["geometry"]) for i in items if i.extra.get("geometry")])
        coverage = float(union.intersection(w).area / w.area) if not union.is_empty and w.area > 0 else 0.0
        # the scene cloud number of the group is the coverage-weighted mean of its members
        wsum = sum(i.coverage for i in items) or 1.0
        cloud = sum(c * i.coverage for c, i in rows) / wsum
        for i in items:
            i.extra.pop("geometry", None)
        out.append(Candidate(date=date, sensor=sensor, collection=collection, cloud_scene_pct=cloud,
                             coverage=coverage, items=items))
    full = [c for c in out if c.coverage >= 0.995]
    partial = [c for c in out if c.coverage < 0.995]
    full.sort(key=lambda c: (c.cloud_scene_pct, c.date))
    partial.sort(key=lambda c: (-c.coverage, c.cloud_scene_pct, c.date))
    return (full + partial)[:MAX_CANDIDATES]


def _coverage(item_geom: dict[str, Any], window_bbox: tuple[float, float, float, float]) -> float:
    w = box(*window_bbox)
    g = shape(item_geom)
    return float(g.intersection(w).area / w.area) if w.area > 0 else 0.0


def search_sentinel2(client: Client, window_bbox: tuple[float, float, float, float], start: str, end: str) -> list[Candidate]:
    search = client.search(
        collections=["sentinel-2-l2a"],
        intersects=box(*window_bbox).__geo_interface__,
        datetime=f"{start}T00:00:00Z/{end}T23:59:59Z",
        query={"eo:cloud_cover": {"lt": SCENE_CLOUD_MAX}},
        max_items=80,
    )
    records: list[tuple[str, str, float, Item]] = []
    for it in search.items():
        p = it.properties
        assets = {k: _asset(it.assets[v]) for k, v in S2_BANDS.items() if v in it.assets}
        if len(assets) < len(S2_BANDS) or it.geometry is None:
            continue
        item = Item(id=it.id, assets=assets, epsg=_epsg(p), coverage=_coverage(it.geometry, window_bbox),
                    extra={"geometry": it.geometry, "baseline": p.get("s2:processing_baseline"),
                           "boa_offset_applied": p.get("earthsearch:boa_offset_applied"), "mgrs": p.get("grid:code")})
        records.append((str(p.get("datetime", ""))[:10], _sensor_of(str(p.get("platform", "sentinel-2a"))),
                        float(p.get("eo:cloud_cover", 100.0)), item))
    return group_by_date(records, "sentinel-2-l2a", window_bbox)


def search_landsat(client: Client, window_bbox: tuple[float, float, float, float], start: str, end: str,
                   platforms: tuple[str, ...]) -> list[Candidate]:
    search = client.search(
        collections=["landsat-c2-l2"],
        intersects=box(*window_bbox).__geo_interface__,
        datetime=f"{start}T00:00:00Z/{end}T23:59:59Z",
        query={"eo:cloud_cover": {"lt": SCENE_CLOUD_MAX}, "platform": {"in": list(platforms)}},
        max_items=80,
    )
    records: list[tuple[str, str, float, Item]] = []
    for it in search.items():
        p = it.properties
        assets = {k: _asset(it.assets[v]) for k, v in LANDSAT_BANDS.items() if v in it.assets}
        if len(assets) < len(LANDSAT_BANDS) or it.geometry is None:
            continue
        item = Item(id=it.id, assets=assets, epsg=_epsg(p), coverage=_coverage(it.geometry, window_bbox),
                    extra={"geometry": it.geometry, "wrs_path": p.get("landsat:wrs_path"), "wrs_row": p.get("landsat:wrs_row"),
                           "tier": p.get("landsat:collection_category")})
        records.append((str(p.get("datetime", ""))[:10], _sensor_of(str(p.get("platform", "landsat-5"))),
                        float(p.get("eo:cloud_cover", 100.0)), item))
    return group_by_date(records, "landsat-c2-l2", window_bbox)


def landsat_platforms_for(year: int) -> tuple[str, ...]:
    """Landsat 5 to 2011 (its last full year), Landsat 7 as the 2012 bridge (SLC-off stripes are handled
    downstream by compositing), Landsat 8 and 9 from 2013. Landsat 7 is the second choice before 2012."""
    if year <= 2011:
        return ("landsat-5", "landsat-7")
    if year == 2012:
        return ("landsat-7",)
    return ("landsat-8", "landsat-9", "landsat-7")


def open_clients() -> tuple[Client, Client]:
    return Client.open(EARTH_SEARCH), Client.open(PLANETARY_COMPUTER)
