import { useTranslation } from 'react-i18next';

import { APP_VERSION } from '../lib/version';

export function AboutPage() {
  const { t } = useTranslation();
  return (
    <div className="page">
      <div className="inner">
        <h1>{t('about.title')}</h1>
        <p className="lede">{t('about.lede')}</p>
        <p>
          {t('footer.developed')} <span className="dot">&middot;</span> {t('footer.version')} <span className="mono">{APP_VERSION}</span>
        </p>
        <p>{t('footer.honest')}</p>
      </div>
    </div>
  );
}
