// The feature stack is a contract with the ONNX forest: every plane must match the Python
// implementation (data-pipeline/train/common.py) value for value. The fixture is written by
// data-pipeline/train/make_golden.py; regenerate it whenever the definition changes.
import { describe, expect, it } from 'vitest';

import golden from './__fixtures__/rf_features_golden.json';
import { boxMean3, featureRows, N_FEATURES, RF_FEATURES, rfFeatures } from './features';

type Golden = {
  width: number;
  height: number;
  features: string[];
  bands: Record<'blue' | 'green' | 'red' | 'nir' | 'swir16' | 'swir22', number[]>;
  nodata: [number, number][];
  planes: Record<string, number[]>;
};
const g = golden as unknown as Golden;

function band(name: keyof Golden['bands']): Float32Array {
  const a = Float32Array.from(g.bands[name]);
  // the browser read leaves NaN where a pixel has no data; Python holds 0 there
  for (const [y, x] of g.nodata) a[y * g.width + x] = NaN;
  return a;
}

describe('rfFeatures mirrors common.rf_features', () => {
  it('declares the same sixteen planes in the same order', () => {
    expect([...RF_FEATURES]).toEqual(g.features);
    expect(N_FEATURES).toBe(16);
  });

  it('matches the Python planes to 1e-5 on the golden chip, no-data included', () => {
    const planes = rfFeatures({
      width: g.width,
      height: g.height,
      blue: band('blue'),
      green: band('green'),
      red: band('red'),
      nir: band('nir'),
      swir16: band('swir16'),
      swir22: band('swir22'),
    });
    expect(planes).toHaveLength(16);
    for (let f = 0; f < 16; f++) {
      const name = RF_FEATURES[f]!;
      const want = g.planes[name]!;
      const got = planes[f]!;
      expect(got.length).toBe(want.length);
      let worst = 0;
      for (let i = 0; i < want.length; i++) worst = Math.max(worst, Math.abs(got[i]! - want[i]!));
      expect(worst, `plane ${name}`).toBeLessThan(1e-5);
    }
  });

  it('box mean repeats the edge pixel like scipy reflect mode', () => {
    const x = Float32Array.from([1, 2, 3, 4]);
    const m = boxMean3(x, 4, 1);
    // rows: (1,1,2)/3, (1,2,3)/3, (2,3,4)/3, (3,4,4)/3 horizontally; the vertical pass on one row is the identity
    expect(Array.from(m).map((v) => Number(v.toFixed(5)))).toEqual([1.33333, 2, 3, 3.66667]);
  });

  it('interleaves rows for the [N, 16] tensor', () => {
    const planes = Array.from({ length: 16 }, (_, f) => Float32Array.from([f, f + 100]));
    const rows = featureRows(planes, 0, 2);
    expect(rows.length).toBe(32);
    expect(rows[0]).toBe(0);
    expect(rows[15]).toBe(15);
    expect(rows[16]).toBe(100);
    expect(rows[31]).toBe(115);
  });
});
