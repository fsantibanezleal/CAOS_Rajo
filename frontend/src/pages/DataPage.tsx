// The Data page: every source Rajo reads, probed and licensed (transcribed from docs/data/01_sources.md),
// the attribution block rendered verbatim (docs/data/03_attribution.md), the two data contracts, and the
// catalog as it is baked (read from catalog.json and the manifests: sites, frames, gaps, series, DEM).
import { ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SOURCES, type SourceRow } from '../content/sources';
import type { SiteManifest } from '../lib/contract';
import { useCatalog } from '../state/catalog';
import { useUI } from '../state/ui';

const ATTRIBUTION_KEYS = ['sentinel', 'landsat', 'terrain', 'copdem', 'srtm', 'polygons', 'eox', 'ofm'] as const;

interface SiteSummary {
  id: string;
  name: string;
  country: string;
  frames: number;
  first: number | null;
  last: number | null;
  gaps: number;
  series: boolean;
  dem: boolean;
  masks: string[];
}

export function DataPage() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const { catalog } = useCatalog();
  const [summary, setSummary] = useState<SiteSummary[] | null>(null);

  useEffect(() => {
    if (!catalog) return;
    let alive = true;
    (async () => {
      const rows: SiteSummary[] = [];
      for (const s of catalog.sites) {
        try {
          const r = await fetch(`${import.meta.env.BASE_URL}data/${s.manifest_path}`);
          if (!r.ok) continue;
          const m = (await r.json()) as SiteManifest;
          const years = m.frames.map((f) => f.year);
          const masks = new Set<string>();
          for (const f of m.frames) for (const k of Object.keys(f.masks ?? {})) masks.add(k);
          rows.push({
            id: m.site_id,
            name: lang === 'es' ? m.site.name_es : m.site.name_en,
            country: m.site.country,
            frames: m.frames.length,
            first: years.length ? Math.min(...years) : null,
            last: years.length ? Math.max(...years) : null,
            gaps: Object.keys(m.gaps ?? {}).length,
            series: !!m.series,
            dem: !!m.dem && m.dem.status === 'ok',
            masks: [...masks].sort(),
          });
        } catch {
          // a missing manifest is reported by the catalog row itself
        }
      }
      if (alive) setSummary(rows);
    })();
    return () => {
      alive = false;
    };
  }, [catalog, lang]);

  const groups = [...new Set(SOURCES.map((s) => s.group))];
  const totalFrames = summary?.reduce((a, r) => a + r.frames, 0) ?? 0;

  return (
    <div className="page data" data-testid="data-page">
      <div className="inner">
        <h1>{t('data.title')}</h1>
        <p className="lede">{t('data.lede')}</p>

        <h2>{t('data.sources.title')}</h2>
        <p>{t('data.sources.text')}</p>
        {groups.map((g) => (
          <section key={g}>
            <h3>{t(`data.sources.groups.${g}`)}</h3>
            <div className="table-wrap">
              <table data-testid={`sources-${g}`}>
                <thead>
                  <tr>
                    <th>{t('data.sources.columns.source')}</th>
                    <th>{t('data.sources.columns.role')}</th>
                    <th>{t('data.sources.columns.access')}</th>
                    <th>{t('data.sources.columns.browser')}</th>
                    <th>{t('data.sources.columns.licence')}</th>
                  </tr>
                </thead>
                <tbody>
                  {SOURCES.filter((s) => s.group === g).map((s: SourceRow) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.name}</strong>
                        {s.url && (
                          <>
                            {' '}
                            <a href={s.url} target="_blank" rel="noreferrer" aria-label={s.name}>
                              <ExternalLink size={11} />
                            </a>
                          </>
                        )}
                        {s.doi && (
                          <div className="small">
                            <a href={`https://doi.org/${s.doi}`} target="_blank" rel="noreferrer" className="mono">
                              doi:{s.doi}
                            </a>
                          </div>
                        )}
                      </td>
                      <td>{s.role[lang]}</td>
                      <td className="small">{s.access[lang]}</td>
                      <td className="small">
                        <span className={`lane ${s.browser === 'yes' ? 'lane-live' : s.browser === 'no' ? 'lane-baked' : 'lane-both'}`}>{t(`data.sources.browser.${s.browser}`)}</span>
                      </td>
                      <td className="small">{s.licence[lang]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        <p className="small muted">{t('data.sources.rejected')}</p>

        <h2>{t('data.facts.title')}</h2>
        <ul className="small">
          <li>{t('data.facts.s2')}</li>
          <li>{t('data.facts.landsat')}</li>
          <li>{t('data.facts.terrarium')}</li>
          <li>{t('data.facts.qa')}</li>
        </ul>

        <h2>{t('data.contracts.title')}</h2>
        <p>{t('data.contracts.ingestion')}</p>
        <p>{t('data.contracts.artifact')}</p>
        <p>{t('data.contracts.guards')}</p>

        <h2>{t('data.catalog.title')}</h2>
        <p>
          {t('data.catalog.text', { sites: catalog?.n_sites ?? 0, frames: totalFrames })}
        </p>
        {summary ? (
          <div className="table-wrap">
            <table data-testid="catalog-summary">
              <thead>
                <tr>
                  <th>{t('atlas.columns.site')}</th>
                  <th>{t('atlas.columns.country')}</th>
                  <th>{t('data.catalog.columns.frames')}</th>
                  <th>{t('data.catalog.columns.span')}</th>
                  <th>{t('data.catalog.columns.gaps')}</th>
                  <th>{t('data.catalog.columns.masks')}</th>
                  <th>{t('data.catalog.columns.series')}</th>
                  <th>{t('data.catalog.columns.dem')}</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a href={`/?site=${r.id}`}>{r.name}</a>
                    </td>
                    <td className="mono">{r.country}</td>
                    <td className="mono">{r.frames}</td>
                    <td className="mono">{r.first !== null ? `${r.first} to ${r.last}` : t('data.catalog.pending')}</td>
                    <td className="mono">{r.gaps}</td>
                    <td className="mono">{r.masks.join(', ') || '-'}</td>
                    <td className="mono">{r.series ? t('common.yes') : '-'}</td>
                    <td className="mono">{r.dem ? t('common.yes') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="small muted">{t('common.loading')}</p>
        )}
        <p className="small muted">{t('data.catalog.note')}</p>

        <h2>{t('data.attribution.title')}</h2>
        <p className="small muted">{t('data.attribution.text')}</p>
        <table data-testid="attribution-table">
          <tbody>
            {ATTRIBUTION_KEYS.map((k) => (
              <tr key={k}>
                <td>{t(`attribution.${k}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">{t('data.attribution.derived')}</p>
      </div>
    </div>
  );
}
