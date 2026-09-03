// Rasterises WGS84 polygons onto a UTM pixel grid (even-odd scanline fill), for the reference mask the
// spectral-angle endmember and the statistics use. Rings are projected vertex by vertex; holes are
// handled by the even-odd rule.
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';

import type { ReadGrid } from './cog';
import { lonLatToUtm } from './utm';

export function rasterizeFeatures(fc: FeatureCollection, grid: ReadGrid): Uint8Array {
  const mask = new Uint8Array(grid.width * grid.height);
  for (const f of fc.features) rasterizeFeature(f, grid, mask);
  return mask;
}

function rasterizeFeature(f: Feature, grid: ReadGrid, mask: Uint8Array): void {
  const g = f.geometry;
  if (!g) return;
  if (g.type === 'Polygon') fillPolygon((g as Polygon).coordinates, grid, mask);
  else if (g.type === 'MultiPolygon') for (const poly of (g as MultiPolygon).coordinates) fillPolygon(poly, grid, mask);
}

function toPixel(grid: ReadGrid, p: Position): [number, number] {
  const [x, y] = lonLatToUtm(grid.epsg, p[0]!, p[1]!);
  return [(x - grid.left) / grid.pixelM, (grid.top - y) / grid.pixelM];
}

/** Even-odd scanline fill of one polygon (outer ring plus holes) into the mask. */
export function fillPolygon(rings: Position[][], grid: ReadGrid, mask: Uint8Array): void {
  const edges: Array<[number, number, number, number]> = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    const pts = ring.map((p) => toPixel(grid, p));
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      if (a[1] === b[1]) continue;
      edges.push([a[0], a[1], b[0], b[1]]);
      minY = Math.min(minY, a[1], b[1]);
      maxY = Math.max(maxY, a[1], b[1]);
    }
  }
  if (!edges.length) return;
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(grid.height - 1, Math.ceil(maxY));
  const xs: number[] = [];
  for (let row = y0; row <= y1; row++) {
    const yc = row + 0.5;
    xs.length = 0;
    for (const [ax, ay, bx, by] of edges) {
      if ((yc >= ay && yc < by) || (yc >= by && yc < ay)) {
        xs.push(ax + ((yc - ay) * (bx - ax)) / (by - ay));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k]! - 0.5));
      const xb = Math.min(grid.width - 1, Math.floor(xs[k + 1]! - 0.5));
      for (let x = xa; x <= xb; x++) mask[row * grid.width + x] = 1;
    }
  }
}
