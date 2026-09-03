import { useTranslation } from 'react-i18next';

const KEYS = ['sentinel', 'landsat', 'terrain', 'copdem', 'srtm', 'polygons', 'eox', 'ofm'] as const;

export function DataPage() {
  const { t } = useTranslation();
  return (
    <div className="page">
      <div className="inner">
        <h1>{t('data.title')}</h1>
        <p className="lede">{t('data.lede')}</p>
        <table data-testid="attribution-table">
          <tbody>
            {KEYS.map((k) => (
              <tr key={k}>
                <td>{t(`attribution.${k}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
