/**
 * The app's theme: which set of color tokens (src/index.css) is in force.
 *
 * Dark is the base the stylesheet starts from; light and daylight are the same
 * tokens with other values, chosen by `data-theme` on <html>. "Follow system"
 * resolves to light or dark from the OS preference, here rather than in a CSS
 * media query, so the stylesheet has one block per theme and the 3D views (which
 * watch the attribute) never need to know about the preference.
 */

/** What the user chose in Settings. */
export type ThemePref = 'dark' | 'light' | 'system' | 'daylight';
/** What is applied: the theme the tokens are set for. */
export type Theme = 'dark' | 'light' | 'daylight';

export const THEME_PREFS: readonly ThemePref[] = ['dark', 'light', 'system', 'daylight'];

/** A choice the daylight toggle can go back to. */
export type NonDaylightPref = Exclude<ThemePref, 'daylight'>;

/**
 * The header's daylight toggle: on, it remembers the theme it left; off, it goes
 * back to that one. Daylight chosen in Settings goes back to the remembered
 * theme too, which is dark until the toggle has been used.
 */
export function toggleDaylight(
  theme: ThemePref,
  before: NonDaylightPref,
): { theme: ThemePref; themeBeforeDaylight: NonDaylightPref } {
  return theme === 'daylight'
    ? { theme: before, themeBeforeDaylight: before }
    : { theme: 'daylight', themeBeforeDaylight: theme };
}

/** The browser chrome color per theme (the PWA title bar, the mobile address bar). */
const CHROME: Record<Theme, string> = { dark: '#0b1020', light: '#f1f5f9', daylight: '#ffffff' };

const systemDark = (): boolean =>
  typeof window === 'undefined' || !window.matchMedia
    ? true
    : window.matchMedia('(prefers-color-scheme: dark)').matches;

export function resolveTheme(pref: ThemePref): Theme {
  return pref === 'system' ? (systemDark() ? 'dark' : 'light') : pref;
}

/** Put a theme in force: the attribute the stylesheet keys on, and the browser chrome. */
export function applyTheme(pref: ThemePref): Theme {
  const theme = resolveTheme(pref);
  if (typeof document === 'undefined') return theme;
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME[theme]);
  return theme;
}

/**
 * Keep "Follow system" following: re-applies when the OS switches between light
 * and dark. Returns the unsubscribe; a no-op for any other choice.
 */
export function followSystemTheme(pref: ThemePref): () => void {
  if (pref !== 'system' || typeof window === 'undefined' || !window.matchMedia) return () => {};
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => applyTheme('system');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
