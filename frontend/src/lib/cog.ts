// Windowed reads of Sentinel-2 cloud-optimized GeoTIFFs in the browser (geotiff.js, HTTP range requests,
// a worker pool for decoding). A same-day item group is read onto ONE target grid in the site's UTM zone:
// each item's overlap with the window is requested at the target resolution and placed by pixel offset
// (Sentinel-2 tiles of one zone share the 10 m grid). Items in another zone are skipped and reported.
import { fromUrl, Pool } from 'geotiff';

import type { Bands } from './indices';
import type { S2DateGroup } from './stac';

let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) pool = new Pool();
  return pool;
}

export interface ReadGrid {
  epsg: number;
  left: number;
  top: number;
  pixelM: number;
  width: number;
  height: number;
}

export interface LiveRead {
  grid: ReadGrid;
  bands: Bands;
  clear: Uint8Array; // quality-mask clear (SCL not cloud/shadow/cirrus/no data)
  snow: Uint8Array;
  sclRaw: Uint8Array;
  itemsRead: string[];
  itemsSkipped: string[];
  bytes: number;
  ms: number;
}

const SCL_INVALID = new Set([0, 1, 3, 8, 9, 10]);
const SCL_SNOW = 11;

export function liveGrid(siteEpsg: number, left: number, top: number, widthPx10m: number, heightPx10m: number, maxPx = 1600): ReadGrid {
  // choose 10, 20 or 40 m so the larger side stays at or below maxPx
  const factor = widthPx10m <= maxPx ? 1 : widthPx10m <= 2 * maxPx ? 2 : 4;
  return { epsg: siteEpsg, left, top, pixelM: 10 * factor, width: Math.floor(widthPx10m / factor), height: Math.floor(heightPx10m / factor) };
}

export function readProgress(cb: (msg: string) => void): (msg: string) => void {
  return cb;
}

export async function readGroup(
  group: S2DateGroup,
  grid: ReadGrid,
  onProgress?: (done: number, total: number, note: string) => void,
  signal?: AbortSignal,
): Promise<LiveRead> {
  const t0 = performance.now();
  const n = grid.width * grid.height;
  const mk = () => new Float32Array(n).fill(NaN);
  const bands: Bands = {
    width: grid.width,
    height: grid.height,
    blue: mk(),
    green: mk(),
    red: mk(),
    nir: mk(),
    swir16: mk(),
    swir22: mk(),
    valid: new Uint8Array(n),
  };
  const data = new Uint8Array(n);
  const clear = new Uint8Array(n);
  const snow = new Uint8Array(n);
  const sclRaw = new Uint8Array(n);
  const itemsRead: string[] = [];
  const itemsSkipped: string[] = [];
  let bytes = 0;
  const keys = ['blue', 'green', 'red', 'nir', 'swir16', 'swir22'] as const;
  const total = group.items.length * (keys.length + 1);
  let done = 0;

  for (const item of group.items) {
    if (item.epsg !== grid.epsg) {
      itemsSkipped.push(`${item.id} (EPSG:${item.epsg})`);
      continue;
    }
    // the item's SCL defines its footprint on the grid; read it first, at the grid resolution
    const scl = await readWindow(item.assets.scl.href, grid, 'nearest', signal);
    done++;
    onProgress?.(done, total, item.id);
    if (!scl) {
      itemsSkipped.push(`${item.id} (no overlap)`);
      continue;
    }
    bytes += scl.bytes;
    const arrays: Record<string, Float32Array> = {};
    for (const k of keys) {
      const r = await readWindow(item.assets[k].href, grid, 'bilinear', signal);
      done++;
      onProgress?.(done, total, `${item.id} ${k}`);
      if (!r) break;
      bytes += r.bytes;
      const a = new Float32Array(n).fill(NaN);
      const { scale, offset } = item.assets[k];
      for (let i = 0; i < n; i++) {
        const dn = r.values[i]!;
        if (dn > 0) a[i] = dn * scale + offset;
      }
      arrays[k] = a;
    }
    if (Object.keys(arrays).length < keys.length) {
      itemsSkipped.push(`${item.id} (band read failed)`);
      continue;
    }
    // first data wins
    for (let i = 0; i < n; i++) {
      if (data[i]) continue;
      const s = scl.values[i]!;
      const ok = s > 0 && keys.every((k) => Number.isFinite(arrays[k]![i]!));
      if (!ok) continue;
      data[i] = 1;
      sclRaw[i] = s;
      clear[i] = SCL_INVALID.has(s) ? 0 : 1;
      snow[i] = s === SCL_SNOW ? 1 : 0;
      for (const k of keys) bands[k][i] = arrays[k]![i]!;
    }
    itemsRead.push(item.id);
  }
  for (let i = 0; i < n; i++) bands.valid[i] = data[i] && clear[i] ? 1 : 0;
  return { grid, bands, clear, snow, sclRaw, itemsRead, itemsSkipped, bytes, ms: performance.now() - t0 };
}

interface WindowRead {
  values: Float32Array | Uint8Array | Uint16Array;
  bytes: number;
}

/** Reads the raster's overlap with the grid at the grid's resolution, placed into a full-grid array
 *  (zeros outside the overlap). Returns null when the raster does not overlap the grid. */
async function readWindow(href: string, grid: ReadGrid, method: 'nearest' | 'bilinear', signal?: AbortSignal): Promise<WindowRead | null> {
  const tiff = await fromUrl(href, { allowFullFile: false, fetchOptions: signal ? { signal } : undefined });
  const image = await tiff.getImage(0);
  const [ox, oy] = image.getOrigin();
  const [rx, ry] = image.getResolution();
  const iw = image.getWidth();
  const ih = image.getHeight();
  const ires = Math.abs(rx);
  const iresY = Math.abs(ry);
  // raster extent in CRS units
  const iLeft = ox;
  const iTop = oy;
  const iRight = ox + iw * ires;
  const iBottom = oy - ih * iresY;
  const gRight = grid.left + grid.width * grid.pixelM;
  const gBottom = grid.top - grid.height * grid.pixelM;
  const left = Math.max(grid.left, iLeft);
  const right = Math.min(gRight, iRight);
  const top = Math.min(grid.top, iTop);
  const bottom = Math.max(gBottom, iBottom);
  if (right - left <= 0 || top - bottom <= 0) return null;
  // grid pixel range of the overlap (snap to the grid)
  const gx0 = Math.round((left - grid.left) / grid.pixelM);
  const gy0 = Math.round((grid.top - top) / grid.pixelM);
  const gx1 = Math.round((right - grid.left) / grid.pixelM);
  const gy1 = Math.round((grid.top - bottom) / grid.pixelM);
  const w = gx1 - gx0;
  const h = gy1 - gy0;
  if (w <= 0 || h <= 0) return null;
  const bbox: [number, number, number, number] = [grid.left + gx0 * grid.pixelM, grid.top - gy1 * grid.pixelM, grid.left + gx1 * grid.pixelM, grid.top - gy0 * grid.pixelM];
  const rasters = await tiff.readRasters({ bbox, width: w, height: h, resampleMethod: method, pool: getPool(), signal } as never);
  const arr = (rasters as unknown as Array<Uint16Array | Uint8Array | Float32Array>)[0]!;
  const out = new Float32Array(grid.width * grid.height);
  for (let y = 0; y < h; y++) {
    const row = (gy0 + y) * grid.width + gx0;
    const src = y * w;
    for (let x = 0; x < w; x++) out[row + x] = arr[src + x]!;
  }
  return { values: out, bytes: arr.byteLength };
}
