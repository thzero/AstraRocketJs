import { describe, it, expect } from 'vitest';
import { docPageFileUrl, docPageUrl, helpUrlFor, localDocsUrlFor, HELP_URL } from '../../src/services/appInfo';

/** HELP_URL may or may not carry a trailing slash; helpUrlFor normalizes it.
 *  Building the expectation the same way keeps the test honest either way. */
const localized = (lang: string) => `${HELP_URL.replace(/\/*$/, '/')}${lang}/`;

// The docs site builds a locale sub-path per language it has (/docs/es/), and an
// untranslated page there falls back to English rather than 404ing — so sending a
// Spanish user to the Spanish tree is always safe. A language the docs do NOT
// build has no sub-path at all, so it must land on English.

describe('helpUrlFor', () => {
  it('sends English to the docs root', () => {
    expect(helpUrlFor('en')).toBe(HELP_URL);
  });

  it('sends Spanish to the Spanish tree', () => {
    expect(helpUrlFor('es')).toBe(localized('es'));
  });

  it('matches on the base language, so regional variants still work', () => {
    // i18next hands us whatever the browser reports — es-MX, es-419, es-ES.
    for (const tag of ['es-MX', 'es-419', 'es-ES', 'ES']) {
      expect(helpUrlFor(tag)).toBe(localized('es'));
    }
  });

  it('falls back to English for a language the docs do not build', () => {
    // The app could gain a UI language before its docs are translated; pointing
    // at /docs/fr/ would 404, so it must not.
    for (const tag of ['fr', 'de', 'ja', 'pt-BR']) {
      expect(helpUrlFor(tag)).toBe(HELP_URL);
    }
  });

  it('falls back to English for a missing or malformed language', () => {
    expect(helpUrlFor('')).toBe(HELP_URL);
    expect(helpUrlFor('-')).toBe(HELP_URL);
  });

  it('never produces a double slash', () => {
    expect(helpUrlFor('es')).not.toMatch(/[^:]\/\//);
  });
});

// The docs serve their pages at the root (routeBasePath: '/'), so a page is the
// localized base plus a slug. The base may arrive with or without a trailing
// slash, and both must produce the same URL: without one, the slug would be
// glued onto the last path segment rather than added as its own.
describe('docPageUrl', () => {
  it('appends the page to a base that ends in a slash', () => {
    expect(docPageUrl('https://example.test/docs/', 'safety')).toBe('https://example.test/docs/safety');
  });

  it('appends the page to a base that does not', () => {
    expect(docPageUrl('https://example.test/docs', 'safety')).toBe('https://example.test/docs/safety');
  });

  it('stays inside the localized tree', () => {
    expect(docPageUrl(helpUrlFor('es'), 'safety')).toBe(`${HELP_URL.replace(/\/*$/, '/')}es/safety`);
  });

  it('leaves an empty base empty, rather than linking at the app itself', () => {
    // HELP_URL can be built out (vite.config.ts), and a bare "safety" href
    // would resolve against the app's own origin.
    expect(docPageUrl('', 'safety')).toBe('');
  });

  it('never produces a double slash', () => {
    expect(docPageUrl('https://example.test/docs//', 'safety')).toBe('https://example.test/docs/safety');
  });
});

// The docs are ALSO shipped inside the app (the deploy builds Docusaurus into
// web/public/docs before the app build), so the same slug has a second address
// on the app's own origin. That copy is the one the Help dialog reads, and the
// one that works with no network.
const appBase = import.meta.env.BASE_URL.replace(/\/*$/, '/');

describe('localDocsUrlFor', () => {
  it('points at the docs inside the app, not the docs site', () => {
    expect(localDocsUrlFor('en')).toBe(`${appBase}docs/`);
  });

  it('uses the same locale rule as the external link', () => {
    expect(localDocsUrlFor('es')).toBe(`${appBase}docs/es/`);
    expect(localDocsUrlFor('es-MX')).toBe(`${appBase}docs/es/`);
  });

  it('falls back to English for a language the docs do not build', () => {
    for (const tag of ['fr', 'ja', '', '-']) {
      expect(localDocsUrlFor(tag)).toBe(`${appBase}docs/`);
    }
  });

  it('is never empty, unlike the external base', () => {
    // helpUrlFor can be built out to ''; the app always has an origin, so Help
    // must not lose its own copy along with the outbound link.
    expect(localDocsUrlFor('en')).not.toBe('');
  });
});

// The file, not the directory. Docusaurus emits every page as <slug>/index.html
// and the service worker precaches it under exactly that name, so asking for the
// file is a cache hit and asking for the directory is not (directoryIndex is off
// in vite.config.ts). This is the whole reason Help opens offline.
describe('docPageFileUrl', () => {
  it('addresses the index.html inside the page directory', () => {
    expect(docPageFileUrl('/docs/', 'safety')).toBe('/docs/safety/index.html');
  });

  it('addresses the docs index for the empty page', () => {
    expect(docPageFileUrl('/docs/', '')).toBe('/docs/index.html');
  });

  it('adds the separator when the base lacks one', () => {
    expect(docPageFileUrl('/docs', 'safety')).toBe('/docs/safety/index.html');
  });

  it('never produces a double slash', () => {
    expect(docPageFileUrl('/docs//', 'safety')).toBe('/docs/safety/index.html');
  });

  it('stays inside the localized tree', () => {
    expect(docPageFileUrl(localDocsUrlFor('es'), 'safety')).toBe(`${appBase}docs/es/safety/index.html`);
  });

  it('leaves an empty base empty rather than pointing at the app root', () => {
    expect(docPageFileUrl('', 'safety')).toBe('');
  });
});
