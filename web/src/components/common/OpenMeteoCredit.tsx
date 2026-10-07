import { useTranslation } from 'react-i18next';

/**
 * Open-Meteo's credit and license. CC BY 4.0 asks for the credit wherever the
 * data is shown, so every view that shows a value from it renders this one line,
 * and a change to the license text cannot miss a copy.
 */
export function OpenMeteoCredit({ className = 'text-[11px] text-slate-500' }: { className?: string }) {
  const { t } = useTranslation();
  return <CcByCredit className={className} href="https://open-meteo.com/" label={t('weather.credit')} />;
}

/**
 * The place search's credit: its places come from GeoNames, under the same
 * CC BY 4.0, by way of Open-Meteo's geocoding. Here beside Open-Meteo's so the
 * license link is still written once.
 */
export function GeoNamesCredit({ className = 'text-[11px] text-slate-500' }: { className?: string }) {
  const { t } = useTranslation();
  return <CcByCredit className={className} href="https://www.geonames.org/" label={t('placeSearch.credit')} />;
}

function CcByCredit({ className, href, label }: { className: string; href: string; label: string }) {
  return (
    <p className={className}>
      <a className="text-sky-400 hover:underline" href={href} target="_blank" rel="noreferrer">
        {label}
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
