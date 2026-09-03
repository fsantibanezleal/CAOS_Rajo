// UTM to WGS84 for the site window corners (the window is a square on the site's UTM grid; on the globe it
// is a slightly rotated quadrilateral, so the image overlay takes its four projected corners).
import proj4 from 'proj4';

import type { SiteWindow } from './contract';

export function utmDefinition(epsg: number): string {
  const zone = epsg % 100;
  const south = epsg >= 32700 && epsg < 32800;
  if (zone < 1 || zone > 60 || (epsg < 32601 && epsg < 32701)) throw new Error(`not a UTM WGS84 code: ${epsg}`);
  return `+proj=utm +zone=${zone} ${south ? '+south ' : ''}+datum=WGS84 +units=m +no_defs`;
}

export function utmToLonLat(epsg: number, x: number, y: number): [number, number] {
  const [lon, lat] = proj4(utmDefinition(epsg), 'EPSG:4326', [x, y]) as [number, number];
  return [lon, lat];
}

export function lonLatToUtm(epsg: number, lon: number, lat: number): [number, number] {
  const [x, y] = proj4('EPSG:4326', utmDefinition(epsg), [lon, lat]) as [number, number];
  return [x, y];
}

/** Corners in the order MapLibre's image source expects: top-left, top-right, bottom-right, bottom-left. */
export function windowCorners(w: SiteWindow): [[number, number], [number, number], [number, number], [number, number]] {
  return [
    utmToLonLat(w.epsg, w.left, w.top),
    utmToLonLat(w.epsg, w.right, w.top),
    utmToLonLat(w.epsg, w.right, w.bottom),
    utmToLonLat(w.epsg, w.left, w.bottom),
  ];
}

/** Pixel (col, row) on the site grid for a lon/lat, or null when outside the window. */
export function lonLatToPixel(w: SiteWindow, lon: number, lat: number): [number, number] | null {
  const [x, y] = lonLatToUtm(w.epsg, lon, lat);
  const col = (x - w.left) / w.pixel_m;
  const row = (w.top - y) / w.pixel_m;
  if (col < 0 || row < 0 || col >= w.width || row >= w.height) return null;
  return [col, row];
}
