import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '../../i18n';

/** Header language dropdown (react-i18next). */
export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  return (
    <select
      value={i18n.resolvedLanguage}
      onChange={(e) => i18n.changeLanguage(e.target.value)}
      aria-label={t('lang.label')}
      title={t('lang.label')}
      className="rounded-lg bg-slate-800 px-2 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
    >
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.name}
        </option>
      ))}
    </select>
  );
}
