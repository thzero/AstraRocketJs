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
// `extract/MMROCKET-SIM` is read the same way and for the same reason: the
// comparison appendix says which mmrocket-sim the RASAero-style extensions were
// last reviewed against, and that fact already has a home.
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

const mmrocketField = pinFile('../engine-java/extract/MMROCKET-SIM');
const mmrocketRef = mmrocketField('ref');
const mmrocket = {
  ref: mmrocketRef,
  shortRef: mmrocketRef.slice(0, 7),
  version: mmrocketField('version'),
  // Their release's own date, not the date of our review of it.
  date: mmrocketField('dated'),
  repoUrl: mmrocketField('repo').replace(/\.git$/, ''),
  commitUrl: `${mmrocketField('repo').replace(/\.git$/, '')}/commit/${mmrocketRef}`,
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

  // Read by <UpstreamPin />, <MmrocketPin /> and <AppVersion />, which Overview
  // and the comparison appendix render in both locales.
  customFields: { upstream, mmrocket, appVersion: version },

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
