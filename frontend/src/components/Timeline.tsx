// The timeline bar: play/pause (paused by default), the year scrubber with tick marks, the frame readout
// (sensor, acquisition date, cloud-free fraction, flags), the composite mode and the overlay opacity.
// Keyboard: left and right arrows step a year, space toggles playback when the bar has focus.
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { Frame, SiteManifest } from '../lib/contract';
import { useTimeline } from '../state/timeline';
import { useUI } from '../state/ui';

export interface TimelineProps {
  manifest: SiteManifest;
  onFrame: (frame: Frame) => void;
}

const SENSOR_LABEL: Record<string, string> = {
  'landsat-5': 'Landsat 5 TM',
  'landsat-7': 'Landsat 7 ETM+',
  'landsat-8': 'Landsat 8 OLI',
  'landsat-9': 'Landsat 9 OLI-2',
  'sentinel-2a': 'Sentinel-2A MSI',
  'sentinel-2b': 'Sentinel-2B MSI',
  'sentinel-2c': 'Sentinel-2C MSI',
};

export function Timeline({ manifest, onFrame }: TimelineProps) {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const frames = manifest.frames;
  const count = frames.length;
  const index = useTimeline((s) => s.index);
  const playing = useTimeline((s) => s.playing);
  const mode = useTimeline((s) => s.mode);
  const opacity = useTimeline((s) => s.opacity);
  const speedMs = useTimeline((s) => s.speedMs);
  const setIndex = useTimeline((s) => s.setIndex);
  const step = useTimeline((s) => s.step);
  const togglePlaying = useTimeline((s) => s.togglePlaying);
  const setPlaying = useTimeline((s) => s.setPlaying);
  const setMode = useTimeline((s) => s.setMode);
  const setOpacity = useTimeline((s) => s.setOpacity);
  const showSeries = useTimeline((s) => s.showSeries);
  const setShowSeries = useTimeline((s) => s.setShowSeries);
  const barRef = useRef<HTMLDivElement | null>(null);

  // land on the newest frame when a site arrives
  useEffect(() => {
    setPlaying(false);
    setIndex(count > 0 ? count - 1 : -1);
  }, [manifest.site_id, count, setIndex, setPlaying]);

  const frame = index >= 0 && index < count ? frames[index] : undefined;
  useEffect(() => {
    if (frame) onFrame(frame);
  }, [frame, onFrame]);

  // playback
  useEffect(() => {
    if (!playing || count === 0) return;
    const id = window.setInterval(() => step(1, count), speedMs);
    return () => window.clearInterval(id);
  }, [playing, count, speedMs, step]);

  const ticks = useMemo(() => {
    if (count === 0) return [];
    const first = frames[0]!.year;
    const last = frames[count - 1]!.year;
    const out: Array<{ year: number; pct: number }> = [];
    for (let y = Math.ceil(first / 5) * 5; y <= last; y += 5) out.push({ year: y, pct: ((y - first) / Math.max(1, last - first)) * 100 });
    return out;
  }, [frames, count]);

  if (count === 0) {
    return (
      <div className="overlay timeline" data-testid="timeline">
        <div className="panel tl-empty">{t('timeline.noFrames')}</div>
      </div>
    );
  }
  const first = frames[0]!.year;
  const last = frames[count - 1]!.year;
  const pos = frame ? ((frame.year - first) / Math.max(1, last - first)) * 100 : 0;

  return (
    <div
      className="overlay timeline"
      data-testid="timeline"
      ref={barRef}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          step(-1, count);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          step(1, count);
        } else if (e.key === ' ') {
          e.preventDefault();
          togglePlaying();
        }
      }}
    >
      <div className="panel tl">
        <div className="tl-left">
          <button className="iconbtn" type="button" onClick={() => step(-1, count)} title={t('timeline.prev')} aria-label={t('timeline.prev')}>
            <SkipBack size={16} />
          </button>
          <button
            className={`iconbtn play${playing ? ' on' : ''}`}
            type="button"
            onClick={togglePlaying}
            title={playing ? t('timeline.pause') : t('timeline.play')}
            aria-label={playing ? t('timeline.pause') : t('timeline.play')}
            aria-pressed={playing}
            data-testid="play-btn"
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button className="iconbtn" type="button" onClick={() => step(1, count)} title={t('timeline.next')} aria-label={t('timeline.next')}>
            <SkipForward size={16} />
          </button>
          <div className="tl-year" data-testid="tl-year">
            {frame?.year}
          </div>
        </div>

        <div className="tl-track">
          <input
            type="range"
            min={0}
            max={count - 1}
            value={Math.max(0, index)}
            onChange={(e) => {
              setPlaying(false);
              setIndex(Number(e.target.value));
            }}
            aria-label={t('timeline.scrub')}
            aria-valuetext={frame ? `${frame.year} ${SENSOR_LABEL[frame.sensor] ?? frame.sensor}` : ''}
            data-testid="tl-range"
          />
          <div className="tl-ticks" aria-hidden="true">
            {ticks.map((k) => (
              <span key={k.year} style={{ left: `${k.pct}%` }}>
                {k.year}
              </span>
            ))}
            <span className="tl-cursor" style={{ left: `${pos}%` }} />
          </div>
        </div>

        <div className="tl-meta" data-testid="tl-meta">
          {frame && (
            <>
              <span className="tl-sensor">{SENSOR_LABEL[frame.sensor] ?? frame.sensor}</span>
              <span className="dot">&middot;</span>
              <span className="mono">{frame.date}</span>
              <span className="dot">&middot;</span>
              <span title={t('timeline.validHelp')}>
                {t('timeline.valid')} {frame.valid_pct.toFixed(1)}%
              </span>
              {frame.flags.length > 0 && (
                <>
                  <span className="dot">&middot;</span>
                  <span className="tl-flags" title={frame.flags.map((f) => t(`timeline.flags.${f}`, f)).join(', ')}>
                    {frame.flags.map((f) => t(`timeline.flags.${f}`, f)).join(', ')}
                  </span>
                </>
              )}
            </>
          )}
        </div>

        <div className="tl-right">
          {manifest.series && (
            <button
              type="button"
              className={`chip series-btn${showSeries ? ' on' : ''}`}
              onClick={() => setShowSeries(!showSeries)}
              aria-pressed={showSeries}
              data-testid="series-btn"
              title={t('timeline.seriesTitle')}
            >
              {t('timeline.series')}
            </button>
          )}
          <div className="seg" role="group" aria-label={t('timeline.mode')}>
            <button type="button" className={`chip${mode === 'tc' ? ' on' : ''}`} onClick={() => setMode('tc')} data-testid="mode-tc">
              {t('timeline.trueColour')}
            </button>
            <button type="button" className={`chip${mode === 'swir' ? ' on' : ''}`} onClick={() => setMode('swir')} data-testid="mode-swir">
              {t('timeline.swir')}
            </button>
          </div>
          <label className="tl-opacity" title={t('timeline.opacity')}>
            <span className="faint">{t('timeline.opacity')}</span>
            <input type="range" min={0} max={100} value={Math.round(opacity * 100)} onChange={(e) => setOpacity(Number(e.target.value) / 100)} aria-label={t('timeline.opacity')} />
          </label>
          <span className="faint tl-count">
            {count} {lang === 'es' ? 'cuadros' : 'frames'} {first} to {last}
          </span>
        </div>
      </div>
    </div>
  );
}
