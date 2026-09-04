// The Methods page: the twelve computations grouped by the question they answer, each with its equations
// (KaTeX), where it runs (live, baked, both), its sources with DOIs and its caveats, transcribed from the
// docs wiki. Below them, the held-out benchmark read from /models/benchmark.json when the models ship.
import { ExternalLink } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { docUrl, METHODS, type MethodEntry, QUESTIONS } from '../content/methods';
import { Tex } from '../lib/tex';
import { useModels } from '../state/models';
import { useUI } from '../state/ui';

const ORDER: MethodEntry['question'][] = ['look', 'find', 'change', 'relief'];

export function MethodsPage() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const models = useModels();
  useEffect(() => void models.load(), [models]);
  const bench = models.benchmark;

  return (
    <div className="page methods" data-testid="methods-page">
      <div className="inner">
        <h1>{t('methods.title')}</h1>
        <p className="lede">{t('methods.lede')}</p>
        <p className="small muted">{t('methods.notation')}</p>
        <nav className="method-toc" aria-label={t('methods.title')}>
          {METHODS.map((m) => (
            <a key={m.id} href={`#${m.id}`} className="chip">
              {m.id} {m.name[lang]}
            </a>
          ))}
        </nav>

        {ORDER.map((q) => (
          <section key={q} className="question">
            <h2>{QUESTIONS[q][lang]}</h2>
            {METHODS.filter((m) => m.question === q).map((m) => (
              <article key={m.id} id={m.id} className="method-card" data-testid={`method-${m.id}`}>
                <header>
                  <h3>
                    <span className="mono mid">{m.id}</span> {m.name[lang]}
                  </h3>
                  <span className={`lane lane-${m.lane}`}>{t(`methods.lanes.${m.lane}`)}</span>
                </header>
                <p>{m.summary[lang]}</p>
                {m.equations.map((e, i) => (
                  <div key={i} className="eq">
                    <Tex tex={e.tex} display />
                    {e.label && <span className="small faint">{e.label[lang]}</span>}
                  </div>
                ))}
                <p className="small">
                  <strong>{t('methods.where')}:</strong> {m.where[lang]}
                </p>
                <details>
                  <summary>{t('methods.sources')} ({m.sources.length})</summary>
                  <ul className="sources small">
                    {m.sources.map((s, i) => (
                      <li key={i}>
                        {s.text}
                        {s.doi && (
                          <>
                            {' '}
                            <a href={`https://doi.org/${s.doi}`} target="_blank" rel="noreferrer" className="mono">
                              doi:{s.doi}
                            </a>
                          </>
                        )}
                        {s.url && (
                          <>
                            {' '}
                            <a href={s.url} target="_blank" rel="noreferrer">
                              {s.url.replace('https://', '')}
                            </a>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
                <ul className="caveats small">
                  {m.caveats[lang].map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
                <a className="small doc-link" href={docUrl(m)} target="_blank" rel="noreferrer">
                  {t('methods.wiki')} <ExternalLink size={12} />
                </a>
              </article>
            ))}
          </section>
        ))}

        <section className="question" id="benchmark">
          <h2>{t('methods.benchmark.title')}</h2>
          <p>{t('methods.benchmark.text')}</p>
          {bench ? (
            <>
              <p className="small muted">
                {t('methods.benchmark.generated')} {bench.generated} / {t('methods.benchmark.engine')} {bench.engine_version} / {bench.metrics}
              </p>
              {Object.entries(bench.splits).map(([split, s]) => (
                <div key={split} className="bench-split">
                  <h3>
                    {t(`methods.benchmark.splits.${split}`, split)} <span className="mono faint">({s.n_tiles} {t('instrument.tiles')})</span>
                  </h3>
                  <div className="table-wrap">
                    <table data-testid={`benchmark-${split}`}>
                      <thead>
                        <tr>
                          <th>{t('methods.benchmark.method')}</th>
                          <th>IoU</th>
                          <th>F1</th>
                          <th>{t('methods.benchmark.precision')}</th>
                          <th>{t('methods.benchmark.recall')}</th>
                          <th>{t('methods.benchmark.perTile')}</th>
                          <th>{t('methods.benchmark.boundary')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(s.methods).map(([k, v]) => (
                          <tr key={k}>
                            <td>{t(`methods.benchmark.methods.${k}`, k)}</td>
                            <td className="mono">{v.pooled.iou.toFixed(3)}</td>
                            <td className="mono">{v.pooled.f1.toFixed(3)}</td>
                            <td className="mono">{v.pooled.precision.toFixed(3)}</td>
                            <td className="mono">{v.pooled.recall.toFixed(3)}</td>
                            <td className="mono">{Number.isFinite(v.per_tile_mean_iou) ? v.per_tile_mean_iou.toFixed(3) : '-'}</td>
                            <td className="mono">{Number.isFinite(v.boundary_f1_mean) ? v.boundary_f1_mean.toFixed(3) : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {s.haze && (s.haze.rf || s.haze.unet) && (
                    <p className="small muted">
                      {t('methods.benchmark.haze')}:{' '}
                      {Object.entries(s.haze)
                        .filter(([, d]) => d && Object.keys(d).length)
                        .map(([k, d]) => `${k} ${Object.entries(d).map(([h, v]) => `+${h}: ${v.iou.toFixed(2)}`).join(', ')}`)
                        .join(' / ')}
                    </p>
                  )}
                </div>
              ))}
            </>
          ) : (
            <p className="small muted" data-testid="benchmark-missing">
              {models.status === 'loading' ? t('common.loading') : t('methods.benchmark.missing')}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
