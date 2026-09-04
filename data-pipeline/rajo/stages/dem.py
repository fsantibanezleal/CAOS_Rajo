"""Stage dem: the relief lane (M12). Two global elevation surfaces a decade apart on the site's 30 m grid,
their difference, the noise floor of that difference on stable ground, cut and fill volumes, and the
per-site terrain tiles of the later epoch so the map can switch its relief to 2011 to 2015.

Surfaces (research-02 s.3):
- SRTM GL1 (February 2000, C-band radar, 30 m, void-filled v3; EGM96 orthometric heights), 1 x 1 degree
  GeoTIFF tiles from OpenTopography (Farr et al. 2007, doi:10.1029/2005RG000183).
- Copernicus DEM GLO-30 (TanDEM-X acquisitions 2011 to 2015, X-band radar, 30 m; EGM2008 orthometric
  heights), COG tiles on AWS (produced using Copernicus WorldDEM-30, DLR e.V. 2010-2014 and Airbus
  Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA).

Method: both surfaces are warped onto the site's 30 m grid (first data wins over tile seams); the
SRTM heights are moved from EGM96 to EGM2008 with the per-site geoid difference (PROJ grids through the
PROJ network; when the grids are unavailable the offset is null and the difference carries the flag
``geoid_uncorrected``); delta = COP - SRTM. The noise floor is 1.4826 x MAD of delta over stable ground
(outside the reference envelope, slope below 10 degrees on the Copernicus surface); tau = 2 x floor.
Cut volume = sum of |delta| where delta < -tau, fill = sum of delta where delta > tau, each over the
envelope and over the whole window, with cell area 900 m2. Both are surface models and the interval is
one decade: a pit deepened after 2015 shows nothing here (the time-lapse does).

Outputs under sites/<id>/: dem/delta.png (diverging colour, transparent where either surface has no
data), dem/srtm.png and dem/cop.png (hillshades), terrain/<z>/<x>/<y>.png (terrarium tiles of the
Copernicus surface, zooms 10 to 13, Web Mercator), dem.json. Resumable per site.
"""
from __future__ import annotations

import io
import math
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import Affine
from rasterio.vrt import WarpedVRT

from ..manifest import read_json, write_json
from ..paths import data_root
from ..raster import GDAL_ENV, Grid
from .frames import LANDSAT_FACTOR, _grid_of
from .masks import _envelope

SRTM_URL = "https://opentopography.s3.sdsc.edu/raster/SRTM_GL1/SRTM_GL1_srtm/{lat}{lon}.tif"
COP_URL = ("https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_{lat}_00_{lon}_00_DEM/"
           "Copernicus_DSM_COG_10_{lat}_00_{lon}_00_DEM.tif")
TILE_ZOOMS = (10, 11, 12, 13)
TILE_PX = 256
STABLE_SLOPE_DEG = 10.0
TAU_FACTOR = 2.0
CELL_AREA_M2 = 30.0 * 30.0


def _tiles_for(bbox: tuple[float, float, float, float]) -> list[tuple[str, str]]:
    """The 1 x 1 degree tiles (lat tag, lon tag) covering the bbox, e.g. ('S23', 'W069')."""
    minx, miny, maxx, maxy = bbox
    out = []
    for lat in range(math.floor(miny), math.floor(maxy) + 1):
        for lon in range(math.floor(minx), math.floor(maxx) + 1):
            out.append((f"{'N' if lat >= 0 else 'S'}{abs(lat):02d}", f"{'E' if lon >= 0 else 'W'}{abs(lon):03d}"))
    return out


def _read_surface(urls: list[str], grid: Grid, log) -> tuple[np.ndarray, np.ndarray]:
    h, w = grid.height, grid.width
    out = np.full((h, w), np.nan, dtype=np.float32)
    for url in urls:
        try:
            with rasterio.Env(**GDAL_ENV), rasterio.open(url) as src:
                nodata = src.nodata
                # add_alpha: the warped extent outside the tile is marked invalid even when the tile
                # declares no nodata (the Copernicus COGs do not), otherwise zeros fill the far side
                with WarpedVRT(src, crs=CRS.from_epsg(grid.epsg), transform=grid.transform, width=w, height=h,
                               resampling=Resampling.bilinear, nodata=nodata, add_alpha=True) as vrt:
                    arr = vrt.read(1, out_dtype="float32")
                    mask = vrt.read(vrt.count) > 0  # the alpha band: 0 outside the tile's extent
            if nodata is not None:
                mask &= arr != np.float32(nodata)
            mask &= np.isfinite(arr) & (arr > -500) & (arr < 9000)
            fill = np.isnan(out) & mask
            out[fill] = arr[fill]
            log(f"    {url.rsplit('/', 1)[-1]}: {float(mask.mean()):.3f} of the window")
        except Exception as exc:  # a missing tile (ocean, void) is recorded, the others still fill
            log(f"    {url.rsplit('/', 1)[-1]}: unreadable ({type(exc).__name__})")
    return out, np.isfinite(out)


