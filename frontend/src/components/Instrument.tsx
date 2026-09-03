// The instrument panel: the live lane on the selected site. Look: the latest clear Sentinel-2 scene read
// from the cloud-optimized GeoTIFFs into the browser, composites, spectral and mineral indices with a
// perceptually uniform colormap, an explicit display range, a histogram and statistics. Find: three
// classical ways to delineate the mine on that scene (Otsu on the bare-soil index, k-means on the
// spectra, spectral angle against the reference polygons), each with its area. Every control drives a
// computation in the worker; nothing here is decorative.
import type { FeatureCollection } from 'geojson';
import { Cpu, Download, Eye, Layers, Mountain, RefreshCw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type ColormapName, cssGradient } from '../lib/colormap';
import type { SiteManifest } from '../lib/contract';
import { INDEX_SPECS, type IndexName } from '../lib/indices';
import { rasterizeFeatures } from '../lib/rasterize';
import { useLive } from '../state/live';
import { useModels } from '../state/models';
import { useUI } from '../state/ui';
import { Histogram } from './Histogram';
import { ReliefPanel } from './ReliefPanel';

export type InstrumentTab = 'look' | 'find' | 'relief';

const INDEX_GROUPS: Array<{ key: string; items: IndexName[] }> = [
  { key: 'vegetationWater', items: ['ndvi', 'ndwi', 'mndwi'] },
  { key: 'soilBuilt', items: ['bsi', 'ndbi', 'nbr'] },
  { key: 'mineral', items: ['iron', 'clay', 'ferrous'] },
];
const CMAPS: ColormapName[] = ['viridis', 'cividis', 'inferno', 'magma'];

