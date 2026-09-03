// The observatory: a full-bleed map with floating instruments. The map takes the whole surface; the rail,
// the controls, the status line, the timeline, the instrument panel and the attribution float over it.
// The site selector is one grouped select (categories as optgroups); choosing a site flies the camera,
// draws the reference polygons and the site window, shows the time-lapse and the instrument panel, and
// writes ?site= into the URL so the view is shareable.
import type { Map as MLMap } from 'maplibre-gl';
import { Compass, Mountain, Tag, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Instrument } from '../components/Instrument';
import { Timeline } from '../components/Timeline';
import type { CatalogEntry, Category, Frame } from '../lib/contract';
import { ensureFrameLayer, frameUrl, preload, removeFrameLayer, setFrameOpacity } from '../map/frameOverlay';
import { hideLive, setLiveOpacity, showLive } from '../map/liveOverlay';
import { MapView, TERRAIN_EXAGGERATION } from '../map/MapView';
import { clearSite, flyToSite, showSite } from '../map/siteLayers';
import { useCatalog } from '../state/catalog';
import { useLive } from '../state/live';
import { readSiteParam, useManifest, writeSiteParam } from '../state/site';
import { useTimeline } from '../state/timeline';
import { useUI } from '../state/ui';
import { lonLatToUtm } from '../lib/utm';

const CATEGORY_ORDER: Category[] = [
  'copper-chile',
  'lithium-brine',
  'copper-world',
  'iron',
  'gold',
  'lignite',
  'diamonds',
  'oil-sands',
];

