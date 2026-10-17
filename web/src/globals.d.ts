/** Injected by Vite's `define` from package.json (see vite.config.ts). */
declare const __APP_VERSION__: string;
/** The release channel: '' for production, 'beta' for the beta site (vite.config.ts). */
declare const __APP_CHANNEL__: '' | 'beta';
/** Help/docs URL: the HELP_URL build override, else package.json `wiki.url`, else repository + "/wiki" (vite.config.ts). */
declare const __HELP_URL__: string;
/** Contributors page: the CONTRIBUTORS_URL override, else package.json `contributorsPage.url`, else repository + "/graphs/contributors"; '' hides the link. */
declare const __CONTRIBUTORS_URL__: string;
/**
 * The OpenRocket commit the bundled engine was extracted from, read at build
 * time from engine-java/extract/UPSTREAM (see vite.config.ts). Shown in the
 * About dialog so "the same physics core" names a checkable commit.
 */
declare const __UPSTREAM__: { ref: string; shortRef: string; date: string; commitUrl: string };