export function Instrument({ manifest, onOpacity }: { manifest: SiteManifest; onOpacity: (o: number) => void }) {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const live = useLive();
  const [tab, setTab] = useState<InstrumentTab>('look');
  const [indexName, setIndexName] = useState<IndexName>('ndvi');
  const [cmap, setCmap] = useState<ColormapName>('viridis');
  const [range, setRange] = useState<[number, number] | null>(null);
  const [opacity, setOpacity] = useState(1);
  const [kmeansK, setKmeansK] = useState(6);
  const [samAngle, setSamAngle] = useState(0.12);
  const [otsuT, setOtsuT] = useState<number | null>(null);
  const [refMask, setRefMask] = useState<Uint8Array | null>(null);
  const [learnedT, setLearnedT] = useState(0.5);
  const [unetScale, setUnetScale] = useState<1 | 2>(2);
  const models = useModels();
  useEffect(() => void models.load(), [models]);
  const rfModel = models.byMethod('M7');
  const unetModel = models.byMethod('M8');
  // the slider starts at the threshold chosen on validation for the shipped model (the bake uses the same)
  const [learnedTSeeded, setLearnedTSeeded] = useState(false);
  useEffect(() => {
    const seed = unetModel?.threshold ?? rfModel?.threshold;
    if (!learnedTSeeded && typeof seed === 'number') {
      setLearnedT(seed);
      setLearnedTSeeded(true);
    }
  }, [rfModel, unetModel, learnedTSeeded]);

  const win = manifest.window;
  const bbox = win.bbox_wgs84;

  // the reference polygons rasterised on the live grid (endmember and comparison area)
  useEffect(() => {
    if (!live.grid) {
      setRefMask(null);
      return;
    }
    let alive = true;
    fetch(`${import.meta.env.BASE_URL}data/sites/${manifest.site_id}/polygons.geojson`)
      .then((r) => r.json())
      .then((fc: FeatureCollection) => alive && live.grid && setRefMask(rasterizeFeatures(fc, live.grid)))
      .catch(() => alive && setRefMask(null));
    return () => {
      alive = false;
    };
  }, [manifest.site_id, live.grid]);

  useEffect(() => onOpacity(opacity), [opacity, onOpacity]);

  const layer = live.layer;
  const indexResult = layer?.kind === 'index' ? layer.result : null;
  const spec = INDEX_SPECS[indexName];
  const refAreaKm2 = useMemo(() => {
    if (!refMask || !live.grid) return null;
    let n = 0;
    for (let i = 0; i < refMask.length; i++) n += refMask[i]!;
    return (n * live.grid.pixelM * live.grid.pixelM) / 1e6;
  }, [refMask, live.grid]);

  const runIndex = (name: IndexName, cm: ColormapName, r: [number, number] | null) => {
    void live.index(name, cm, r?.[0], r?.[1]);
  };

  const label = (id: IndexName) => t(`indices.${id}.name`);
  const fmt = (v: number) => (spec.kind === 'ratio' ? v.toFixed(2) : v.toFixed(2));

  return (
    <aside className="overlay instrument" data-testid="instrument" aria-label={t('instrument.title')}>
      <div className="panel inst">
        <div className="inst-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'look'} className={`chip${tab === 'look' ? ' on' : ''}`} onClick={() => setTab('look')} data-testid="tab-look">
            <Eye size={13} /> {t('instrument.tabs.look')}
          </button>
          <button role="tab" aria-selected={tab === 'find'} className={`chip${tab === 'find' ? ' on' : ''}`} onClick={() => setTab('find')} data-testid="tab-find">
            <Search size={13} /> {t('instrument.tabs.find')}
          </button>
          {manifest.dem && (
            <button role="tab" aria-selected={tab === 'relief'} className={`chip${tab === 'relief' ? ' on' : ''}`} onClick={() => setTab('relief')} data-testid="tab-relief">
              <Mountain size={13} /> {t('instrument.tabs.relief')}
            </button>
          )}
        </div>

        {tab === 'relief' && <ReliefPanel manifest={manifest} />}

        {/* the live scene block is shared by the Look and Find tabs; the relief lane is baked */}
        {tab !== 'relief' && (
        <section className="inst-scene">
          <div className="inst-row">
            <button
              className="btn"
              type="button"
              disabled={live.status === 'searching' || live.status === 'reading'}
              onClick={() => void live.fetchLatest(win, bbox)}
              data-testid="live-fetch"
            >
              <Download size={14} /> {live.status === 'ready' ? t('instrument.refetch') : t('instrument.fetch')}
            </button>
            {live.status === 'ready' && live.groups.length > 1 && (
              <select
                aria-label={t('instrument.scene')}
                value={live.group?.date ?? ''}
                onChange={(e) => {
                  const g = live.groups.find((x) => x.date === e.target.value);
                  if (g) void live.fetchGroup(win, g);
                }}
              >
                {live.groups.map((g) => (
                  <option key={g.date} value={g.date}>
                    {g.date} ({g.cloud.toFixed(1)}% {t('instrument.cloud')})
                  </option>
                ))}
              </select>
            )}
          </div>
          {live.status === 'idle' && <p className="muted small">{t('instrument.idle')}</p>}
          {(live.status === 'searching' || live.status === 'reading') && (
            <div className="progress" aria-label={t('instrument.reading')}>
              <div style={{ width: `${Math.round(live.progress * 100)}%` }} />
              <span className="mono small">{live.status === 'searching' ? t('instrument.searching') : `${Math.round(live.progress * 100)}% ${live.message}`}</span>
            </div>
          )}
          {live.status === 'error' && <p className="bad small">{live.message}</p>}
          {live.status === 'ready' && live.read && live.group && (
            <p className="small mono" data-testid="live-scene">
              {live.group.date} / {live.read.itemsRead.length} {t('instrument.tiles')} / {live.grid?.pixelM} m / {(live.read.bytes / 1e6).toFixed(1)} MB / {(live.read.ms / 1000).toFixed(1)} s
              {live.read.itemsSkipped.length > 0 && ` / ${t('instrument.skipped')}: ${live.read.itemsSkipped.length}`}
            </p>
          )}
        </section>
        )}

        {tab === 'look' && (
          <section className="inst-body" role="tabpanel">
            <div className="inst-row seg" role="group" aria-label={t('instrument.composite')}>
              {(['tc', 'fc', 'swir'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`chip${layer?.kind === 'composite' && layer.composite === k ? ' on' : ''}`}
                  disabled={live.status !== 'ready' || live.busy}
                  onClick={() => void live.composite(k)}
                  data-testid={`comp-${k}`}
                >
                  {t(`instrument.composites.${k}`)}
                </button>
              ))}
            </div>
            <label className="inst-label">
              {t('instrument.index')}
              <select
                value={indexName}
                disabled={live.status !== 'ready'}
                onChange={(e) => {
                  const n = e.target.value as IndexName;
                  setIndexName(n);
                  setRange(null);
                  runIndex(n, cmap, null);
                }}
                data-testid="index-select"
              >
                {INDEX_GROUPS.map((g) => (
                  <optgroup key={g.key} label={t(`indices.groups.${g.key}`)}>
                    {g.items.map((id) => (
                      <option key={id} value={id}>
                        {label(id)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <div className="inst-row">
              <button className="btn" type="button" disabled={live.status !== 'ready' || live.busy} onClick={() => runIndex(indexName, cmap, range)} data-testid="index-run">
                <Layers size={14} /> {t('instrument.compute')}
              </button>
              <select aria-label={t('instrument.colormap')} value={cmap} onChange={(e) => {
                const c = e.target.value as ColormapName;
                setCmap(c);
                if (indexResult) runIndex(indexName, c, [indexResult.lo, indexResult.hi]);
              }}>
                {CMAPS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <p className="small muted">{t(`indices.${indexName}.formula`)}</p>
            {indexResult && (
              <>
                <div className="legend" style={{ background: cssGradient(cmap) }} />
                <div className="inst-row mono small">
                  <span>{fmt(indexResult.lo)}</span>
                  <span className="spacer" />
                  <span>{fmt(indexResult.hi)}</span>
                </div>
                <div className="inst-row">
                  <label className="small">
                    {t('instrument.rangeLo')}
                    <input
                      type="number"
                      step={spec.kind === 'ratio' ? 0.05 : 0.02}
                      value={(range?.[0] ?? indexResult.lo).toFixed(2)}
                      onChange={(e) => setRange([Number(e.target.value), range?.[1] ?? indexResult.hi])}
                    />
                  </label>
                  <label className="small">
                    {t('instrument.rangeHi')}
                    <input
                      type="number"
                      step={spec.kind === 'ratio' ? 0.05 : 0.02}
                      value={(range?.[1] ?? indexResult.hi).toFixed(2)}
                      onChange={(e) => setRange([range?.[0] ?? indexResult.lo, Number(e.target.value)])}
                    />
                  </label>
                  <button className="btn" type="button" onClick={() => runIndex(indexName, cmap, range)} disabled={!range}>
                    <RefreshCw size={13} />
                  </button>
                </div>
                <Histogram counts={indexResult.hist.counts} lo={indexResult.hist.lo} hi={indexResult.hist.hi} rangeLo={indexResult.lo} rangeHi={indexResult.hi} format={fmt} />
                <dl className="stats mono small" data-testid="index-stats">
                  <dt>p2 / p98</dt>
                  <dd>
                    {fmt(indexResult.stats.p2)} / {fmt(indexResult.stats.p98)}
                  </dd>
                  <dt>{t('instrument.mean')}</dt>
                  <dd>{fmt(indexResult.stats.mean)}</dd>
                  <dt>{t('instrument.validPx')}</dt>
                  <dd>{indexResult.stats.n.toLocaleString()}</dd>
                </dl>
                <p className="small faint">{t(`indices.${indexName}.caveat`)}</p>
              </>
            )}
            {layer?.kind === 'composite' && (
              <p className="small faint mono">
                {t('instrument.stretch')}: {layer.clips.map((c) => `${c[0].toFixed(3)}-${c[1].toFixed(3)}`).join(' / ')}
              </p>
            )}
            <label className="inst-label small">
              {t('instrument.opacity')} {Math.round(opacity * 100)}%
              <input type="range" min={0} max={100} value={Math.round(opacity * 100)} onChange={(e) => setOpacity(Number(e.target.value) / 100)} />
            </label>
          </section>
        )}

        {tab === 'find' && (
          <section className="inst-body" role="tabpanel">
            <div className="method">
              <h3>{t('instrument.otsu.title')}</h3>
              <p className="small muted">{t('instrument.otsu.text')}</p>
              <div className="inst-row">
                <button className="btn" type="button" disabled={live.status !== 'ready' || live.busy} onClick={() => void live.otsu(otsuT ?? undefined)} data-testid="otsu-run">
                  {t('instrument.compute')}
                </button>
                {layer?.kind === 'otsu' && (
                  <label className="small">
                    {t('instrument.otsu.threshold')}
                    <input
                      type="range"
                      min={-0.4}
                      max={0.7}
                      step={0.01}
                      value={otsuT ?? layer.result.threshold}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setOtsuT(v);
                        void live.otsu(v);
                      }}
                    />
                    <span className="mono">{(otsuT ?? layer.result.threshold).toFixed(2)}</span>
                  </label>
                )}
              </div>
              {layer?.kind === 'otsu' && (
                <>
                  <Histogram counts={histOf(layer.result.values)} lo={-0.6} hi={0.8} threshold={layer.result.threshold} format={(v) => v.toFixed(2)} />
                  <Readout label={t('instrument.area')} value={`${layer.result.areaKm2.toFixed(2)} km2`} ref2={refAreaKm2} refLabel={t('instrument.refArea')} />
                </>
              )}
            </div>
            <div className="method">
              <h3>{t('instrument.kmeans.title')}</h3>
              <p className="small muted">{t('instrument.kmeans.text')}</p>
              <div className="inst-row">
                <label className="small">
                  k
                  <select value={kmeansK} onChange={(e) => setKmeansK(Number(e.target.value))}>
                    {[4, 5, 6, 7, 8].map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="btn" type="button" disabled={live.status !== 'ready' || live.busy} onClick={() => void live.kmeans(kmeansK)} data-testid="kmeans-run">
                  {t('instrument.compute')}
                </button>
              </div>
              {layer?.kind === 'kmeans' && (
                <table className="clusters small" data-testid="kmeans-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>{t('instrument.kmeans.cluster')}</th>
                      <th>km2</th>
                      <th>{t('instrument.kmeans.spectrum')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {layer.result.centroids.map((c, j) => (
                      <tr key={j}>
                        <td>
                          <span className="sw" style={{ background: clusterColor(j, layer.result.centroids.length) }} />
                        </td>
                        <td className="mono">{j + 1}</td>
                        <td className="mono">{layer.result.areasKm2[j]!.toFixed(2)}</td>
                        <td>
                          <span className="spec">
                            {c.map((v, f) => (
                              <i key={f} style={{ height: `${Math.min(100, v * 200)}%` }} title={`${['B','G','R','NIR','SWIR1','SWIR2'][f]} ${v.toFixed(3)}`} />
                            ))}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="method">
              <h3>{t('instrument.sam.title')}</h3>
              <p className="small muted">{t('instrument.sam.text')}</p>
              <div className="inst-row">
                <label className="small">
                  {t('instrument.sam.angle')}
                  <input type="range" min={0.02} max={0.4} step={0.01} value={samAngle} onChange={(e) => setSamAngle(Number(e.target.value))} />
                  <span className="mono">{samAngle.toFixed(2)} rad</span>
                </label>
                <button className="btn" type="button" disabled={live.status !== 'ready' || live.busy} onClick={() => void live.sam(samAngle, refMask ?? undefined)} data-testid="sam-run">
                  {t('instrument.compute')}
                </button>
              </div>
              {layer?.kind === 'sam' && (
                <>
                  <Histogram counts={histOf(layer.result.values, 0, 0.6)} lo={0} hi={0.6} threshold={layer.result.threshold} format={(v) => v.toFixed(2)} />
                  <Readout label={t('instrument.area')} value={`${layer.result.areaKm2.toFixed(2)} km2`} ref2={refAreaKm2} refLabel={t('instrument.refArea')} />
                  <p className="small faint">{refMask ? t('instrument.sam.endmemberRef') : t('instrument.sam.endmemberBare')}</p>
                </>
              )}
            </div>
            <div className="method learned" data-testid="learned">
              <h3>
                <Cpu size={13} /> {t('instrument.learned.title')}
              </h3>
              <p className="small muted">{t('instrument.learned.text')}</p>
              {models.status === 'missing' && <p className="small bad">{t('instrument.learned.missing')}</p>}
              <div className="inst-row">
                <button
                  className="btn"
                  type="button"
                  disabled={live.status !== 'ready' || live.busy || !rfModel}
                  onClick={() => void live.rf(learnedT)}
                  data-testid="rf-run"
                  title={rfModel ? `${rfModel.id} / ${(rfModel.bytes / 1e6).toFixed(1)} MB` : ''}
                >
                  {t('instrument.learned.rf')}
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={live.status !== 'ready' || live.busy || !unetModel}
                  onClick={() => void live.unet(learnedT, unetScale)}
                  data-testid="unet-run"
                  title={unetModel ? `${unetModel.id} / ${(unetModel.bytes / 1e6).toFixed(1)} MB` : ''}
                >
                  {t('instrument.learned.unet')}
                </button>
                <label className="small">
                  {t('instrument.learned.grid')}
                  <select value={unetScale} onChange={(e) => setUnetScale(Number(e.target.value) as 1 | 2)} aria-label={t('instrument.learned.grid')}>
                    <option value={2}>{live.grid ? live.grid.pixelM * 2 : 20} m</option>
                    <option value={1}>{live.grid ? live.grid.pixelM : 10} m</option>
                  </select>
                </label>
              </div>
              <label className="small">
                {t('instrument.learned.threshold')}
                <input type="range" min={0.1} max={0.9} step={0.05} value={learnedT} onChange={(e) => setLearnedT(Number(e.target.value))} />
                <span className="mono">{learnedT.toFixed(2)}</span>
              </label>
              {live.learnedProgress && (
                <div className="progress" aria-label={t('instrument.learned.running')}>
                  <div style={{ width: `${Math.round((100 * live.learnedProgress.done) / Math.max(1, live.learnedProgress.total))}%` }} />
                  <span className="mono small">
                    {t('instrument.learned.running')} {live.learnedProgress.done}/{live.learnedProgress.total}
                  </span>
                </div>
              )}
              {live.learnedError && (
                <p className="small bad" data-testid="learned-error">
                  {live.learnedError}
                </p>
              )}
              {(layer?.kind === 'rf' || layer?.kind === 'unet') && (
                <>
                  <Histogram counts={histOf(layer.result.values, 0, 1)} lo={0} hi={1} threshold={layer.result.threshold} format={(v) => v.toFixed(2)} />
                  <Readout label={t('instrument.area')} value={`${layer.result.areaKm2.toFixed(2)} km2`} ref2={refAreaKm2} refLabel={t('instrument.refArea')} />
                  <p className="small faint mono" data-testid="learned-run">
                    {layer.kind === 'rf' ? 'M7' : 'M8'} / {layer.result.backend} / {(layer.result.ms / 1000).toFixed(1)} s
                    {layer.result.windows ? ` / ${layer.result.windows} ${t('instrument.learned.windows')}` : ''}
                    {layer.result.scale === 2 ? ` / ${t('instrument.learned.coarse')}` : ''}
                  </p>
                  {(() => {
                    const m = layer.kind === 'rf' ? rfModel : unetModel;
                    const test = m?.scores?.test ?? (m?.val_full ? { pooled_iou: m.val_full.pooled.iou, pooled_f1: m.val_full.pooled.f1, n_tiles: m.val_full.n_tiles } : null);
                    const bench = models.benchmark?.splits.test?.methods[layer.kind];
                    return (
                      <p className="small faint" data-testid="learned-card">
                        {m ? `${m.id}, ${t('instrument.learned.trained')} ${m.trained}. ` : ''}
                        {bench
                          ? `${t('instrument.learned.heldOut')}: IoU ${bench.pooled.iou.toFixed(2)}, F1 ${bench.pooled.f1.toFixed(2)} (${bench.n_tiles} ${t('instrument.tiles')}). `
                          : test
                            ? `${t('instrument.learned.heldOut')}: IoU ${test.pooled_iou.toFixed(2)}, F1 ${test.pooled_f1.toFixed(2)} (${test.n_tiles} ${t('instrument.tiles')}). `
                            : ''}
                        {t('instrument.learned.neverSeen')}
                      </p>
                    );
                  })()}
                </>
              )}
            </div>
            <p className="small faint">{lang === 'es' ? t('instrument.findNote') : t('instrument.findNote')}</p>
          </section>
        )}
      </div>
    </aside>
  );
}

function Readout({ label, value, ref2, refLabel }: { label: string; value: string; ref2: number | null; refLabel: string }) {
  return (
    <dl className="stats mono small" data-testid="mask-readout">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {ref2 !== null && (
        <>
          <dt>{refLabel}</dt>
          <dd>{ref2.toFixed(2)} km2</dd>
        </>
      )}
    </dl>
  );
}

function histOf(values: Float32Array | undefined, lo = -0.6, hi = 0.8, bins = 96): number[] {
  const counts = new Array<number>(bins).fill(0);
  if (!values) return counts;
  const span = hi - lo;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    let k = Math.floor(((v - lo) / span) * bins);
    if (k < 0) k = 0;
    else if (k >= bins) k = bins - 1;
    counts[k]!++;
  }
  return counts;
}

function clusterColor(j: number, k: number): string {
  // matches the worker: cividis by rank
  const t = j / Math.max(1, k - 1);
  const stops: Array<[number, [number, number, number]]> = [
    [0, [0, 32, 77]],
    [0.25, [59, 72, 108]],
    [0.5, [124, 123, 120]],
    [0.75, [187, 175, 113]],
    [1, [255, 234, 70]],
  ];
  let a = stops[0]!;
  let b = stops[stops.length - 1]!;
  for (let i = 0; i + 1 < stops.length; i++) {
    if (t >= stops[i]![0] && t <= stops[i + 1]![0]) {
      a = stops[i]!;
      b = stops[i + 1]!;
      break;
    }
  }
  const u = (t - a[0]) / (b[0] - a[0] || 1);
  const c = a[1].map((v, i) => Math.round(v + (b[1][i]! - v) * u));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
