import { describe, it, expect } from 'vitest';
import { helpUrlFor, HELP_URL } from './appInfo';

/** HELP_URL may or may not carry a trailing slash; helpUrlFor normalizes it.
 *  Building the expectation the same way keeps the test honest either way. */
const localised = (lang: string) => `${HELP_URL.replace(/\/*$/, '/')}${lang}/`;

// The docs site builds a locale sub-path per language it has (/docs/es/), and an
// untranslated page there falls back to English rather than 404ing — so sending a
// Spanish user to the Spanish tree is always safe. A language the docs do NOT
// build has no sub-path at all, so it must land on English.

describe('helpUrlFor', () => {
  it('sends English to the docs root', () => {
    expect(helpUrlFor('en')).toBe(HELP_URL);
  });

  it('sends Spanish to the Spanish tree', () => {
    expect(helpUrlFor('es')).toBe(localised('es'));
  });

  it('matches on the base language, so regional variants still work', () => {
    // i18next hands us whatever the browser reports — es-MX, es-419, es-ES.
    for (const tag of ['es-MX', 'es-419', 'es-ES', 'ES']) {
      expect(helpUrlFor(tag)).toBe(localised('es'));
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
