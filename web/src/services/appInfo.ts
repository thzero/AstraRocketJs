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
export const DOC_LOCALES = new Set(['es']);
export function helpUrlFor(language: string): string {
  const lang = (language || '').split('-')[0]!.toLowerCase();
  if (!HELP_URL || !DOC_LOCALES.has(lang)) return HELP_URL;
  return `${HELP_URL.replace(/\/*$/, '/')}${lang}/`;
}

/**
 * One docs PAGE, built on a base from {@link helpUrlFor}. The docs site serves
 * its pages at the root (`routeBasePath: '/'`), so a page is the base plus its
 * slug — with the trailing slash normalized, since `HELP_URL` may or may not
 * carry one and a base without it would glue the slug onto the last path
 * segment instead of adding one.
 *
 * An empty base (the docs link was built out) stays empty rather than becoming
 * a bare slug pointing at the app's own origin.
 */
export function docPageUrl(base: string, page: string): string {
  if (!base) return base;
  return `${base.replace(/\/*$/, '/')}${page}`;
}

/**
 * The docs copied INTO the app, for a UI language.
 *
 * The deploy builds the Docusaurus site into `web/public/docs` BEFORE the app
 * build (see .github/workflows/deploy.yml), and Vite copies public/ verbatim
 * into dist, so the very pages the docs site publishes are also served from the
 * app's own origin under `import.meta.env.BASE_URL`. One source, two places it
 * is reachable from, never a hand-kept copy.
 *
 * Same locale rule as {@link helpUrlFor}: English at the root, a translated
 * locale under its sub-path, with Docusaurus falling back to English page by
 * page. Unlike helpUrlFor this is never empty, because the app always has an
 * origin even when the build has no external docs URL.
 */
export function localDocsUrlFor(language: string): string {
  const base = `${import.meta.env.BASE_URL.replace(/\/*$/, '/')}docs/`;
  const lang = (language || '').split('-')[0]!.toLowerCase();
  return DOC_LOCALES.has(lang) ? `${base}${lang}/` : base;
}

/**
 * The FILE behind a docs page: `.../docs/safety/` becomes
 * `.../docs/safety/index.html`.
 *
 * This one character of difference IS the offline story. Docusaurus emits every
 * page as a directory with an index.html inside it (`trailingSlash: true`), and
 * the service worker precaches each page under that file name. Asking for the
 * file is therefore a precache hit; asking for the directory is not, because
 * `directoryIndex` is switched off in vite.config.ts and Workbox will not try
 * the index.html form on our behalf. The Help dialog asks for the file, so it
 * opens any page with no network at all, whether or not that page was ever read
 * online.
 */
export function docPageFileUrl(base: string, page: string): string {
  const url = docPageUrl(base, page);
  return url ? `${url.replace(/\/*$/, '/')}index.html` : url;
}

/**
 * WHICH OpenRocket the bundled engine is - the pinned commit, its date, and a
 * link to it, injected at build time from `engine-java/extract/UPSTREAM` (see
 * vite.config.ts). That file is the only place the ref is written down; this is
 * derived from it at every build, so the About dialog cannot come to name a
 * commit the engine was not built from.
 *
 * "The same physics core as OpenRocket" is not an answerable claim on its own:
 * a reader comparing their numbers against the desktop app's, or asking whether
 * a feature from some release is in here, needs the commit. `date` is the
 * commit's own date (UTC), not the build's.
 */
export const UPSTREAM: { ref: string; shortRef: string; date: string; commitUrl: string } = __UPSTREAM__;

/**
 * Where the About dialog's contributors heading links — by default the
 * repository's GitHub contributor graph, overridable at build time (see
 * vite.config.ts) via `contributorsPage.url` in package.json or the
 * `CONTRIBUTORS_URL` env var. Empty string ⇒ render the heading unlinked.
 */
export const CONTRIBUTORS_URL: string = __CONTRIBUTORS_URL__;

/**
 * True while the app is a pre-1.0 (work-in-progress) build — i.e. the version's
 * major number is 0. Gates the "work in progress" acknowledgment popup and the
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