def _geoid_offset(lon: float, lat: float) -> float | None:
    """EGM96 minus EGM2008 geoid undulation at the site centre (metres), or None without the grids."""
    try:
        from pyproj import Transformer, network

        network.set_network_enabled(True)
        egm96 = Transformer.from_crs("EPSG:4326+5773", "EPSG:4979", always_xy=True)
        egm08 = Transformer.from_crs("EPSG:4326+3855", "EPSG:4979", always_xy=True)
        _x, _y, h96 = egm96.transform(lon, lat, 0.0)
        _x, _y, h08 = egm08.transform(lon, lat, 0.0)
        if not (np.isfinite(h96) and np.isfinite(h08)) or abs(h96) > 200 or abs(h08) > 200:
            return None
        return float(h96 - h08)
    except Exception:
        return None


def _slope_deg(z: np.ndarray, pixel_m: float) -> np.ndarray:
    zf = np.where(np.isfinite(z), z, np.nanmean(z))
    gy, gx = np.gradient(zf, pixel_m)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def _hillshade(z: np.ndarray, pixel_m: float, az_deg: float = 315.0, alt_deg: float = 45.0) -> np.ndarray:
    zf = np.where(np.isfinite(z), z, np.nanmean(z))
    gy, gx = np.gradient(zf, pixel_m)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az = np.radians(az_deg)
    alt = np.radians(alt_deg)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip((shade + 0.15) / 1.15, 0, 1)


def _png_gray(a: np.ndarray, valid: np.ndarray) -> bytes:
    rgba = np.zeros((*a.shape, 4), dtype=np.uint8)
    rgba[..., :3] = np.round(np.clip(a, 0, 1) * 255).astype(np.uint8)[..., None]
    rgba[..., 3] = np.where(valid, 255, 0).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _png_delta(delta: np.ndarray, valid: np.ndarray, vmax: float) -> bytes:
    """Diverging blue (cut, lower) to white to red (fill, higher), symmetric about zero."""
    t = np.clip(delta / max(vmax, 1e-6), -1, 1)
    r = np.where(t >= 0, 255, 255 * (1 + t) * 0.35 + 30 * (1 + t)).astype(np.float32)
    g = np.where(t >= 0, 255 * (1 - t), 255 * (1 + t)).astype(np.float32)
    b = np.where(t >= 0, 255 * (1 - t), 255).astype(np.float32)
    rgba = np.zeros((*delta.shape, 4), dtype=np.uint8)
    rgba[..., 0] = np.clip(r, 0, 255)
    rgba[..., 1] = np.clip(g, 0, 255)
    rgba[..., 2] = np.clip(b, 0, 255)
    rgba[..., 3] = np.where(valid, np.clip(np.abs(t) * 255 + 40, 40, 235), 0).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(buf, format="PNG", optimize=True)
    return buf.getvalue()


# --- terrarium tiles of the Copernicus surface ------------------------------------------------------

