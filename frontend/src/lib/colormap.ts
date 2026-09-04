// Perceptually uniform colormaps (tables generated from matplotlib, see colormaps.json meta) and the
// mapping of a float raster to RGBA with an explicit value range. Jet and rainbow are never used.
import tables from './colormaps.json';

export type ColormapName = 'viridis' | 'cividis' | 'inferno' | 'magma' | 'RdBu';

const MAPS = tables.maps as Record<ColormapName, number[][]>;

export function lut(name: ColormapName): Uint8Array {
  const t = MAPS[name];
  const out = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const c = t[i]!;
    out[i * 3] = c[0]!;
    out[i * 3 + 1] = c[1]!;
    out[i * 3 + 2] = c[2]!;
  }
  return out;
}

/** Maps values to RGBA through the colormap; NaN and (optionally) invalid pixels are transparent. */
export function colorize(
  values: Float32Array,
  width: number,
  height: number,
  name: ColormapName,
  lo: number,
  hi: number,
  valid?: Uint8Array,
): Uint8ClampedArray {
  const table = lut(name);
  const out = new Uint8ClampedArray(width * height * 4);
  const span = hi - lo || 1e-9;
  for (let i = 0; i < width * height; i++) {
    const v = values[i]!;
    if (Number.isNaN(v) || (valid && !valid[i])) continue;
    let t = (v - lo) / span;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const k = Math.round(t * 255) * 3;
    out[i * 4] = table[k]!;
    out[i * 4 + 1] = table[k + 1]!;
    out[i * 4 + 2] = table[k + 2]!;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** A CSS gradient string for a legend bar. */
export function cssGradient(name: ColormapName, stops = 16): string {
  const t = MAPS[name];
  const parts: string[] = [];
  for (let s = 0; s < stops; s++) {
    const i = Math.round((s / (stops - 1)) * 255);
    const c = t[i]!;
    parts.push(`rgb(${c[0]},${c[1]},${c[2]}) ${((s / (stops - 1)) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to right, ${parts.join(', ')})`;
}
