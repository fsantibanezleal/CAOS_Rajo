// The Rajo map style: EOX Sentinel-2 cloudless imagery under OpenFreeMap vector labels, roads and
// borders, with AWS Terrain Tiles as the DEM for 3D relief. Every source is keyless and answers with CORS
// (probed 2026-09-02); see docs/data/. The OpenFreeMap style is fetched at run time and only its symbol,
// boundary and road layers are kept, so the imagery stays visible underneath.
import type { LayerSpecification, SourceSpecification, StyleSpecification } from 'maplibre-gl';

export const EOX_ATTRIBUTION =
  'Sentinel-2 cloudless - <a href="https://s2maps.eu" target="_blank" rel="noreferrer">s2maps.eu</a> by <a href="https://eox.at" target="_blank" rel="noreferrer">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data 2024)';
export const TERRAIN_ATTRIBUTION =
  '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">Terrain Tiles</a> by Mapzen (Tilezen): SRTM, GMTED2010, ETOPO1 and regional sources';
export const OFM_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

export const IMAGERY_SOURCE: SourceSpecification = {
  type: 'raster',
  tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg'],
  tileSize: 256,
  maxzoom: 15,
  attribution: EOX_ATTRIBUTION,
};

export const TERRAIN_SOURCE: SourceSpecification = {
  type: 'raster-dem',
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  tileSize: 256,
  encoding: 'terrarium',
  maxzoom: 14,
  attribution: TERRAIN_ATTRIBUTION,
};

export function ofmStyleUrl(theme: 'dark' | 'light'): string {
  return theme === 'dark' ? 'https://tiles.openfreemap.org/styles/dark' : 'https://tiles.openfreemap.org/styles/positron';
}

const KEEP_LAYER = /(boundary|admin|place|label|road|highway|water_name|waterway|transportation_name|poi|housenumber)/i;

/** Builds the initial style: imagery + hillshade, then the label/border/road layers of the OpenFreeMap
 *  style (fills dropped). Returns the style plus the id of the first label layer (deck.gl inserts under it). */
export async function buildStyle(theme: 'dark' | 'light'): Promise<{ style: StyleSpecification; firstLabelLayer?: string }> {
  let ofm: StyleSpecification | null = null;
  try {
    const res = await fetch(ofmStyleUrl(theme), { mode: 'cors' });
    if (res.ok) ofm = (await res.json()) as StyleSpecification;
  } catch {
    ofm = null;
  }

  const sources: Record<string, SourceSpecification> = {
    imagery: IMAGERY_SOURCE,
    terrain: TERRAIN_SOURCE,
  };
  const layers: LayerSpecification[] = [
    { id: 'bg', type: 'background', paint: { 'background-color': theme === 'dark' ? '#050813' : '#dcd6c8' } },
    { id: 'imagery', type: 'raster', source: 'imagery', paint: { 'raster-opacity': 1, 'raster-fade-duration': 150 } },
    {
      id: 'hillshade',
      type: 'hillshade',
      source: 'terrain',
      paint: {
        'hillshade-exaggeration': 0.35,
        'hillshade-shadow-color': theme === 'dark' ? '#000000' : '#3b2f1e',
        'hillshade-highlight-color': theme === 'dark' ? '#ffffff' : '#fff8e8',
        'hillshade-accent-color': '#000000',
      },
    },
  ];

  let firstLabelLayer: string | undefined;
  let glyphs: string | undefined;
  let sprite: StyleSpecification['sprite'];
  if (ofm) {
    for (const [id, src] of Object.entries(ofm.sources)) {
      if (id !== 'ne2_shaded') sources[id] = { ...src, attribution: OFM_ATTRIBUTION } as SourceSpecification;
    }
    glyphs = ofm.glyphs;
    sprite = ofm.sprite;
    for (const l of ofm.layers) {
      if (l.type === 'background') continue;
      const src = 'source' in l ? (l.source as string) : '';
      if (src === 'ne2_shaded') continue;
      const isText = l.type === 'symbol';
      const isLine = l.type === 'line' && KEEP_LAYER.test(l.id) && !/water|park|landcover|building/i.test(l.id);
      if (!isText && !isLine) continue;
      if (isText && !firstLabelLayer) firstLabelLayer = l.id;
      const layer = { ...l } as LayerSpecification;
      if (isLine) {
        const paint = { ...(layer as { paint?: Record<string, unknown> }).paint, 'line-opacity': 0.55 };
        (layer as { paint?: Record<string, unknown> }).paint = paint;
      }
      layers.push(layer);
    }
  }

  const style: StyleSpecification = {
    version: 8,
    // the globe is part of the style, so a style swap (theme) never renders a frame without a projection
    projection: { type: 'globe' },
    name: `rajo-${theme}`,
    ...(glyphs ? { glyphs } : {}),
    ...(sprite ? { sprite } : {}),
    sources,
    layers,
    sky: {
      'sky-color': theme === 'dark' ? '#0a1330' : '#a9c8e8',
      'horizon-color': theme === 'dark' ? '#1a2a5a' : '#e7d9c0',
      'fog-color': theme === 'dark' ? '#050813' : '#efe7d6',
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.8,
      'fog-ground-blend': 0.7,
    },
  } as StyleSpecification;
  return { style, firstLabelLayer };
}

/** Terrarium decode: elevation in metres from an RGB triple. */
export function terrariumToMetres(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}
