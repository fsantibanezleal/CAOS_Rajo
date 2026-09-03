"""Windowed raster reads onto the site grid, cloud masks, reflectance scaling, mosaics and the frame images.

Every read goes through a rasterio WarpedVRT onto the site's UTM grid (Contract 1 fixes the grid), so a
Sentinel-2 tile in a neighbouring UTM zone, a Landsat scene in its own zone and the two elevation models
all land on the same pixels. Sentinel-2 chips are read at 10 m; Landsat at 30 m on the aligned coarse grid
(the site width is a multiple of 3 pixels so the two grids nest exactly).
"""
from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
import rasterio
from PIL import Image
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import Affine
from rasterio.vrt import WarpedVRT

GDAL_ENV = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "GDAL_HTTP_MULTIRANGE": "YES",
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
    "GDAL_HTTP_MAX_RETRY": "4",
    "GDAL_HTTP_RETRY_DELAY": "2",
    "GDAL_CACHEMAX": 512,
    "VSI_CACHE": "TRUE",
    "VSI_CACHE_SIZE": "268435456",
    "CPL_VSIL_CURL_CACHE_SIZE": "268435456",
}

CHANNELS = ("blue", "green", "red", "nir", "swir16", "swir22")
REFL_SCALE = 10000.0  # stored uint16 = reflectance * 10000

# Sentinel-2 SCL classes treated as invalid for the frame (cloud, shadow, saturated, no data, cirrus)
SCL_INVALID = (0, 1, 3, 8, 9, 10)
SCL_SNOW = 11
# Landsat Collection 2 QA_PIXEL bits
QA_FILL, QA_DILATED, QA_CIRRUS, QA_CLOUD, QA_SHADOW, QA_SNOW = 0, 1, 2, 3, 4, 5


@dataclass(frozen=True)
class Grid:
    epsg: int
    left: float
    top: float
    pixel_m: float
    width: int
    height: int

    @property
    def transform(self) -> Affine:
        return Affine(self.pixel_m, 0.0, self.left, 0.0, -self.pixel_m, self.top)

    def coarse(self, factor: int) -> Grid:
        if self.width % factor or self.height % factor:
            raise ValueError(f"grid {self.width}x{self.height} is not a multiple of {factor}")
        return Grid(self.epsg, self.left, self.top, self.pixel_m * factor, self.width // factor, self.height // factor)


def read_onto_grid(href: str, grid: Grid, resampling: Resampling, dtype: str = "float32") -> np.ndarray:
    """Reads band 1 of a (remote) raster warped onto the grid. Nodata pixels come back as 0 for integer
    sources; the caller decides validity from the mask bands, never from a value."""
    with rasterio.Env(**GDAL_ENV), rasterio.open(href) as src:
        with WarpedVRT(src, crs=CRS.from_epsg(grid.epsg), transform=grid.transform, width=grid.width,
                       height=grid.height, resampling=resampling) as vrt:
            arr = vrt.read(1, out_dtype=dtype)
    return arr


def s2_validity(scl: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    invalid = np.isin(scl, SCL_INVALID)
    snow = scl == SCL_SNOW
    return ~invalid, snow


def landsat_validity(qa: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    q = qa.astype(np.uint16)
    bad = ((q >> QA_FILL) & 1) | ((q >> QA_DILATED) & 1) | ((q >> QA_CIRRUS) & 1) | ((q >> QA_CLOUD) & 1) | ((q >> QA_SHADOW) & 1)
    snow = ((q >> QA_SNOW) & 1).astype(bool)
    return bad == 0, snow


def to_reflectance(dn: np.ndarray, scale: float | None, offset: float | None, default_scale: float,
                   default_offset: float) -> np.ndarray:
    s = default_scale if scale is None else float(scale)
    o = default_offset if offset is None else float(offset)
    return dn.astype(np.float32) * np.float32(s) + np.float32(o)


def pack_reflectance(refl: np.ndarray) -> np.ndarray:
    return np.clip(np.round(refl * REFL_SCALE), 0, 65535).astype(np.uint16)


def unpack_reflectance(packed: np.ndarray) -> np.ndarray:
    return packed.astype(np.float32) / np.float32(REFL_SCALE)


def mosaic_into(dest: np.ndarray, dest_valid: np.ndarray, src: np.ndarray, src_valid: np.ndarray) -> None:
    """First valid pixel wins: fills only where the destination is still invalid."""
    fill = (~dest_valid) & src_valid
    dest[..., fill] = src[..., fill]
    dest_valid[fill] = True


def stretch_rgb(bands: np.ndarray, valid: np.ndarray, lo_pct: float = 2.0, hi_pct: float = 98.0,
                gamma: float = 1.0 / 1.35) -> tuple[np.ndarray, list[tuple[float, float]]]:
    """Per-band percentile clip over valid pixels, gamma, to uint8 RGB. Returns the image and the clip
    values so the app can print the stretch (a stretch is never hidden)."""
    out = np.zeros((bands.shape[1], bands.shape[2], 3), dtype=np.uint8)
    clips: list[tuple[float, float]] = []
    for k in range(3):
        b = bands[k]
        v = b[valid]
        if v.size < 100:
            lo, hi = 0.0, 0.5
        else:
            lo, hi = np.percentile(v, [lo_pct, hi_pct]).tolist()
            if hi <= lo:
                hi = lo + 1e-3
        x = np.clip((b - lo) / (hi - lo), 0, 1) ** gamma
        out[..., k] = np.round(x * 255).astype(np.uint8)
        clips.append((float(lo), float(hi)))
    out[~valid] = 0
    return out, clips


def encode_webp(rgb: np.ndarray, size: int, quality: int = 80) -> bytes:
    im = Image.fromarray(rgb, mode="RGB")
    if im.width != size:
        im = im.resize((size, int(round(size * im.height / im.width))), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="WEBP", quality=quality, method=6)
    return buf.getvalue()


def encode_png_mask(mask: np.ndarray) -> bytes:
    im = Image.fromarray((mask.astype(np.uint8) * 255), mode="L").convert("1")
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
