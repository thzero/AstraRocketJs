/** Injected by Vite's `define` from package.json (see vite.config.ts). */
declare const __APP_VERSION__: string;
/** Help/docs URL — package.json repository + "/wiki", or the HELP_URL build override. */
declare const __HELP_URL__: string;
/** Contributors page — repository + "/graphs/contributors", or the CONTRIBUTORS_URL override; '' hides the link. */
declare const __CONTRIBUTORS_URL__: string;
/**
 * The OpenRocket commit the bundled engine was extracted from, read at build
 * time from engine-java/extract/UPSTREAM (see vite.config.ts). Shown in the
 * About dialog so "the same physics core" names a checkable commit.
 */
declare const __UPSTREAM__: { ref: string; shortRef: string; date: string; commitUrl: string };
