// The observatory: a full-bleed map with floating instruments. The map takes the whole surface; the rail,
// the controls, the status line and the attribution float over it. The site selector is one grouped
// select (categories as optgroups); choosing a site flies the camera, draws the reference polygons and
// the site window, and writes ?site= into the URL so the view is shareable.
import type { Map as MLMap } from 'maplibre-gl';
import { Compass, Mountain, Tag, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CatalogEntry, Category } from '../lib/contract';
import { MapView, TERRAIN_EXAGGERATION } from '../map/MapView';
import { clearSite, flyToSite, showSite } from '../map/siteLayers';
import { useCatalog } from '../state/catalog';
import { readSiteParam, useManifest, writeSiteParam } from '../state/site';
import { useUI } from '../state/ui';

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

  // draw and fly when the manifest arrives (and after a style rebuild)
  useEffect(() => {
    if (!map) return;
    if (!manifest) {
      if (map.isStyleLoaded()) clearSite(map);
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

  return (
    <section className="obs" aria-label={t('observatory.title')}>
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
            </>
          )}
        </div>
      </div>

      <div className="overlay attrib">
        <div className="panel">
          <span dangerouslySetInnerHTML={{ __html: attributionHtml() }} />
        </div>
      </div>
    </section>
  );
}

function attributionHtml(): string {
  return [
    'Sentinel-2 cloudless - <a href="https://s2maps.eu" target="_blank" rel="noreferrer">s2maps.eu</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024)',
    '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">Terrain Tiles</a> by Mapzen',
    '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> &copy; OpenMapTiles, data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    'Mining polygons: <a href="https://doi.org/10.1594/PANGAEA.942325" target="_blank" rel="noreferrer">Maus et al. 2022</a> (CC BY-SA 4.0)',
  ].join(' &middot; ');
}
