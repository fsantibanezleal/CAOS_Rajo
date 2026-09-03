// Earth Search v1 (Element 84, AWS Open Data) from the browser: Sentinel-2 L2A items over a bounding box
// inside a date range, grouped by acquisition day (a same-day neighbour is the same orbit pass and can be
// mosaicked). No key, no proxy: the API answers with CORS for any origin (probed 2026-09-02).

export const EARTH_SEARCH = 'https://earth-search.aws.element84.com/v1/search';

export interface S2Asset {
  href: string;
  scale: number;
  offset: number;
}

export interface S2Item {
  id: string;
  datetime: string;
  cloud: number;
  epsg: number;
  mgrs: string;
  baseline: string;
  assets: Record<'blue' | 'green' | 'red' | 'nir' | 'swir16' | 'swir22' | 'scl', S2Asset>;
  bbox: [number, number, number, number];
  coverage: number;
}

export interface S2DateGroup {
  date: string;
  cloud: number;
  coverage: number;
  items: S2Item[];
}

const KEYS = ['blue', 'green', 'red', 'nir', 'swir16', 'swir22', 'scl'] as const;

interface StacFeature {
  id: string;
  bbox?: number[];
  properties: Record<string, unknown>;
  assets: Record<string, { href: string; 'raster:bands'?: Array<{ scale?: number; offset?: number }> }>;
}

function overlap(a: [number, number, number, number], b: [number, number, number, number]): number {
  const w = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const h = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const area = (b[2] - b[0]) * (b[3] - b[1]);
  return area > 0 ? (w * h) / area : 0;
}

function epsgOf(p: Record<string, unknown>): number {
  const e = p['proj:epsg'];
  if (typeof e === 'number') return e;
  const c = p['proj:code'];
  if (typeof c === 'string' && c.toUpperCase().startsWith('EPSG:')) return Number(c.slice(5));
  return 0;
}

export async function searchSentinel2(
  bbox: [number, number, number, number],
  from: string,
  to: string,
  opts: { maxCloud?: number; limit?: number; signal?: AbortSignal } = {},
): Promise<S2DateGroup[]> {
  const body = {
    collections: ['sentinel-2-l2a'],
    bbox,
    datetime: `${from}T00:00:00Z/${to}T23:59:59Z`,
    limit: opts.limit ?? 60,
    query: { 'eo:cloud_cover': { lt: opts.maxCloud ?? 40 } },
    sortby: [{ field: 'properties.eo:cloud_cover', direction: 'asc' }],
  };
  const res = await fetch(EARTH_SEARCH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`Earth Search ${res.status}`);
  const json = (await res.json()) as { features: StacFeature[] };
  const items: S2Item[] = [];
  for (const f of json.features) {
    if (!f.bbox || f.bbox.length < 4) continue;
    const assets = {} as S2Item['assets'];
    let complete = true;
    for (const k of KEYS) {
      const a = f.assets[k];
      if (!a) {
        complete = false;
        break;
      }
      const rb = a['raster:bands']?.[0];
      assets[k] = { href: a.href, scale: rb?.scale ?? (k === 'scl' ? 1 : 0.0001), offset: rb?.offset ?? (k === 'scl' ? 0 : -0.1) };
    }
    if (!complete) continue;
    const p = f.properties;
    const ibox: [number, number, number, number] = [f.bbox[0]!, f.bbox[1]!, f.bbox[2]!, f.bbox[3]!];
    items.push({
      id: f.id,
      datetime: String(p['datetime'] ?? ''),
      cloud: Number(p['eo:cloud_cover'] ?? 100),
      epsg: epsgOf(p),
      mgrs: String(p['grid:code'] ?? ''),
      baseline: String(p['s2:processing_baseline'] ?? ''),
      assets,
      bbox: ibox,
      coverage: overlap(ibox, bbox),
    });
  }
  const groups = new Map<string, S2Item[]>();
  for (const it of items) {
    const d = it.datetime.slice(0, 10);
    const g = groups.get(d) ?? [];
    g.push(it);
    groups.set(d, g);
  }
  const out: S2DateGroup[] = [];
  for (const [date, its] of groups) {
    its.sort((a, b) => b.coverage - a.coverage);
    // union coverage of axis-aligned boxes: approximate by the max plus the non-overlapping remainder
    const coverage = Math.min(1, its.reduce((s, it) => s + it.coverage, 0));
    const w = its.reduce((s, it) => s + it.coverage, 0) || 1;
    const cloud = its.reduce((s, it) => s + it.cloud * it.coverage, 0) / w;
    out.push({ date, cloud, coverage, items: its });
  }
  out.sort((a, b) => (b.coverage >= 0.99) === (a.coverage >= 0.99) ? a.cloud - b.cloud || (a.date < b.date ? 1 : -1) : b.coverage - a.coverage);
  return out;
}
