import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '../../i18n';

/** Header language dropdown (react-i18next). */
export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  // Blank when the resolved language is not one of the options, which is what
  // the closed select shows in that state too (no option matches, nothing is
  // selected). `resolve.test.ts` pins the widening that keeps it from happening.
  const selected = LANGUAGES.find((l) => l.code === i18n.resolvedLanguage)?.name ?? '';
  return (
    // A native select is as wide as its widest option rather than its selected
    // one, so 'Português (Portugal)' would set this control's width in every
    // language: 161px of header spent to show the word 'Español'. The header has
    // no such width to spare: with the workbench tabs in the row it wraps to a
    // second line on a system font wider than the one it was measured against.
    //
    // So the width comes from an invisible sizer holding the selected name, with
    // the select laid over it. It is still one real <select> carrying the full
    // names, and the open dropdown is as wide as the browser wants; only the
    // closed width follows the sizer. The sizer must keep the select's own text
    // metrics (text-xs, font-medium) and padding, or the name it sizes for is
    // not the width the name needs.
    //
    // The cap is what the sizer cannot do on its own: it holds the name that is
    // itself the longest, which is the case the header has least room for, since
    // 'Português (Portugal)' comes with the longest translation of the
    // pre-release word beside it. It applies at every width, and below sm it
    // also guards the narrowest case: uncapped, that name puts the action group
    // 2px past a 320px viewport and makes the whole document scroll sideways
    // (see e2e/layout-overflow.spec.ts
    // for what that costs the bottom tab bar). Capped, the closed select
    // truncates and the two Portuguese entries still read apart
    // ('Português (Bra...' / 'Português (Por...'), while the open dropdown shows
    // every name in full.
    <span className="relative inline-flex max-w-24 items-center xl:max-w-28">
      {/* `invisible` rather than hidden: visibility:hidden keeps the box, which is
          the whole point of this span. py-1.5 is the control's height, since the
          select is out of flow and this is the only thing giving the wrapper a box,
          and pr-7 is the room the chevron below is drawn in. */}
      <span aria-hidden className="invisible truncate py-1.5 pr-7 pl-2 text-xs font-medium">
        {selected}
      </span>
      <select
        value={i18n.resolvedLanguage}
        onChange={(e) => i18n.changeLanguage(e.target.value)}
        aria-label={t('lang.label')}
        title={t('lang.label')}
        className="absolute inset-0 h-full w-full appearance-none truncate rounded-lg bg-raised pr-7 pl-2 text-xs font-medium text-ink ring-1 ring-line/10 focus:ring-accent-500 focus:outline-none"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}
          </option>
        ))}
      </select>
      {/* Our own chevron, because `appearance-none` is what makes the sizer above
          honest: a select left to its native appearance lays its arrow out inside
          the content box, on top of the padding, so the name is squeezed into
          whatever is left and 'English' closes as 'E...'. Drawn in the pr-7 both
          boxes reserve, and never a click target of its own. */}
      <svg
        aria-hidden
        viewBox="0 0 10 6"
        className="pointer-events-none absolute right-2.5 h-1.5 w-2.5 fill-none stroke-ink-muted stroke-2"
      >
        <path d="M1 1l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
