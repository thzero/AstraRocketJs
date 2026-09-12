import i18n from '../i18n';

/**
 * Single source for the app's identity:
 *  - the display NAME comes from the translated `app.title` i18n string, so it's
 *    localizable and defined in exactly one place per locale;
 *  - the VERSION comes from package.json, injected at build time by Vite
 *    (`__APP_VERSION__`, see vite.config.ts + globals.d.ts).
 *
 * Everything (UI and non-React code) should read the name/version from here
 * rather than hard-coding "AstraRocketJs" or a version literal.
 */

/** Build version from package.json (e.g. "0.1.0"). */
export const APP_VERSION: string = __APP_VERSION__;

/**
 * Help/documentation URL, injected at build time (see vite.config.ts):
 * package.json's `wiki.url`, or the `HELP_URL` build override. Read this
 * instead of hard-coding the docs link.
 */
export const HELP_URL: string = __HELP_URL__;

/**
 * The docs URL for a UI language. The docs site serves English at the root and
 * other locales under a sub-path (`/docs/es/`), and an untranslated page there
 * falls back to English rather than 404ing — so pointing a Spanish user at the
 * Spanish tree is always safe.
 *
 * Falls back to the plain help URL for a language the docs do not build, or if
 * the URL was overridden to something without a locale layout.
 */
const DOC_LOCALES = new Set(['es']);
export function helpUrlFor(language: string): string {
  const lang = (language || '').split('-')[0]!.toLowerCase();
  if (!HELP_URL || !DOC_LOCALES.has(lang)) return HELP_URL;
  return `${HELP_URL.replace(/\/*$/, '/')}${lang}/`;
}

/**
 * Where the About dialog's contributors heading links — by default the
 * repository's GitHub contributor graph, overridable at build time (see
 * vite.config.ts) via `contributorsPage.url` in package.json or the
 * `CONTRIBUTORS_URL` env var. Empty string ⇒ render the heading unlinked.
 */
export const CONTRIBUTORS_URL: string = __CONTRIBUTORS_URL__;

/**
 * True while the app is a pre-1.0 (work-in-progress) build — i.e. the version's
 * major number is 0. Gates the "work in progress" acknowledgement popup and the
 * About-dialog notice; both switch off automatically once the version hits 1.0.
 */
export const isPreRelease = (version: string = APP_VERSION): boolean => {
  const major = parseInt(version, 10);
  return Number.isFinite(major) && major < 1;
};

/** The app's display name — translated (i18next singleton; safe outside React). */
export const appName = (): string => i18n.t('app.title');

/** Default name for a new / exported design, e.g. "AstraRocketJs design" (translated). */
export const defaultDesignName = (): string => i18n.t('app.designName', { name: appName() });
