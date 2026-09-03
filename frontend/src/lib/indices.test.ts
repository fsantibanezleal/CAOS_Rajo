import { describe, expect, it } from 'vitest';

import { type Bands, bareMask, computeIndex, histogram, maskArea, otsuThreshold, percentiles, removeSmall } from './indices';

function bands(w: number, h: number, fill: (i: number) => Record<string, number>): Bands {
  const n = w * h;
  const b: Bands = {
    width: w,
    height: h,
    blue: new Float32Array(n),
    green: new Float32Array(n),
    red: new Float32Array(n),
    nir: new Float32Array(n),
    swir16: new Float32Array(n),
    swir22: new Float32Array(n),
    valid: new Uint8Array(n).fill(1),
  };
  for (let i = 0; i < n; i++) {
    const v = fill(i);
    b.blue[i] = v.blue ?? 0.05;
    b.green[i] = v.green ?? 0.08;
    b.red[i] = v.red ?? 0.1;
    b.nir[i] = v.nir ?? 0.2;
    b.swir16[i] = v.swir16 ?? 0.25;
    b.swir22[i] = v.swir22 ?? 0.2;
  }
  return b;
}

describe('indices', () => {
  it('ndvi is high for vegetation and near zero for bare rock', () => {
    const b = bands(2, 1, (i) => (i === 0 ? { nir: 0.5, red: 0.05 } : { nir: 0.22, red: 0.2 }));
    const v = computeIndex(b, 'ndvi');
    expect(v[0]).toBeGreaterThan(0.8);
    expect(Math.abs(v[1]!)).toBeLessThan(0.1);
  });
  it('mineral ratios are positive ratios and invalid pixels are NaN', () => {
    const b = bands(2, 1, () => ({ red: 0.3, blue: 0.1, swir16: 0.4, swir22: 0.25, nir: 0.3 }));
    b.valid[1] = 0;
    expect(computeIndex(b, 'iron')[0]).toBeCloseTo(3.0, 5);
    expect(computeIndex(b, 'clay')[0]).toBeCloseTo(1.6, 5);
    expect(Number.isNaN(computeIndex(b, 'ferrous')[1]!)).toBe(true);
  });
  it('otsu separates a bimodal histogram between the modes', () => {
    const v = new Float32Array(2000);
    for (let i = 0; i < 1000; i++) v[i] = -0.3 + (i % 10) * 0.01;
    for (let i = 1000; i < 2000; i++) v[i] = 0.4 + (i % 10) * 0.01;
    const h = histogram(v, -0.5, 0.6, 110);
    const t = otsuThreshold(h);
    expect(t).toBeGreaterThan(-0.2);
    expect(t).toBeLessThan(0.4);
  });
  it('percentiles ignore NaN', () => {
    const v = new Float32Array([NaN, 1, 2, 3, 4, NaN]);
    const [p0, p50, p100] = percentiles(v, [0, 50, 100]);
    expect(p0).toBe(1);
    expect(p50).toBeGreaterThanOrEqual(2);
    expect(p100).toBe(4);
  });
  it('bare mask keeps a bright bare block and drops a single pixel', () => {
    const w = 12;
    const h = 12;
    const b = bands(w, h, (i) => {
      const x = i % w;
      const y = (i - x) / w;
      const bare = x >= 2 && x < 9 && y >= 2 && y < 9;
      return bare ? { swir16: 0.45, red: 0.35, nir: 0.3, blue: 0.12 } : { swir16: 0.1, red: 0.05, nir: 0.4, blue: 0.03 };
    });
    // one lone bare pixel in the vegetated corner
    b.swir16[w * 10 + 10] = 0.45;
    b.red[w * 10 + 10] = 0.35;
    b.nir[w * 10 + 10] = 0.3;
    const bsi = computeIndex(b, 'bsi');
    const t = otsuThreshold(histogram(bsi, -1, 1, 64));
    const m = bareMask(b, bsi, t, 6);
    expect(m[w * 5 + 5]).toBe(1);
    expect(m[w * 10 + 10]).toBe(0);
    expect(maskArea(m, 10)).toBeCloseTo(((7 - 2) * (7 - 2) * 100) / 1e6, 6);
  });
  it('removeSmall drops components below the minimum', () => {
    const m = new Uint8Array(25);
    m[0] = 1;
    m[12] = 1;
    m[13] = 1;
    m[17] = 1;
    const out = removeSmall(m, 5, 5, 2);
    expect(out[0]).toBe(0);
    expect(out[12]).toBe(1);
  });
});
