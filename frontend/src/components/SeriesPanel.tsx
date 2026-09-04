// The signal lane on the baked series: the mined-area series per method (Otsu, random forest, U-Net)
// inside the site envelope, year by year, with the sensor of every point, the PELT segments and breaks,
// the CUSUM alarms, the envelope index means, and the dense Sentinel-2 series with its harmonic breaks.
// uPlot draws; the legend solos and toggles; the cursor reads values; a click on a year moves the
// timeline there. The penalty slider reruns PELT live in TypeScript (the same code that scored the
// bake) so the user sees what the breaks depend on.
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { pelt } from '../lib/changepoints';
import type { SeriesBlock, SiteManifest } from '../lib/contract';
import { useTimeline } from '../state/timeline';
import { useUI } from '../state/ui';

type MethodKey = 'otsu' | 'rf' | 'unet';
const METHOD_COLORS: Record<MethodKey, string> = { otsu: '#e8a33d', rf: '#f472b6', unet: '#60a5fa' };
const INDEX_COLORS: Record<string, string> = { ndvi: '#4ade80', mndwi: '#38bdf8', bsi: '#fbbf24' };

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

export function SeriesPanel({ manifest, series }: { manifest: SiteManifest; series: SeriesBlock }) {
  const { t } = useTranslation();
  const theme = useUI((s) => s.theme);
  const setIndex = useTimeline((s) => s.setIndex);
  const seriesMethod = useTimeline((s) => s.seriesMethod);
  const setSeriesMethod = useTimeline((s) => s.setSeriesMethod);
  const showMask = useTimeline((s) => s.showMask);
  const setShowMask = useTimeline((s) => s.setShowMask);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [view, setView] = useState<'area' | 'index' | 'dense'>('area');
  const [penaltyScale, setPenaltyScale] = useState(1);
  const [hover, setHover] = useState<{ year: number; values: Array<[string, number | null]> } | null>(null);

  const methods = useMemo(() => (Object.keys(series.methods) as MethodKey[]).filter((m) => series.area_km2[m]), [series]);

  // live PELT on the chosen method with the penalty scaled by the slider; the bake used scale 1
  const live = useMemo(() => {
    const vals = series.area_km2[seriesMethod];
    if (!vals) return null;
    const idx: number[] = [];
    const x: number[] = [];
    vals.forEach((v, i) => {
      if (v !== null) {
        idx.push(i);
        x.push(v);
      }
    });
    const base = series.methods[seriesMethod]?.pelt;
    if (x.length < 6 || !base) return null;
    const r = pelt(x, base.penalty * penaltyScale, base.min_size, base.sigma);
    return { breaks: r.breaks.map((b) => series.years[idx[b]!]!), segments: r.segments.map((s) => ({ start: series.years[idx[s.start]!]!, end: series.years[idx[s.end]!]!, mean: s.mean, slope: s.slope })), penalty: r.penalty };
  }, [series, seriesMethod, penaltyScale]);

  const frameIndexByYear = useMemo(() => {
    const m = new Map<number, number>();
    manifest.frames.forEach((f, i) => m.set(f.year, i));
    return m;
  }, [manifest]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    plotRef.current?.destroy();
    plotRef.current = null;
    const fg = token('--fg-muted');
    const grid = token('--border');
    const accent = token('--accent');
    const width = Math.max(320, host.clientWidth);
    const height = Math.max(120, host.clientHeight);

    let data: uPlot.AlignedData;
    let seriesDefs: uPlot.Series[];
    let breaks: number[] = [];
    let alarms: number[] = [];
    let xIsDate = false;
    if (view === 'dense' && series.dense) {
      xIsDate = true;
      const xs = series.dense.dates.map((d) => Date.parse(d) / 1000);
      data = [xs, series.dense.values];
      seriesDefs = [
        { label: t('series.date') },
        { label: `${series.dense.index.toUpperCase()} ${t('series.envelopeMean')}`, stroke: INDEX_COLORS[series.dense.index] ?? accent, width: 1, points: { show: true, size: 4 } },
      ];
      breaks = series.dense.harmonic.breaks.map((d) => Date.parse(d) / 1000);
    } else if (view === 'index') {
      const keys = Object.keys(series.index_mean);
      data = [series.years, ...keys.map((k) => series.index_mean[k]!.map((v) => (v === null ? null : v)))] as uPlot.AlignedData;
      seriesDefs = [{ label: t('series.year') }, ...keys.map((k) => ({ label: k.toUpperCase(), stroke: INDEX_COLORS[k] ?? accent, width: 1.5, points: { show: true, size: 5 }, spanGaps: false }))];
    } else {
      data = [series.years, ...methods.map((m) => series.area_km2[m]!)] as uPlot.AlignedData;
      seriesDefs = [
        { label: t('series.year') },
        ...methods.map((m) => ({
          label: series.methods[m]?.label ?? m,
          stroke: METHOD_COLORS[m],
          width: m === seriesMethod ? 2.2 : 1.2,
          points: { show: true, size: m === seriesMethod ? 7 : 5 },
          spanGaps: false,
        })),
      ];
      breaks = live?.breaks ?? series.methods[seriesMethod]?.pelt.breaks ?? [];
      alarms = series.methods[seriesMethod]?.cusum.alarms ?? [];
    }

    const drawMarks = (u: uPlot) => {
      const ctx = u.ctx;
      ctx.save();
      const top = u.bbox.top;
      const bottom = u.bbox.top + u.bbox.height;
      for (const b of breaks) {
        const x = u.valToPos(b, 'x', true);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const a of alarms) {
        const x = u.valToPos(a, 'x', true);
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(x, top + 2);
        ctx.lineTo(x - 6, top + 14);
        ctx.lineTo(x + 6, top + 14);
        ctx.closePath();
        ctx.fill();
      }
      // sensor bands: Landsat years shaded so the sensor boundary is never hidden
      if (!xIsDate) {
        ctx.fillStyle = theme === 'dark' ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.045)';
        for (let i = 0; i < series.years.length; i++) {
          if (!series.sensor[i]!.startsWith('landsat')) continue;
          const y = series.years[i]!;
          const x0 = u.valToPos(y - 0.5, 'x', true);
          const x1 = u.valToPos(y + 0.5, 'x', true);
          ctx.fillRect(x0, top, x1 - x0, bottom - top);
        }
      }
      ctx.restore();
    };

    const opts: uPlot.Options = {
      width,
      height,
      scales: { x: { time: xIsDate } },
      axes: [
        { stroke: fg, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid }, values: xIsDate ? undefined : (_u, vals) => vals.map((v) => String(v)) },
        { stroke: fg, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid }, size: 54, label: view === 'area' ? 'km2' : view === 'index' ? t('series.indexAxis') : series.dense?.index.toUpperCase() },
      ],
      series: seriesDefs,
      legend: { show: true, live: true, isolate: true },
      cursor: { drag: { x: false, y: false }, focus: { prox: 24 } },
      hooks: {
        draw: [drawMarks],
        setCursor: [
          (u) => {
            const i = u.cursor.idx;
            if (i === null || i === undefined) {
              setHover(null);
              return;
            }
            const x = (data[0] as number[])[i]!;
            const values: Array<[string, number | null]> = seriesDefs.slice(1).map((s, k) => [String(s.label), (data[k + 1] as (number | null)[])[i] ?? null]);
            setHover({ year: xIsDate ? Math.round(x) : x, values });
          },
        ],
      },
    };
    const plot = new uPlot(opts, data, host);
    plotRef.current = plot;
    const onClick = () => {
      const i = plot.cursor.idx;
      if (i === null || i === undefined || xIsDate) return;
      const year = (data[0] as number[])[i]!;
      const fi = frameIndexByYear.get(year);
      if (fi !== undefined) setIndex(fi);
    };
    host.addEventListener('click', onClick);
    const ro = new ResizeObserver(() => {
      if (host.clientWidth > 0 && host.clientHeight > 0) plot.setSize({ width: host.clientWidth, height: host.clientHeight });
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
      host.removeEventListener('click', onClick);
      plot.destroy();
      plotRef.current = null;
    };
  }, [series, methods, view, seriesMethod, live, theme, t, setIndex, frameIndexByYear]);

  const method = series.methods[seriesMethod];
  const segs = live?.segments ?? method?.pelt.segments ?? [];

  return (
    <aside className="overlay series" data-testid="series-panel" aria-label={t('series.title')}>
      <div className="panel series-inner">
        <div className="series-head">
          <div className="inst-row seg" role="group" aria-label={t('series.view')}>
            <button type="button" className={`chip${view === 'area' ? ' on' : ''}`} onClick={() => setView('area')} data-testid="series-view-area">
              {t('series.views.area')}
            </button>
            <button type="button" className={`chip${view === 'index' ? ' on' : ''}`} onClick={() => setView('index')} data-testid="series-view-index">
              {t('series.views.index')}
            </button>
            {series.dense && (
              <button type="button" className={`chip${view === 'dense' ? ' on' : ''}`} onClick={() => setView('dense')} data-testid="series-view-dense">
                {t('series.views.dense')} ({series.dense.dates.length})
              </button>
            )}
          </div>
          {view === 'area' && (
            <div className="inst-row seg" role="group" aria-label={t('series.method')}>
              {methods.map((m) => (
                <button key={m} type="button" className={`chip${seriesMethod === m ? ' on' : ''}`} style={{ borderColor: METHOD_COLORS[m] }} onClick={() => setSeriesMethod(m)} data-testid={`series-method-${m}`}>
                  {series.methods[m]?.label ?? m}
                </button>
              ))}
              <label className="small chk">
                <input type="checkbox" checked={showMask} onChange={(e) => setShowMask(e.target.checked)} data-testid="series-mask-toggle" /> {t('series.showMask')}
              </label>
            </div>
          )}
          <span className="spacer" />
          <span className="small mono muted" data-testid="series-readout">
            {hover ? `${xIsDateLabel(view, hover.year)} ${hover.values.map(([k, v]) => `${k} ${v === null ? '-' : v.toFixed(view === 'area' ? 2 : 3)}`).join(' / ')}` : t('series.hoverHint')}
          </span>
        </div>
        <div className="series-plot" ref={hostRef} data-testid="series-plot" />
        <div className="series-foot small">
          {view === 'area' && method && (
            <>
              <span className="mono">
                {t('series.envelope')}: {series.envelope_km2?.toFixed(1)} km2 ({series.envelope})
              </span>
              <span className="spacer" />
              <label className="small">
                {t('series.penalty')} x{penaltyScale.toFixed(2)}
                <input type="range" min={0.25} max={4} step={0.25} value={penaltyScale} onChange={(e) => setPenaltyScale(Number(e.target.value))} data-testid="series-penalty" />
              </label>
              <span className="mono" data-testid="series-breaks">
                PELT {live ? live.breaks.join(', ') || t('series.noBreak') : '-'} / CUSUM {method.cusum.alarms.join(', ') || t('series.noAlarm')}
              </span>
              <span className="mono faint">
                {segs.map((s) => `${s.start}-${s.end}: ${s.mean.toFixed(1)} km2, ${s.slope >= 0 ? '+' : ''}${s.slope.toFixed(2)}/yr`).join(' | ')}
              </span>
              {method.flags.length > 0 && <span className="faint">{method.flags.map((f) => t(`series.flags.${f}`, f)).join(', ')}</span>}
            </>
          )}
          {view === 'dense' && series.dense && (
            <span className="mono">
              {t('series.harmonic')}: {series.dense.harmonic.breaks.join(', ') || t('series.noBreak')} / BIC {series.dense.harmonic.bic.toFixed(1)} vs {series.dense.harmonic.bic_no_break.toFixed(1)}
            </span>
          )}
          {view === 'index' && <span className="faint">{t('series.indexNote')}</span>}
        </div>
      </div>
    </aside>
  );
}

function xIsDateLabel(view: string, x: number): string {
  if (view !== 'dense') return String(x);
  return new Date(x * 1000).toISOString().slice(0, 10);
}
