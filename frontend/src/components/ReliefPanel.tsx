// The relief lane: the baked DEM difference (Copernicus 2011 to 2015 minus SRTM 2000) with its noise
// floor and volumes, the epoch toggle for the 3D relief, the vertical exaggeration, and the profile
// tool (two points on the map, both surfaces sampled from terrarium tiles in the browser, charted with
// uPlot). Everything shown is read from dem.json or computed from the tiles; nothing is typed by hand.
import uPlot from 'uplot';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { SiteManifest } from '../lib/contract';
import { useRelief } from '../state/relief';
import { useUI } from '../state/ui';

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

function fmtVolume(m3: number): string {
  if (Math.abs(m3) >= 1e9) return `${(m3 / 1e9).toFixed(2)} km3`;
  return `${(m3 / 1e6).toFixed(1)} Mm3`;
}

export function ReliefPanel({ manifest }: { manifest: SiteManifest }) {
  const { t } = useTranslation();
  const theme = useUI((s) => s.theme);
  const r = useRelief();
  const dem = manifest.dem;
  const hostRef = useRef<HTMLDivElement | null>(null);

  // the stats never vanish: the length and the global surface come from any sampled line; the change
  // needs both surfaces, and the Copernicus coverage says how much of the line the baked window holds
  const stats = useMemo(() => {
    if (!r.samples || !r.samples.length) return null;
    const last = r.samples[r.samples.length - 1]!;
    const globals = r.samples.filter((s) => s.global !== null).map((s) => s.global!);
    const both = r.samples.filter((s) => s.global !== null && s.cop !== null);
    let change: { minDelta: number; minAt: number; maxDelta: number; maxAt: number } | null = null;
    if (both.length) {
      const deltas = both.map((s) => s.cop! - s.global!);
      const minI = deltas.indexOf(Math.min(...deltas));
      const maxI = deltas.indexOf(Math.max(...deltas));
      change = { minDelta: deltas[minI]!, minAt: both[minI]!.d, maxDelta: deltas[maxI]!, maxAt: both[maxI]!.d };
    }
    return {
      lengthM: last.d,
      n: r.samples.length,
      nGlobal: globals.length,
      nCop: r.samples.filter((s) => s.cop !== null).length,
      globalMin: globals.length ? Math.min(...globals) : null,
      globalMax: globals.length ? Math.max(...globals) : null,
      change,
    };
  }, [r.samples]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !r.samples) return;
    const fg = token('--fg-muted');
    const grid = token('--border');
    const xs = r.samples.map((s) => s.d);
    const g = r.samples.map((s) => s.global);
    const c = r.samples.map((s) => s.cop);
    const d = r.samples.map((s) => (s.global !== null && s.cop !== null ? s.cop - s.global : null));
    const plot = new uPlot(
      {
        width: Math.max(300, host.clientWidth),
        height: Math.max(140, host.clientHeight),
        scales: { x: { time: false }, y: {}, d: {} },
        axes: [
          { stroke: fg, grid: { stroke: grid, width: 1 }, values: (_u, v) => v.map((x) => `${Math.round(x)} m`) },
          { stroke: fg, grid: { stroke: grid, width: 1 }, size: 56, label: 'm' },
          { stroke: fg, side: 1, scale: 'd', size: 56, label: t('relief.deltaAxis'), grid: { show: false } },
        ],
        series: [
          { label: t('relief.distance') },
          { label: t('relief.epochs.global'), stroke: theme === 'dark' ? '#a8b3c7' : '#4b5563', width: 1.6, spanGaps: false },
          { label: t('relief.epochs.cop'), stroke: '#e8a33d', width: 1.6, spanGaps: false },
          { label: t('relief.deltaAxis'), stroke: '#60a5fa', width: 1.2, scale: 'd', dash: [4, 3], spanGaps: false },
        ],
        legend: { show: true, live: true },
        cursor: { drag: { x: false, y: false } },
      },
      [xs, g, c, d] as uPlot.AlignedData,
      host,
    );
    const ro = new ResizeObserver(() => host.clientWidth > 0 && plot.setSize({ width: host.clientWidth, height: host.clientHeight }));
    ro.observe(host);
    return () => {
      ro.disconnect();
      plot.destroy();
    };
  }, [r.samples, theme, t]);

  if (!dem || dem.status !== 'ok') {
    return (
      <section className="inst-body" role="tabpanel" data-testid="relief">
        <p className="small muted">{t('relief.none')}</p>
      </section>
    );
  }
  const env = dem.envelope;
  return (
    <section className="inst-body" role="tabpanel" data-testid="relief">
      <div className="method">
        <h3>{t('relief.epochTitle')}</h3>
        <p className="small muted">{t('relief.epochText')}</p>
        <div className="inst-row seg" role="group" aria-label={t('relief.epochTitle')}>
          <button type="button" className={`chip${r.epoch === 'global' ? ' on' : ''}`} onClick={() => r.setEpoch('global')} data-testid="epoch-global">
            {t('relief.epochs.global')}
          </button>
          <button type="button" className={`chip${r.epoch === 'cop' ? ' on' : ''}`} onClick={() => r.setEpoch('cop')} data-testid="epoch-cop" disabled={!dem.terrain_tiles.length}>
            {t('relief.epochs.cop')}
          </button>
        </div>
        <label className="inst-label small">
          {t('relief.exaggeration')} x{r.exaggeration.toFixed(1)}
          <input type="range" min={0.5} max={3} step={0.1} value={r.exaggeration} onChange={(e) => r.setExaggeration(Number(e.target.value))} data-testid="relief-exaggeration" />
        </label>
      </div>
      <div className="method">
        <h3>{t('relief.deltaTitle')}</h3>
        <p className="small muted">{t('relief.deltaText')}</p>
        <div className="inst-row">
          <label className="small chk">
            <input type="checkbox" checked={r.showDelta} onChange={(e) => r.setShowDelta(e.target.checked)} data-testid="delta-toggle" /> {t('relief.showDelta')}
          </label>
          <label className="small">
            {t('instrument.opacity')} {Math.round(r.deltaOpacity * 100)}%
            <input type="range" min={0} max={100} value={Math.round(r.deltaOpacity * 100)} onChange={(e) => r.setDeltaOpacity(Number(e.target.value) / 100)} />
          </label>
        </div>
        <div className="legend delta-legend" />
        <div className="inst-row mono small">
          <span>{dem.delta_range_m[0]} m</span>
          <span className="spacer" />
          <span>0</span>
          <span className="spacer" />
          <span>+{dem.delta_range_m[1]} m</span>
        </div>
        <dl className="stats mono small" data-testid="relief-stats">
          <dt>{t('relief.cut')}</dt>
          <dd>{fmtVolume(env.cut_m3)} ({env.cut_km2.toFixed(1)} km2)</dd>
          <dt>{t('relief.fill')}</dt>
          <dd>{fmtVolume(env.fill_m3)} ({env.fill_km2.toFixed(1)} km2)</dd>
          <dt>{t('relief.deepest')}</dt>
          <dd>{env.min_m ?? '-'} m / {env.max_m ?? '-'} m</dd>
          <dt>{t('relief.floor')}</dt>
          <dd>
            {dem.noise_floor_m ?? '-'} m, {t('relief.tau')} {dem.tau_m} m
          </dd>
          <dt>{t('relief.geoid')}</dt>
          <dd>{dem.geoid_offset_m === null ? t('relief.geoidNone') : `${dem.geoid_offset_m} m`}</dd>
          <dt>{t('relief.window')}</dt>
          <dd>
            {fmtVolume(dem.window.cut_m3)} / {fmtVolume(dem.window.fill_m3)}
          </dd>
        </dl>
        {dem.flags.length > 0 && <p className="small bad">{dem.flags.map((f) => t(`relief.flags.${f}`, f)).join(', ')}</p>}
        <p className="small faint">{t('relief.envelopeNote')}</p>
      </div>
      <div className="method">
        <h3>{t('relief.profileTitle')}</h3>
        <p className="small muted">{t('relief.profileText')}</p>
        <div className="inst-row">
          <button type="button" className={`btn${r.picking ? ' on' : ''}`} onClick={() => r.setPicking(!r.picking)} data-testid="profile-pick">
            {r.picking ? t('relief.picking', { n: r.points.length }) : t('relief.pick')}
          </button>
          <button type="button" className="btn" onClick={() => r.clearProfile()} disabled={!r.points.length && !r.samples} data-testid="profile-clear">
            {t('relief.clear')}
          </button>
        </div>
        <p className="small mono faint" data-testid="profile-state">
          {r.picking ? `picking ${r.points.length}/2` : r.samples ? `profile ${r.samples.length} samples` : r.sampling ? `sampling ${r.sampled}/200` : 'idle'}
        </p>
        {r.sampling && <p className="small muted">{t('relief.sampling')}</p>}
        {r.profileError && (
          <p className="small bad" data-testid="profile-error">
            {r.profileError}
          </p>
        )}
        {r.samples && (
          <>
            <div className="profile-plot" ref={hostRef} data-testid="profile-plot" />
            {stats && (
              <dl className="stats mono small" data-testid="profile-stats">
                <dt>{t('relief.length')}</dt>
                <dd>{(stats.lengthM / 1000).toFixed(2)} km</dd>
                <dt>{t('relief.globalRange')}</dt>
                <dd>{stats.globalMin !== null && stats.globalMax !== null ? `${stats.globalMin.toFixed(0)} to ${stats.globalMax.toFixed(0)} m` : t('relief.noSamples')}</dd>
                <dt>{t('relief.coverage')}</dt>
                <dd data-testid="profile-coverage">
                  {stats.nCop}/{stats.n}
                </dd>
                {stats.change ? (
                  <>
                    <dt>{t('relief.deepestChange')}</dt>
                    <dd>
                      {stats.change.minDelta.toFixed(0)} m {t('relief.at')} {(stats.change.minAt / 1000).toFixed(2)} km
                    </dd>
                    <dt>{t('relief.highestChange')}</dt>
                    <dd>
                      +{stats.change.maxDelta.toFixed(0)} m {t('relief.at')} {(stats.change.maxAt / 1000).toFixed(2)} km
                    </dd>
                  </>
                ) : (
                  <>
                    <dt>{t('relief.deepestChange')}</dt>
                    <dd className="muted">{t('relief.outsideWindow')}</dd>
                  </>
                )}
              </dl>
            )}
          </>
        )}
      </div>
    </section>
  );
}
