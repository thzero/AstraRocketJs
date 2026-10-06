import { useTranslation } from 'react-i18next';

/**
 * Open-Meteo's credit and license. CC BY 4.0 asks for the credit wherever the
 * data is shown, so every view that shows a value from it renders this one line,
 * and a change to the license text cannot miss a copy.
 */
export function OpenMeteoCredit({ className = 'text-[11px] text-slate-500' }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <p className={className}>
      <a className="text-sky-400 hover:underline" href="https://open-meteo.com/" target="_blank" rel="noreferrer">
        {t('weather.credit')}
      </a>
      {' · '}
      <a
        className="text-sky-400 hover:underline"
        href="https://creativecommons.org/licenses/by/4.0/"
        target="_blank"
        rel="noreferrer"
      >
        CC BY 4.0
      </a>
    </p>
  );
}
