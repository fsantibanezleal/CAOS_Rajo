// The About page: what Rajo is and why, the design-build lifecycle it followed, the honesty rules every
// number obeys, versioning, licences, how to cite, and where the depth lives (the docs wiki, the
// architecture modal, the repository).
import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { APP_VERSION } from '../lib/version';

const REPO = 'https://github.com/fsantibanezleal/CAOS_Rajo';

export function AboutPage() {
  const { t } = useTranslation();
  const paragraphs = t('about.body', { returnObjects: true }) as string[];
  const rules = t('about.rules', { returnObjects: true }) as string[];
  const lifecycle = t('about.lifecycle', { returnObjects: true }) as string[];
  return (
    <div className="page about" data-testid="about-page">
      <div className="inner">
        <h1>{t('about.title')}</h1>
        <p className="lede">{t('about.lede')}</p>
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}

        <h2>{t('about.lifecycleTitle')}</h2>
        <ol>
          {lifecycle.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ol>

        <h2>{t('about.rulesTitle')}</h2>
        <ul>
          {rules.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>

        <h2>{t('about.versionTitle')}</h2>
        <p>
          {t('about.versionText')} <span className="mono">{APP_VERSION}</span>.
        </p>

        <h2>{t('about.licenceTitle')}</h2>
        <p>{t('about.licenceText')}</p>

        <h2>{t('about.citeTitle')}</h2>
        <pre className="cite mono small" data-testid="cite">
          {t('about.citeText', { version: APP_VERSION })}
        </pre>

        <h2>{t('about.depthTitle')}</h2>
        <ul>
          <li>
            <a href={`${REPO}/tree/main/docs`} target="_blank" rel="noreferrer">
              {t('about.depth.wiki')} <ExternalLink size={12} />
            </a>
          </li>
          <li>{t('about.depth.modal')}</li>
          <li>
            <a href={REPO} target="_blank" rel="noreferrer">
              {t('about.depth.repo')} <ExternalLink size={12} />
            </a>
          </li>
          <li>
            <a href={`${REPO}/blob/main/CHANGELOG.md`} target="_blank" rel="noreferrer">
              {t('about.depth.changelog')} <ExternalLink size={12} />
            </a>
          </li>
        </ul>

        <p className="small muted">
          {t('footer.developed')} <span className="dot">&middot;</span> {t('footer.project')}
        </p>
      </div>
    </div>
  );
}
