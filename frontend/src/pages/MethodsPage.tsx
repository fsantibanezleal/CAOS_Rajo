import { useTranslation } from 'react-i18next';

export function MethodsPage() {
  const { t } = useTranslation();
  return (
    <div className="page">
      <div className="inner">
        <h1>{t('methods.title')}</h1>
        <p className="lede">{t('methods.lede')}</p>
      </div>
    </div>
  );
}
