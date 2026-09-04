import { useTranslation } from 'react-i18next';

import { COCHILCO_BY_COMPANY_URL, COPPER_BY_COUNTRY, COPPER_OTHER_COUNTRIES, COPPER_WORLD, USGS_MCS_2026_COPPER_URL } from '../content/production';
import { useCatalog } from '../state/catalog';
import { useUI } from '../state/ui';

const kt = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 });

export function AtlasPage() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const { catalog, error } = useCatalog();
  // the counts come from the catalog, which arrives after the first paint: until it does the column
  // holds a dash. Printing 0 there is a wrong number on screen, not a loading state (found on the
  // deployed site while capturing the Atlas, 2026-09-04).
  const counted = !!catalog;
  const copperSites = new Map<string, number>();
  for (const s of catalog?.sites ?? []) {
    if (s.categories.some((c) => c.startsWith('copper'))) copperSites.set(s.country, (copperSites.get(s.country) ?? 0) + 1);
  }
  const other = COPPER_OTHER_COUNTRIES.reduce((n, iso) => n + (copperSites.get(iso) ?? 0), 0);
  return (
    <div className="page">
      <div className="inner">
        <h1>{t('atlas.title')}</h1>
        <p className="lede">{t('atlas.lede')}</p>
        {error && <p className="muted">{t('observatory.noSites')}</p>}
        {catalog && (
          <table data-testid="atlas-table">
            <thead>
              <tr>
                <th>{t('atlas.columns.site')}</th>
                <th>{t('atlas.columns.country')}</th>
                <th>{t('atlas.columns.categories')}</th>
                <th>{t('atlas.columns.seed')}</th>
                <th>{t('atlas.columns.frames')}</th>
              </tr>
            </thead>
            <tbody>
              {catalog.sites.map((s) => (
                <tr key={s.site_id}>
                  <td>{lang === 'es' ? s.name_es : s.name}</td>
                  <td className="mono">{s.country}</td>
                  <td>{s.categories.map((c) => t(`categories.${c}`)).join(', ')}</td>
                  <td className="mono">
                    {s.lon.toFixed(3)}, {s.lat.toFixed(3)}
                  </td>
                  <td className="mono">{s.n_frames}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h2 id="copper-by-country">{t('atlas.production.title')}</h2>
        <p className="lede">{t('atlas.production.lede')}</p>
        <table data-testid="atlas-production">
          <thead>
            <tr>
              <th>{t('atlas.production.columns.country')}</th>
              <th>{t('atlas.production.columns.sites')}</th>
              <th>{t('atlas.production.columns.mine2024')}</th>
              <th>{t('atlas.production.columns.mine2025')}</th>
              <th>{t('atlas.production.columns.reported2025')}</th>
              <th>{t('atlas.production.columns.reserves')}</th>
            </tr>
          </thead>
          <tbody>
            {COPPER_BY_COUNTRY.map((c) => (
              <tr key={c.iso3}>
                <td>
                  {c.name[lang === 'es' ? 'es' : 'en']} <span className="mono faint">{c.iso3}</span>
                </td>
                <td className="mono">{counted ? (copperSites.get(c.iso3) ?? 0) : '-'}</td>
                <td className="mono">{kt(c.mine2024)}</td>
                <td className="mono">{kt(c.mine2025e)}</td>
                <td className="mono">{c.reported2025 ? `${kt(c.reported2025.value)} (Cochilco)` : ''}</td>
                <td className="mono">{c.reserves === null ? '' : kt(c.reserves)}</td>
              </tr>
            ))}
            <tr>
              <td>{t('atlas.production.other')}</td>
              <td className="mono">{counted ? other : '-'}</td>
              <td className="mono">{kt(2850)}</td>
              <td className="mono">{kt(3000)}</td>
              <td className="mono"></td>
              <td className="mono">{kt(210000)}</td>
            </tr>
            <tr>
              <td>
                <strong>{t('atlas.production.world')}</strong>
              </td>
              <td className="mono">{counted ? [...copperSites.values()].reduce((a, b) => a + b, 0) : '-'}</td>
              <td className="mono">{kt(COPPER_WORLD.mine2024)}</td>
              <td className="mono">{kt(COPPER_WORLD.mine2025e)}</td>
              <td className="mono"></td>
              <td className="mono">{kt(COPPER_WORLD.reserves)}</td>
            </tr>
          </tbody>
        </table>
        <p className="small muted">
          {t('atlas.production.note')}{' '}
          <a href={USGS_MCS_2026_COPPER_URL} target="_blank" rel="noreferrer">
            USGS MCS 2026
          </a>
          {' / '}
          <a href={COCHILCO_BY_COMPANY_URL} target="_blank" rel="noreferrer">
            Cochilco
          </a>
        </p>
      </div>
    </div>
  );
}
