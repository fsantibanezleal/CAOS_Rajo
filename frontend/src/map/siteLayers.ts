// Site overlays drawn with native MapLibre layers: the reference mining polygons (Maus et al. 2022,
// CC BY-SA 4.0) as a faint fill plus an accent outline, and the site window as a dashed square. Inserted
// under the first label layer so place names stay readable.
import type { FeatureCollection } from 'geojson';
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';

import type { SiteManifest } from '../lib/contract';

export const SITE_POLY_SOURCE = 'site-polygons';
export const SITE_WINDOW_SOURCE = 'site-window';

function firstSymbolLayer(map: MLMap): string | undefined {
  const style = map.getStyle();
  return style?.layers.find((l) => l.type === 'symbol')?.id;
}

function ensureSources(map: MLMap): void {
  if (!map.getSource(SITE_POLY_SOURCE)) {
    map.addSource(SITE_POLY_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  }
  if (!map.getSource(SITE_WINDOW_SOURCE)) {
    map.addSource(SITE_WINDOW_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  }
  const before = firstSymbolLayer(map);
  if (!map.getLayer('site-polygons-fill')) {
    map.addLayer(
      {
        id: 'site-polygons-fill',
        type: 'fill',
        source: SITE_POLY_SOURCE,
        paint: { 'fill-color': '#e8a33d', 'fill-opacity': 0.1 },
      },
      before,
    );
  }
  if (!map.getLayer('site-polygons-line')) {
    map.addLayer(
      {
        id: 'site-polygons-line',
        type: 'line',
        source: SITE_POLY_SOURCE,
        paint: { 'line-color': '#f3c26b', 'line-width': 1.6, 'line-opacity': 0.9 },
      },
      before,
    );
  }
  if (!map.getLayer('site-window-line')) {
    map.addLayer(
      {
        id: 'site-window-line',
        type: 'line',
        source: SITE_WINDOW_SOURCE,
        paint: { 'line-color': '#7dd3fc', 'line-width': 1.2, 'line-dasharray': [3, 2], 'line-opacity': 0.8 },
      },
      before,
    );
  }
}

export async function showSite(map: MLMap, manifest: SiteManifest, polygonsUrl: string): Promise<void> {
  ensureSources(map);
  const [w, s, e, n] = manifest.window.bbox_wgs84;
  const windowFc: FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { site: manifest.site_id },
        geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
      },
    ],
  };
  (map.getSource(SITE_WINDOW_SOURCE) as GeoJSONSource).setData(windowFc);
  try {
    const res = await fetch(polygonsUrl, { cache: 'force-cache' });
    if (res.ok) {
      const fc = (await res.json()) as FeatureCollection;
      (map.getSource(SITE_POLY_SOURCE) as GeoJSONSource).setData(fc);
    }
  } catch {
    /* the outline still shows the window */
  }
}

export function clearSite(map: MLMap): void {
  const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
  (map.getSource(SITE_POLY_SOURCE) as GeoJSONSource | undefined)?.setData(empty);
  (map.getSource(SITE_WINDOW_SOURCE) as GeoJSONSource | undefined)?.setData(empty);
}

/** Camera for a site window: fit the bbox, then tilt for the relief. */
export function flyToSite(map: MLMap, manifest: SiteManifest): void {
  const [w, s, e, n] = manifest.window.bbox_wgs84;
  map.fitBounds(
    [
      [w, s],
      [e, n],
    ],
    { padding: { top: 40, bottom: 120, left: 340, right: 60 }, pitch: 55, bearing: -20, duration: 2400, maxZoom: 13.5 },
  );
}
