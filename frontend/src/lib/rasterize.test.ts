import type { FeatureCollection } from 'geojson';
import { describe, expect, it } from 'vitest';

import type { ReadGrid } from './cog';
import { rasterizeFeatures } from './rasterize';
import { utmToLonLat } from './utm';

describe('rasterize', () => {
  it('fills a square polygon with the expected pixel count and honours a hole', () => {
    const grid: ReadGrid = { epsg: 32719, left: 500000, top: 7530000, pixelM: 10, width: 100, height: 100 };
    // a 40 x 40 pixel square (400 m) with a 10 x 10 hole, expressed in lon/lat
    const P = (x: number, y: number) => utmToLonLat(32719, grid.left + x * 10, grid.top - y * 10);
    const outer = [P(20, 20), P(60, 20), P(60, 60), P(20, 60), P(20, 20)];
    const hole = [P(35, 35), P(45, 35), P(45, 45), P(35, 45), P(35, 35)];
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [outer, hole] } }],
    };
    const m = rasterizeFeatures(fc, grid);
    let n = 0;
    for (let i = 0; i < m.length; i++) n += m[i]!;
    expect(Math.abs(n - (1600 - 100))).toBeLessThanOrEqual(90); // projection round-trip tolerance of about one pixel per side
    expect(m[30 * 100 + 30]).toBe(1);
    expect(m[40 * 100 + 40]).toBe(0);
    expect(m[5 * 100 + 5]).toBe(0);
  });
});
