"""Geometry helpers: UTM zone selection, the site window grid, and a small GeoPackage reader for the
reference mining polygons (stdlib sqlite3 + shapely; no GDAL needed for the vector side).

The site window is a square of side ``window_km`` centred on the seed, expressed on the UTM grid of the
seed at 10 m pixels with the origin snapped to a multiple of 10 m, so every frame of a site shares one
pixel grid across sensors and years (the property the time series depends on).
"""
from __future__ import annotations

import math
import sqlite3
import struct
from dataclasses import dataclass
from pathlib import Path

from pyproj import CRS, Transformer
from shapely import wkb
from shapely.geometry import Point, box
from shapely.geometry.base import BaseGeometry

PIXEL_M = 10.0


def utm_epsg(lon: float, lat: float) -> int:
    zone = int(math.floor((lon + 180) / 6)) + 1
    zone = max(1, min(60, zone))
    return (32600 if lat >= 0 else 32700) + zone


@dataclass(frozen=True)
class Window:
    epsg: int
    left: float
    top: float
    right: float
    bottom: float
    pixel_m: float
    width: int
    height: int

    @property
    def transform(self) -> tuple[float, float, float, float, float, float]:
        # affine (a, b, c, d, e, f): x = a*col + b*row + c ; y = d*col + e*row + f
        return (self.pixel_m, 0.0, self.left, 0.0, -self.pixel_m, self.top)

    def bbox_wgs84(self) -> tuple[float, float, float, float]:
        t = Transformer.from_crs(CRS.from_epsg(self.epsg), CRS.from_epsg(4326), always_xy=True)
        xs, ys = zip(*[t.transform(x, y) for x, y in
                       [(self.left, self.bottom), (self.right, self.bottom), (self.right, self.top), (self.left, self.top)]], strict=True)
        return (min(xs), min(ys), max(xs), max(ys))

    def polygon_utm(self):
        return box(self.left, self.bottom, self.right, self.top)


def site_window(lon: float, lat: float, window_km: float, pixel_m: float = PIXEL_M) -> Window:
    epsg = utm_epsg(lon, lat)
    t = Transformer.from_crs(CRS.from_epsg(4326), CRS.from_epsg(epsg), always_xy=True)
    x, y = t.transform(lon, lat)
    # the width is a multiple of 3 pixels so the 30 m Landsat grid nests exactly inside the 10 m grid
    n = int(round(window_km * 1000.0 / (3 * pixel_m))) * 3
    half = n * pixel_m / 2.0
    left = math.floor((x - half) / (3 * pixel_m)) * (3 * pixel_m)
    top = math.ceil((y + half) / (3 * pixel_m)) * (3 * pixel_m)
    return Window(epsg=epsg, left=left, top=top, right=left + n * pixel_m, bottom=top - n * pixel_m,
                  pixel_m=pixel_m, width=n, height=n)


# --- GeoPackage reading (the Maus 2022 polygons) -----------------------------------------------------

def _gpkg_geom(blob: bytes) -> BaseGeometry | None:
    if blob is None or len(blob) < 8 or blob[:2] != b"GP":
        return None
    flags = blob[3]
    env = (flags >> 1) & 0x07
    env_size = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}.get(env, 0)
    return wkb.loads(blob[8 + env_size:])


def _gpkg_envelope(blob: bytes) -> tuple[float, float, float, float] | None:
    if blob is None or len(blob) < 40 or blob[:2] != b"GP":
        return None
    flags = blob[3]
    env = (flags >> 1) & 0x07
    if env == 0:
        return None
    little = bool(flags & 0x01)
    fmt = ("<" if little else ">") + "4d"
    minx, maxx, miny, maxy = struct.unpack(fmt, blob[8:40])
    return (minx, miny, maxx, maxy)


class MiningPolygons:
    """Reads the Maus et al. 2022 GeoPackage (WGS84) and answers bbox queries through its R-tree."""

    def __init__(self, gpkg_path: Path):
        self.path = Path(gpkg_path)
        self.conn = sqlite3.connect(f"file:{self.path.as_posix()}?mode=ro", uri=True)
        row = self.conn.execute("select table_name from gpkg_contents where data_type='features'").fetchone()
        if row is None:
            raise ValueError(f"{self.path}: no feature table")
        self.table = row[0]
        geom_row = self.conn.execute(
            "select column_name from gpkg_geometry_columns where table_name=?", (self.table,)).fetchone()
        self.geom_col = geom_row[0] if geom_row else "geom"
        pk = [r for r in self.conn.execute(f'pragma table_info("{self.table}")') if r[5] == 1]
        self.pk = pk[0][1] if pk else "fid"
        self.rtree = f"rtree_{self.table}_{self.geom_col}"
        has_rtree = self.conn.execute(
            "select 1 from sqlite_master where name=?", (self.rtree,)).fetchone() is not None
        self.has_rtree = has_rtree

    def count(self) -> int:
        return int(self.conn.execute(f'select count(*) from "{self.table}"').fetchone()[0])

    def within_bbox(self, minx: float, miny: float, maxx: float, maxy: float) -> list[tuple[int, str, float, BaseGeometry]]:
        """Returns (fid, country_iso3, area_km2, geometry) for every polygon intersecting the bbox."""
        if self.has_rtree:
            sql = (f'select t."{self.pk}", t.ISO3_CODE, t.AREA, t."{self.geom_col}" from "{self.table}" t '
                   f'join "{self.rtree}" r on t."{self.pk}" = r.id '
                   "where r.maxx >= ? and r.minx <= ? and r.maxy >= ? and r.miny <= ?")
            rows = self.conn.execute(sql, (minx, maxx, miny, maxy)).fetchall()
        else:
            rows = [r for r in self.conn.execute(
                f'select "{self.pk}", ISO3_CODE, AREA, "{self.geom_col}" from "{self.table}"')
                if (e := _gpkg_envelope(r[3])) and e[2] >= minx and e[0] <= maxx and e[3] >= miny and e[1] <= maxy]
        out = []
        b = box(minx, miny, maxx, maxy)
        for fid, iso3, area, blob in rows:
            g = _gpkg_geom(blob)
            if g is not None and g.intersects(b):
                out.append((int(fid), str(iso3), float(area), g))
        return out

    def nearest_km(self, lon: float, lat: float, search_km: float) -> float | None:
        dlat = search_km / 111.32
        dlon = search_km / (111.32 * max(0.05, math.cos(math.radians(lat))))
        cands = self.within_bbox(lon - dlon, lat - dlat, lon + dlon, lat + dlat)
        if not cands:
            return None
        p = Point(lon, lat)
        best = None
        for _fid, _iso, _area, g in cands:
            if g.contains(p):
                return 0.0
            q = g.exterior if g.geom_type == "Polygon" else g
            # project the nearest point to km with the local scale (good enough at a 12 km search radius)
            nearest = _nearest_point(q, p)
            d = _haversine_km(lon, lat, nearest.x, nearest.y)
            best = d if best is None else min(best, d)
        return best

    def close(self) -> None:
        self.conn.close()


def _nearest_point(geom: BaseGeometry, p: Point) -> Point:
    from shapely.ops import nearest_points
    return nearest_points(geom, p)[0]


def _haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))