export function Observatory() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const { catalog, error: catalogError } = useCatalog();
  const [map, setMap] = useState<MLMap | null>(null);
  const [cursor, setCursor] = useState<{ lon: number; lat: number; elev: number | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [terrain, setTerrain] = useState(true);
  const [labels, setLabels] = useState(true);
  const [siteId, setSiteId] = useState<string>(readSiteParam);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [liveOpacity, setLiveOpacityState] = useState(1);
  const mode = useTimeline((s) => s.mode);
  const opacity = useTimeline((s) => s.opacity);
  const liveLayer = useLive((s) => s.layer);
  const liveGrid = useLive((s) => s.grid);
  const clearLive = useLive((s) => s.clear);

  const entry: CatalogEntry | undefined = useMemo(() => catalog?.sites.find((s) => s.site_id === siteId), [catalog, siteId]);
  const { manifest } = useManifest(entry ? siteId : '', entry?.manifest_path);

  const groups = useMemo(() => {
    if (!catalog) return [];
    const byCat = new Map<Category, CatalogEntry[]>();
    for (const s of catalog.sites) {
      const primary = CATEGORY_ORDER.find((c) => s.categories.includes(c)) ?? s.categories[0] ?? 'copper-world';
      const list = byCat.get(primary) ?? [];
      list.push(s);
      byCat.set(primary, list);
    }
    return CATEGORY_ORDER.filter((c) => byCat.has(c)).map((c) => ({
      category: c,
      sites: (byCat.get(c) ?? []).slice().sort((a, b) => (lang === 'es' ? a.name_es.localeCompare(b.name_es) : a.name.localeCompare(b.name))),
    }));
  }, [catalog, lang]);

  const onMap = useCallback((m: MLMap | null) => {
    setMap(m);
    if (m) m.setTerrain({ source: 'terrain', exaggeration: TERRAIN_EXAGGERATION });
  }, []);

  // keep the URL in step with the selection
  useEffect(() => writeSiteParam(siteId), [siteId]);

  // a new site: drop the live read of the previous one
  useEffect(() => {
    clearLive();
    if (map && map.isStyleLoaded()) hideLive(map);
  }, [siteId, clearLive, map]);

  // draw and fly when the manifest arrives (and again after a style rebuild)
  useEffect(() => {
    if (!map) return;
    if (!manifest) {
      setFrame(null);
      if (map.isStyleLoaded()) {
        clearSite(map);
        removeFrameLayer(map);
      }
      return;
    }
    const draw = () => {
      void showSite(map, manifest, `${import.meta.env.BASE_URL}data/sites/${manifest.site_id}/polygons.geojson`);
    };
    if (map.isStyleLoaded()) draw();
    else map.once('style.load', draw);
    flyToSite(map, manifest);
    map.on('style.load', draw);
    return () => {
      map.off('style.load', draw);
    };
  }, [map, manifest]);

  // the frame overlay follows the timeline (and survives a style rebuild)
  useEffect(() => {
    if (!map || !manifest || !frame) return;
    const url = frameUrl(manifest, frame, mode);
    const apply = () => {
      ensureFrameLayer(map, manifest, url);
      setFrameOpacity(map, opacity);
    };
    let cancelled = false;
    void preload(url).then(() => {
      if (cancelled) return;
      if (map.isStyleLoaded()) apply();
      else map.once('style.load', apply);
    });
    const i = manifest.frames.indexOf(frame);
    for (const j of [i + 1, i - 1, i + 2]) {
      const f = manifest.frames[j];
      if (f) void preload(frameUrl(manifest, f, mode));
    }
    map.on('style.load', apply);
    return () => {
      cancelled = true;
      map.off('style.load', apply);
    };
  }, [map, manifest, frame, mode, opacity]);

  // the live layer (composite, index, mask) drapes over the frames and survives a style rebuild
  useEffect(() => {
    if (!map) return;
    if (!liveLayer || !liveGrid) {
      if (map.isStyleLoaded()) hideLive(map);
      return;
    }
    const rgba = liveLayer.kind === 'composite' ? liveLayer.rgba : liveLayer.result.rgba;
    const apply = () => void showLive(map, liveGrid, rgba, liveOpacity);
    if (map.isStyleLoaded()) apply();
    else map.once('style.load', apply);
    map.on('style.load', apply);
    return () => {
      map.off('style.load', apply);
    };
  }, [map, liveLayer, liveGrid, liveOpacity]);

  useEffect(() => {
    if (map && map.isStyleLoaded()) setLiveOpacity(map, liveOpacity);
  }, [map, liveOpacity]);

  const onFrame = useCallback((f: Frame) => setFrame(f), []);
  const onOpacity = useCallback((o: number) => setLiveOpacityState(o), []);
  const hasFrames = !!manifest && manifest.frames.length > 0;

  // the value under the cursor on the live layer
  const liveValue = useMemo(() => {
    if (!cursor || !liveLayer || !liveGrid) return null;
    const [x, y] = lonLatToUtm(liveGrid.epsg, cursor.lon, cursor.lat);
    const col = Math.floor((x - liveGrid.left) / liveGrid.pixelM);
    const row = Math.floor((liveGrid.top - y) / liveGrid.pixelM);
    if (col < 0 || row < 0 || col >= liveGrid.width || row >= liveGrid.height) return null;
    const i = row * liveGrid.width + col;
    if (liveLayer.kind === 'index') {
      const v = liveLayer.result.values[i];
      return v === undefined || !Number.isFinite(v) ? null : `${t(`indices.${liveLayer.result.name}.name`).split(',')[0]} ${v.toFixed(3)}`;
    }
    if (liveLayer.kind === 'otsu' || liveLayer.kind === 'sam') {
      const v = liveLayer.result.values?.[i];
      const inMask = liveLayer.result.mask[i] === 1;
      return `${liveLayer.kind === 'otsu' ? 'BSI' : 'angle'} ${v !== undefined && Number.isFinite(v) ? v.toFixed(3) : '-'} ${inMask ? '(in mask)' : ''}`;
    }
    if (liveLayer.kind === 'kmeans') {
      const lab = liveLayer.result.labels[i];
      return lab === undefined || lab === 255 ? null : `cluster ${lab + 1}`;
    }
    return null;
  }, [cursor, liveLayer, liveGrid, t]);

  return (
    <section className={`obs${manifest ? ' with-timeline' : ''}`} aria-label={t('observatory.title')}>
      <MapView onMap={onMap} onCursor={setCursor} onStatus={setLoading} terrain={terrain} labels={labels} />

      <div className="overlay rail">
        <div className="panel">
          <label htmlFor="site-select">{t('observatory.pickSite')}</label>
          <select id="site-select" data-testid="site-select" value={entry ? siteId : ''} onChange={(e) => setSiteId(e.target.value)}>
            <option value="">{t('observatory.world')}</option>
            {groups.map((g) => (
              <optgroup key={g.category} label={t(`categories.${g.category}`)}>
                {g.sites.map((s) => (
                  <option key={s.site_id} value={s.site_id}>
                    {lang === 'es' ? s.name_es : s.name} ({s.country})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {catalogError && (
            <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
              {t('observatory.noSites')}
            </p>
          )}
          {manifest && (
            <div className="sitecard" data-testid="site-card">
              <h2>{lang === 'es' ? manifest.site.name_es : manifest.site.name_en}</h2>
              <p className="muted">
                {manifest.site.categories.map((c) => t(`categories.${c}`)).join(' / ')}
                {manifest.site.operator ? ` / ${manifest.site.operator}` : ''}
              </p>
              <dl>
                <dt>{t('observatory.window')}</dt>
                <dd className="mono">
                  {manifest.site.window_km} km / EPSG:{manifest.window.epsg} / {manifest.window.width}x{manifest.window.height} px
                </dd>
                <dt>{t('observatory.polygons')}</dt>
                <dd className="mono">
                  {manifest.polygons.n_features} / {manifest.polygons.area_km2.toFixed(1)} km2
                </dd>
                {hasFrames && (
                  <>
                    <dt>{t('observatory.frames')}</dt>
                    <dd className="mono">
                      {manifest.frames.length} / {manifest.frames[0]!.year} to {manifest.frames[manifest.frames.length - 1]!.year}
                    </dd>
                  </>
                )}
              </dl>
              {manifest.site.facts.length > 0 && (
                <ul className="facts">
                  {manifest.site.facts.map((f) => (
                    <li key={f.source + f.text_en.slice(0, 20)}>
                      {lang === 'es' ? f.text_es : f.text_en}{' '}
                      <a href={f.source} target="_blank" rel="noreferrer" title={f.source}>
                        [{t('observatory.source')}]
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <p className="faint" style={{ fontSize: 11, margin: '8px 0 0' }}>
                {t('observatory.polygonsCredit')}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="overlay mapctl">
        <div className="panel">
          <button className="iconbtn" type="button" title={t('map.zoomIn')} aria-label={t('map.zoomIn')} onClick={() => map?.zoomIn()}>
            <ZoomIn size={17} />
          </button>
          <button className="iconbtn" type="button" title={t('map.zoomOut')} aria-label={t('map.zoomOut')} onClick={() => map?.zoomOut()}>
            <ZoomOut size={17} />
          </button>
          <button
            className="iconbtn"
            type="button"
            title={t('map.resetNorth')}
            aria-label={t('map.resetNorth')}
            onClick={() => map?.easeTo({ bearing: 0, pitch: 0 })}
          >
            <Compass size={17} />
          </button>
        </div>
        <div className="panel">
          <button
            className={`iconbtn${terrain ? ' on' : ''}`}
            type="button"
            title={t('map.terrain')}
            aria-label={t('map.terrain')}
            aria-pressed={terrain}
            data-testid="terrain-btn"
            onClick={() => setTerrain((v) => !v)}
          >
            <Mountain size={17} />
          </button>
          <button
            className={`iconbtn${labels ? ' on' : ''}`}
            type="button"
            title={t('map.labels')}
            aria-label={t('map.labels')}
            aria-pressed={labels}
            data-testid="labels-btn"
            onClick={() => setLabels((v) => !v)}
          >
            <Tag size={17} />
          </button>
        </div>
      </div>

      {manifest && <Instrument manifest={manifest} onOpacity={onOpacity} />}

      <div className="overlay mapstatus" data-testid="map-status">
        <div className="panel">
          {loading ? t('map.status.tiles') : t('map.status.ready')}
          {cursor && (
            <>
              <span className="dot"> &middot; </span>
              {cursor.lat.toFixed(4)}, {cursor.lon.toFixed(4)}
              {cursor.elev !== null && (
                <>
                  <span className="dot"> &middot; </span>
                  {cursor.elev} m
                </>
              )}
              {liveValue && (
                <>
                  <span className="dot"> &middot; </span>
                  <span data-testid="live-value">{liveValue}</span>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {manifest && <Timeline manifest={manifest} onFrame={onFrame} />}

      <div className="overlay attrib">
        <div className="panel">
          <span dangerouslySetInnerHTML={{ __html: attributionHtml(frame) }} />
        </div>
      </div>
    </section>
  );
}

function attributionHtml(frame: Frame | null): string {
  const parts = [
    'Sentinel-2 cloudless - <a href="https://s2maps.eu" target="_blank" rel="noreferrer">s2maps.eu</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024)',
    '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">Terrain Tiles</a> by Mapzen',
    '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> &copy; OpenMapTiles, data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    'Mining polygons: <a href="https://doi.org/10.1594/PANGAEA.942325" target="_blank" rel="noreferrer">Maus et al. 2022</a> (CC BY-SA 4.0)',
  ];
  if (frame) {
    parts.push(
      frame.collection === 'sentinel-2-l2a'
        ? `Frame: Contains modified Copernicus Sentinel data ${frame.date.slice(0, 4)} (Earth Search, AWS Open Data)`
        : `Frame: Landsat Collection 2 courtesy of the U.S. Geological Survey (Microsoft Planetary Computer), ${frame.date.slice(0, 4)}`,
    );
  }
  return parts.join(' &middot; ');
}
