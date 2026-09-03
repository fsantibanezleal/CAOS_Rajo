import { useTranslation } from 'react-i18next';

import { useCatalog } from '../state/catalog';
import { useUI } from '../state/ui';

export function AtlasPage() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const { catalog, error } = useCatalog();
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
      </div>
    </div>
  );
}
