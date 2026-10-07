import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import { readFileSync } from 'node:fs';

// The app version, read from the app itself. The old wiki needed a script to
// stamp this into Markdown; here the config can just read it.
const { version } = JSON.parse(readFileSync(new URL('../web/package.json', import.meta.url), 'utf-8'));

// WHICH OpenRocket the engine is, read the same way from the one file that
// names it: engine-java/extract/UPSTREAM. "The same physics core" is not a
// checkable claim on its own - a reader comparing their numbers against the
// desktop app's, or asking whether a feature from some release is in here,
// needs the commit - so Overview states it, through <UpstreamPin /> (see
// src/components/UpstreamPin.tsx), which reads what this puts in customFields.
//
// Read at build time, in every locale, rather than written into the Markdown:
// a version string typed into a page is a copy of a SHA, and a copy of a SHA is
// the thing that goes stale without anyone noticing. Bumping UPSTREAM moves
// this page, the Spanish one, and the app's About dialog together.
//
// `key = value` lines, below a header in which every line is a `#` comment.
const pinFile = (path: string) => {
  const fields = new Map(
    readFileSync(new URL(path, import.meta.url), 'utf-8')
      .split('\n')
      .map((line) => /^(\w+)\s*=\s*(\S+)/.exec(line))
      .filter((m) => m !== null)
      .map((m) => [m[1]!, m[2]!] as const),
  );
  return (key: string): string => {
    const value = fields.get(key);
    if (!value) throw new Error(`${path} has no \`${key}\` line`);
    return value;
  };
};

const upstreamField = pinFile('../engine-java/extract/UPSTREAM');
const upstreamRef = upstreamField('ref');
const upstream = {
  ref: upstreamRef,
  // Nine hex - how this repo writes a short OpenRocket SHA everywhere else.
  shortRef: upstreamRef.slice(0, 9),
  date: upstreamField('date'),
  commitUrl: `${upstreamField('repo').replace(/\.git$/, '')}/commit/${upstreamRef}`,
};

// The docs site. Built separately from the app and copied into web/dist/docs by
// the Pages deploy, so both live on the one GitHub Pages site:
//   /AstraRocketJs/        the app
//   /AstraRocketJs/docs/   these docs (…/docs/es/ for Spanish)
const config: Config = {
  title: 'AstraRocketJs',
  tagline: 'Design and simulate model rockets in your browser',
  favicon: 'img/favicon.ico',

  url: 'https://thzero.github.io',
  // Set by the Pages deploy (DOCS_BASE_URL=/AstraRocketJs/docs/), mirroring how
  // the app takes PAGES_BASE. Defaults to "/" so `start`, `build` and `serve`
  // all agree locally.
  //
  // NOT derived from NODE_ENV: `docusaurus serve` re-evaluates this config with
  // NODE_ENV=development, so a dev/prod branch here would serve the built site
  // at "/" while its HTML still pointed at the subpath — every link 404s.
  baseUrl: process.env.DOCS_BASE_URL || '/',
  organizationName: 'thzero',
  projectName: 'AstraRocketJs',

  // Read by <UpstreamPin /> and <AppVersion />, which Overview and the
  // comparison appendices render in both locales.
  customFields: { upstream, appVersion: version },

  // A broken internal link should fail the build, not ship — the old wiki had no
  // such check, which is how stale page references survived.
  // Emit /faq/ rather than /faq, so every page is a directory with its own
  // index.html. That file name is what makes Help work offline: the app's Help
  // dialog asks for `docs/faq/index.html`, which is exactly the key the service
  // worker precaches the page under, so a page opens at a launch site with no
  // signal even if nobody read it first.
  //
  // NAVIGATING to /faq/ is a different request and does not hit the precache:
  // `directoryIndex` is switched off in web/vite.config.ts (it was also
  // answering the app's own root from the precache, which kept a reload from
  // ever showing a new deploy), so Workbox never maps the trailing slash onto
  // index.html. A runtimeCaching rule there covers that path for pages already
  // visited.
  trailingSlash: true,
  onBrokenLinks: 'throw',
  markdown: { hooks: { onBrokenMarkdownLinks: 'throw' } },

  // Untranslated Spanish pages fall back to English rather than 404ing, which is
  // the whole reason for moving off the wiki.
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'es'],
    localeConfigs: {
      en: { label: 'English' },
      es: { label: 'Español' },
    },
  },

  /**
   * Offline, self-hosted search for the PUBLISHED site.
   *
   * Algolia DocSearch is the usual answer and is out: it is a network service,
   * and this documentation ships inside an offline-first app. This plugin builds
   * a lunr index at build time and serves it from our own origin, so the site
   * searches with no network and nothing leaves the reader's browser.
   *
   * It puts its search box in the NAVBAR, which `src/css/custom.css` hides when a
   * page is embedded in the app's Help dialog (a second set of site navigation
   * inside the dialog is worse than none). So this serves people reading the site
   * in a browser; the Help dialog has its own search over the same pages.
   */
  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        // Both locales get their own index: a Spanish reader searching Spanish
        // pages against an English index finds nothing.
        language: ['en', 'es'],
        /*
         * Stamp the index request with a hash of the sources it was built from,
         * so a deploy cannot serve a new site against a cached old index. The
         * index keeps its plain name and the hash rides as `?_=<md5>`, which is
         * what `true` means here; `'filename'` would hash the NAME instead, and
         * that is deliberately not used: the published site replaces its files,
         * so a tab still holding the previous build would ask for a name that no
         * longer exists and its search would 404 rather than answer from the
         * current index.
         */
        hashed: true,
        /*
         * WHAT THE HASH IS TAKEN OVER, and the only thing `docsDir` is used for
         * in this plugin. It defaults to `docs`, which is the ENGLISH sources
         * alone, so a Spanish-only change left the hash where it was and a reader
         * holding a cached Spanish index kept it. Both locales' indexes are
         * rebuilt on every deploy, so what the hash has to cover is every source
         * either of them is built from.
         */
        docsDir: ['docs', 'i18n'],
        indexDocs: true,
        // No blog, and the docs ARE the site (`routeBasePath: '/'`), so there are
        // no standalone pages to index either.
        indexBlog: false,
        indexPages: false,
        docsRouteBasePath: '/',
        highlightSearchTermsOnTargetPage: true,
      },
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/', // docs ARE the site; no separate landing page
          editUrl: 'https://github.com/thzero/AstraRocketJs/tree/master/website/',
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: { defaultMode: 'dark', respectPrefersColorScheme: true },
    navbar: {
      title: 'AstraRocketJs',
      items: [
        { type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Documentation' },
        { href: 'https://thzero.github.io/AstraRocketJs/', label: 'Launch the app', position: 'right' },
        { type: 'localeDropdown', position: 'right' },
        { href: 'https://github.com/thzero/AstraRocketJs', label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      style: 'dark',
      copyright:
        `Documentation for AstraRocketJs v${version}. ` +
        'AstraRocketJs runs OpenRocket’s own engine. Not affiliated with the OpenRocket project. ' +
        'See the <a href="https://openrocket.readthedocs.io">OpenRocket documentation</a> for the underlying physics.',
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
