// CONTRACT 2 mirror (frontend side). MUST stay in lock-step with data-pipeline/rajo/manifest.py and the
// per-stage side-car shapes. The web loads ONLY these documents and the files they declare; a drift here
// makes `tsc` fail, so the contract is enforced at build time.

export const SITE_SCHEMA = 'rajo.site/v1';
export const CATALOG_SCHEMA = 'rajo.catalog/v1';

export type Category =
  | 'copper-chile'
  | 'copper-world'
  | 'lithium-brine'
  | 'iron'
  | 'gold'
  | 'lignite'
  | 'diamonds'
  | 'oil-sands'
  | 'transition'
  | 'closure';

export interface Fact {
  text_en: string;
  text_es: string;
  source: string;
}

export interface SiteDefinition {
  id: string;
  name_en: string;
  name_es: string;
  country: string;
  categories: Category[];
  lon: number;
  lat: number;
  window_km: number;
  first_year: number;
  season: { start_month: number; end_month: number };
  facts: Fact[];
  commodity: string;
  operator: string;
  flags: string[];
  no_reference_polygon: boolean;
  tailings_note_en: string;
  tailings_note_es: string;
  transition_year: number | null;
  closure_year: number | null;
}

export interface SiteWindow {
  epsg: number;
  pixel_m: number;
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  transform: [number, number, number, number, number, number];
  bbox_wgs84: [number, number, number, number];
}

export interface PolygonSummary {
  source: string;
  n_features: number;
  area_km2: number;
  fids: number[];
}

export type Sensor = 'landsat-5' | 'landsat-7' | 'landsat-8' | 'landsat-9' | 'sentinel-2a' | 'sentinel-2b' | 'sentinel-2c';

export interface Frame {
  year: number;
  sensor: Sensor;
  scene_id: string;
  scene_ids: string[];
  date: string;
  cloud_pct: number;
  valid_pct: number;
  snow_pct: number;
  pixel_m: number;
  image: string;
  image_px: number;
  swir_image: string;
  stretch: { true_colour: [number, number][]; swir: [number, number][] };
  flags: string[];
  collection: 'sentinel-2-l2a' | 'landsat-c2-l2';
  masks?: Record<string, string>;
}

export interface ChangePoint {
  year: number;
  method: 'cusum' | 'pelt' | 'harmonic';
  series: string; // which area series (otsu, rf, unet) or index the point belongs to
  score: number;
}

export interface SeriesSegment {
  start: number; // year
  end: number; // year, inclusive
  mean: number;
  slope: number; // km2 per year
}

export interface SeriesMethod {
  label: string;
  domain: string; // e.g. "all sensors" or "Sentinel-2 only"
  flags: string[];
  pelt: { breaks: number[]; segments: SeriesSegment[]; penalty: number; sigma: number; cost: string; min_size: number };
  cusum: { alarms: number[]; k: number; h: number; sigma: number; target: number };
}

export interface SeriesBlock {
  years: number[];
  sensor: string[];
  valid_frac: number[]; // envelope fraction with clear data, per year
  envelope_km2: number;
  envelope: string;
  area_km2: Record<string, (number | null)[]>;
  index_mean: Record<string, (number | null)[]>; // ndvi, mndwi, bsi over the envelope
  methods: Record<string, SeriesMethod>;
  change_points: ChangePoint[];
  gaps: Record<string, string>;
  dense?: DenseSeries | null;
}

export interface DenseSeries {
  index: string;
  dates: string[];
  values: number[];
  clear_frac: number[];
  harmonic: { breaks: string[]; k: number; period_days: number; segments: Array<{ start: string; end: string; coef: number[]; rss: number; n: number }>; bic: number; bic_no_break: number };
}

export interface DemBlock {
  epochs: Array<{ id: 'srtm2000' | 'cop2011_2015'; source: string; date_range: string }>;
  delta_png?: string;
  srtm_png?: string;
  cop_png?: string;
  delta_range_m: [number, number];
  cut_volume_m3: number;
  fill_volume_m3: number;
  noise_floor_m: number;
  geoid_offset_m: number;
  terrain_tiles: string[];
  terrain_tile_zooms: [number, number];
}

export interface ModelRef {
  name: string;
  version: string;
  file: string;
  sha256: string;
}

export interface FileRef {
  path: string;
  kind: 'polygons' | 'frame' | 'mask' | 'dem' | 'terrain';
  bytes: number;
  sha256: string;
  year?: number;
  method?: string;
}

export interface SiteManifest {
  schema: typeof SITE_SCHEMA;
  engine_version: string;
  site_id: string;
  site: SiteDefinition;
  window: SiteWindow;
  polygons: PolygonSummary;
  frames: Frame[];
  gaps?: Record<string, string>; // year -> why there is no frame
  series: SeriesBlock | null;
  dem: DemBlock | null;
  models: ModelRef[];
  files: FileRef[];
}

export interface CatalogEntry {
  site_id: string;
  name: string;
  name_es: string;
  country: string;
  categories: Category[];
  lon: number;
  lat: number;
  n_frames: number;
  first_year: number;
  manifest_path: string;
}

export interface Catalog {
  schema: typeof CATALOG_SCHEMA;
  engine_version: string;
  n_sites: number;
  sites: CatalogEntry[];
}

export function isCatalog(x: unknown): x is Catalog {
  if (!x || typeof x !== 'object') return false;
  const c = x as Partial<Catalog>;
  return c.schema === CATALOG_SCHEMA && Array.isArray(c.sites) && typeof c.n_sites === 'number' && c.n_sites === c.sites.length;
}

export function isSiteManifest(x: unknown): x is SiteManifest {
  if (!x || typeof x !== 'object') return false;
  const m = x as Partial<SiteManifest>;
  return m.schema === SITE_SCHEMA && typeof m.site_id === 'string' && Array.isArray(m.frames) && Array.isArray(m.files);
}
