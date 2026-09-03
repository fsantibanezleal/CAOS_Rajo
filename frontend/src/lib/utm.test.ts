import { describe, expect, it } from 'vitest';

import type { SiteWindow } from './contract';
import { lonLatToPixel, utmDefinition, utmToLonLat, windowCorners } from './utm';

// Chuquicamata: EPSG:32719 (zone 19 south). Known point: the seed (-68.905, -22.305) lies at about
// x = 509 800, y = 7 532 900 on that grid (pyproj, checked in the bake).
const W: SiteWindow = {
  epsg: 32719,
  pixel_m: 10,
  width: 2400,
  height: 2400,
  left: 497790,
  top: 7544910,
  right: 521790,
  bottom: 7520910,
  transform: [10, 0, 497790, 0, -10, 7544910],
  bbox_wgs84: [-69.02, -22.41, -68.79, -22.19],
};

describe('utm', () => {
  it('builds the proj definition', () => {
    expect(utmDefinition(32719)).toContain('+zone=19 +south');
    expect(utmDefinition(32612)).toContain('+zone=12 +datum');
  });
  it('projects the seed back to about the same lon/lat', () => {
    const [lon, lat] = utmToLonLat(32719, 509800, 7532900);
    expect(lon).toBeCloseTo(-68.905, 2);
    expect(lat).toBeCloseTo(-22.305, 2);
  });
  it('orders the corners top-left, top-right, bottom-right, bottom-left', () => {
    const c = windowCorners(W);
    expect(c[0][0]).toBeLessThan(c[1][0]);
    expect(c[0][1]).toBeGreaterThan(c[3][1]);
    expect(c[1][1]).toBeGreaterThan(c[2][1]);
  });
  it('maps a lon/lat inside the window to a pixel and rejects outside', () => {
    const p = lonLatToPixel(W, -68.905, -22.305);
    expect(p).not.toBeNull();
    expect(p![0]).toBeGreaterThan(1000);
    expect(p![0]).toBeLessThan(1400);
    expect(lonLatToPixel(W, -70, -22)).toBeNull();
  });
});