def _tile_bounds_3857(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    n = 2 ** z
    world = 20037508.342789244
    size = 2 * world / n
    left = -world + x * size
    top = world - y * size
    return left, top - size, left + size, top


def _lonlat_to_tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    lat_r = math.radians(lat)
    y = int((1.0 - math.log(math.tan(lat_r) + 1.0 / math.cos(lat_r)) / math.pi) / 2.0 * n)
    return x, y


def _terrarium_png(elev: np.ndarray, valid: np.ndarray) -> bytes:
    v = np.where(valid, elev, 0.0) + 32768.0
    r = np.floor(v / 256.0)
    g = np.floor(v - r * 256.0)
    b = np.floor((v - r * 256.0 - g) * 256.0)
    rgb = np.stack([r, g, b], axis=-1).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(rgb, mode="RGB").save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _bake_tiles(cop_urls: list[str], bbox: tuple[float, float, float, float], out_dir: Path, log) -> list[str]:
    """Web Mercator terrarium tiles of the Copernicus surface over the bbox, zooms TILE_ZOOMS."""
    written: list[str] = []
    minx, miny, maxx, maxy = bbox
    with rasterio.Env(**GDAL_ENV):
        srcs = []
        for url in cop_urls:
            try:
                srcs.append(rasterio.open(url))
            except Exception:
                continue
        try:
            for z in TILE_ZOOMS:
                x0, y0 = _lonlat_to_tile(minx, maxy, z)
                x1, y1 = _lonlat_to_tile(maxx, miny, z)
                for x in range(x0, x1 + 1):
                    for y in range(y0, y1 + 1):
                        left, bottom, right, top = _tile_bounds_3857(z, x, y)
                        transform = Affine((right - left) / TILE_PX, 0, left, 0, -(top - bottom) / TILE_PX, top)
                        elev = np.full((TILE_PX, TILE_PX), np.nan, dtype=np.float32)
                        for src in srcs:
                            with WarpedVRT(src, crs=CRS.from_epsg(3857), transform=transform, width=TILE_PX, height=TILE_PX,
                                           resampling=Resampling.bilinear, nodata=src.nodata, add_alpha=True) as vrt:
                                arr = vrt.read(1, out_dtype="float32")
                                m = vrt.read(vrt.count) > 0  # the alpha band marks the tile's extent
                            if src.nodata is not None:
                                m &= arr != np.float32(src.nodata)
                            fill = np.isnan(elev) & m
                            elev[fill] = arr[fill]
                        valid = np.isfinite(elev)
                        if not valid.any():
                            continue
                        rel = f"terrain/{z}/{x}/{y}.png"
                        p = out_dir / rel
                        p.parent.mkdir(parents=True, exist_ok=True)
                        p.write_bytes(_terrarium_png(elev, valid))
                        written.append(rel)
                log(f"    zoom {z}: {sum(1 for w in written if w.startswith(f'terrain/{z}/'))} tiles")
        finally:
            for s in srcs:
                s.close()
    return written


def _volumes(delta_c: np.ndarray, tau: float, sel: np.ndarray) -> dict:
    """Cut and fill over the selection: cells below -tau count as cut, above +tau as fill (30 m cells)."""
    cut = float(np.nansum(np.where(sel & (delta_c < -tau), -delta_c, 0.0)) * CELL_AREA_M2)
    fill = float(np.nansum(np.where(sel & (delta_c > tau), delta_c, 0.0)) * CELL_AREA_M2)
    n_cut = int(np.nansum(sel & (delta_c < -tau)))
    n_fill = int(np.nansum(sel & (delta_c > tau)))
    inside = np.where(sel, delta_c, np.nan)
    return {"cut_m3": round(cut), "fill_m3": round(fill), "cut_km2": round(n_cut * CELL_AREA_M2 / 1e6, 4),
            "fill_km2": round(n_fill * CELL_AREA_M2 / 1e6, 4),
            "min_m": round(float(np.nanmin(inside)), 1) if sel.any() else None,
            "max_m": round(float(np.nanmax(inside)), 1) if sel.any() else None}


def run_stage(ctx) -> None:
    _ = data_root(ctx.repo_root)
    for d in sorted(p for p in ctx.sites_dir.iterdir() if p.is_dir()):
        if ctx.sites and d.name not in ctx.sites:
            continue
        out_path = d / "dem.json"
        if ctx.resume and out_path.exists():
            ctx.log(f"{d.name}: dem.json exists, skipped (resume)")
            continue
        site_doc = read_json(d / "site.json")
        grid = _grid_of(site_doc).coarse(LANDSAT_FACTOR)
        bbox = tuple(site_doc["window"]["bbox_wgs84"])
        tiles = _tiles_for(bbox)
        ctx.log(f"{d.name}: {len(tiles)} degree tile(s) {tiles}")
        srtm, srtm_ok = _read_surface([SRTM_URL.format(lat=a, lon=b) for a, b in tiles], grid, ctx.log)
        cop, cop_ok = _read_surface([COP_URL.format(lat=a, lon=b) for a, b in tiles], grid, ctx.log)
        valid = srtm_ok & cop_ok
        if valid.mean() < 0.5:
            ctx.log(f"{d.name}: only {valid.mean():.2f} of the window has both surfaces; recorded, no volumes")
            write_json(out_path, {"site_id": d.name, "status": "insufficient", "coverage": round(float(valid.mean()), 3)})
            continue
        offset = _geoid_offset(float(site_doc["site"]["lon"]), float(site_doc["site"]["lat"]))
        flags: list[str] = []
        srtm_adj = srtm + (offset if offset is not None else 0.0)
        if offset is None:
            flags.append("geoid_uncorrected")
        delta = np.where(valid, cop - srtm_adj, np.nan).astype(np.float32)
        envelope = _envelope(d, grid)
        slope = _slope_deg(cop, grid.pixel_m)
        stable = valid & ~envelope & (slope < STABLE_SLOPE_DEG)
        if stable.sum() < 500:
            stable = valid & ~envelope
            flags.append("stable_ground_includes_slopes")
        dstable = delta[stable]
        floor = float(1.4826 * np.median(np.abs(dstable - np.median(dstable)))) if dstable.size else float("nan")
        bias = float(np.median(dstable)) if dstable.size else 0.0
        tau = TAU_FACTOR * floor if np.isfinite(floor) else 0.0
        # the median offset over stable ground is removed (datum and tie-point residue), then thresholds
        delta_c = delta - bias
        env_v = _volumes(delta_c, tau, valid & envelope)
        win_v = _volumes(delta_c, tau, valid)
        vmax = float(np.nanpercentile(np.abs(delta_c[valid & envelope]), 98)) if (valid & envelope).any() else 10.0
        vmax = max(vmax, 5.0)
        dem_dir = d / "dem"
        dem_dir.mkdir(parents=True, exist_ok=True)
        (dem_dir / "delta.png").write_bytes(_png_delta(delta_c, valid, vmax))
        (dem_dir / "srtm.png").write_bytes(_png_gray(_hillshade(srtm, grid.pixel_m), srtm_ok))
        (dem_dir / "cop.png").write_bytes(_png_gray(_hillshade(cop, grid.pixel_m), cop_ok))
        ctx.log(f"{d.name}: baking terrain tiles of the Copernicus surface")
        terrain_tiles = _bake_tiles([COP_URL.format(lat=a, lon=b) for a, b in tiles], bbox, d, ctx.log)
        doc = {
            "site_id": d.name, "status": "ok", "grid_m": grid.pixel_m, "coverage": round(float(valid.mean()), 4),
            "epochs": [
                {"id": "srtm2000", "source": "SRTM GL1 v3 (OpenTopography), EGM96", "date_range": "2000-02"},
                {"id": "cop2011_2015", "source": "Copernicus DEM GLO-30 (TanDEM-X), EGM2008", "date_range": "2011 to 2015"},
            ],
            "delta_png": "dem/delta.png", "srtm_png": "dem/srtm.png", "cop_png": "dem/cop.png",
            "delta_range_m": [round(-vmax, 1), round(vmax, 1)],
            "geoid_offset_m": round(offset, 3) if offset is not None else None,
            "stable_bias_m": round(bias, 3), "noise_floor_m": round(floor, 3) if np.isfinite(floor) else None,
            "tau_m": round(tau, 3), "stable_ground_px": int(stable.sum()), "stable_rule": f"outside the envelope and slope below {STABLE_SLOPE_DEG:.0f} degrees",
            "cut_volume_m3": env_v["cut_m3"], "fill_volume_m3": env_v["fill_m3"],
            "envelope": env_v, "window": win_v, "flags": flags,
            "terrain_tiles": terrain_tiles, "terrain_tile_zooms": [TILE_ZOOMS[0], TILE_ZOOMS[-1]],
            "srtm_stats": {"min": round(float(np.nanmin(srtm)), 1), "max": round(float(np.nanmax(srtm)), 1)},
            "cop_stats": {"min": round(float(np.nanmin(cop)), 1), "max": round(float(np.nanmax(cop)), 1)},
        }
        write_json(out_path, doc)
        ctx.log(f"{d.name}: delta over the envelope cut {env_v['cut_m3'] / 1e6:.1f} Mm3, fill {env_v['fill_m3'] / 1e6:.1f} Mm3, "
                f"floor {floor:.2f} m, tau {tau:.2f} m, geoid {offset}, {len(terrain_tiles)} tiles{' ' + ' '.join(flags) if flags else ''}")
