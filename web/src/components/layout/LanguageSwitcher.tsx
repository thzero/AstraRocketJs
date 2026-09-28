import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '../../i18n';

/** Header language dropdown (react-i18next). */
export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  return (
    // A native select is as wide as its WIDEST option, not its selected one,
    // so 'Português (Portugal)' sets the width in every language. Uncapped
    // that is 150px, which puts the header action group 2px past a 320px
    // viewport and makes the whole document scroll sideways - see
    // e2e/layout-overflow.spec.ts for what that costs the bottom tab bar. The
    // cap is lifted at sm, where the room exists; under it the closed select
    // truncates, and the two Portuguese entries still read apart
    // ('Português (Bra...' / 'Português (Por...') while the open dropdown
    // shows both in full.
    <select
      value={i18n.resolvedLanguage}
      onChange={(e) => i18n.changeLanguage(e.target.value)}
      aria-label={t('lang.label')}
      title={t('lang.label')}
      className="max-w-32 truncate rounded-lg bg-slate-800 px-2 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500 sm:max-w-none"
    >
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.name}
        </option>
      ))}
    </select>
  );
}
