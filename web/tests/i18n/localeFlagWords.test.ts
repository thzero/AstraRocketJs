import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import i18n, { LANGUAGES } from '../../src/i18n';

/**
 * No British spelling in any locale's user-visible text.
 *
 * `cspell.json` holds the forbidden list and the spell gate applies it, but its
 * `files` is an allowlist whose only locale entry is `en.json`. The nine
 * translated files, which are all user-visible UI text, sit outside it, so a
 * British spelling (or an untranslated English leftover carrying one) in them
 * would pass the spell gate.
 *
 * Checked here rather than by widening cspell's `files`, because cspell cannot
 * do it. Spell-checking a translation needs that language's dictionary, and the
 * `cspell` package bundles none of the nine. Pointing it at `es.json` would flag
 * every Spanish word. The forbidden-word half needs no dictionary at all, and
 * it is the half that matters: the list is entirely British forms.
 *
 * The list is read from `cspell.json` rather than copied, so the two cannot
 * drift: add a word there and it is enforced in every locale at once. The
 * locales are read from the app's own registry (`LANGUAGES` in
 * `src/i18n/index.ts`), so a new language is checked the day it is added.
 */

/** Words on the list that are native to a given language, not British leaks. */
const NATIVE: Record<string, readonly string[]> = {
  // All eleven are ordinary French.
  fr: [
    'analyse',
    'catalogue',
    'catalogues',
    'centre',
    'fibre',
    'fibres',
    'minimise',
    'sombre',
    'stabiliser',
    'utilise',
    'visualisation',
  ],
  // `calibre` is the Spanish word for caliber.
  es: ['calibre'],
  // `Analyse` is a German noun.
  de: ['analyse'],
  // ...and a Dutch one.
  nl: ['analyse'],
};

/** Every registered locale and the bundle the app serves for it. */
const LOCALES = Object.fromEntries(
  LANGUAGES.map(({ code }) => [code, i18n.getResourceBundle(code, 'translation') as unknown]),
);

const flagWords: string[] = (
  JSON.parse(readFileSync(fileURLToPath(new URL('../../../cspell.json', import.meta.url)), 'utf8')) as {
    flagWords: string[];
  }
).flagWords;

/** Every string value in the tree, keys excluded: keys are not shown to anyone. */
const values = (node: unknown, out: string[] = []): string[] => {
  if (typeof node === 'string') out.push(node);
  else if (node && typeof node === 'object') for (const v of Object.values(node)) values(v, out);
  return out;
};

describe('no British spelling reaches a translated string', () => {
  it('reads every registered locale from the app', () => {
    expect(Object.keys(LOCALES)).toContain('en');
    for (const [code, bundle] of Object.entries(LOCALES)) expect(bundle, code).toBeTypeOf('object');
  });

  it('reads the forbidden list out of cspell.json, so there is one copy', () => {
    expect(flagWords.length).toBeGreaterThan(50);
    expect(flagWords).toContain('colour');
    expect(flagWords).toContain('centre');
  });

  for (const [locale, bundle] of Object.entries(LOCALES)) {
    it(`${locale} carries none`, () => {
      const allowed = new Set(NATIVE[locale] ?? []);
      const forbidden = new Set(flagWords.map((w) => w.toLowerCase()));
      const hits = new Set<string>();
      for (const text of values(bundle)) {
        // Latin runs only: a word boundary is what distinguishes `centre` from
        // `centred`, and both are on the list in their own right.
        for (const word of text.match(/[A-Za-z]+/g) ?? []) {
          const w = word.toLowerCase();
          if (forbidden.has(w) && !allowed.has(w)) hits.add(w);
        }
      }
      expect([...hits].sort()).toEqual([]);
    });
  }

  it('does not allow a word that is not actually on the list', () => {
    // Keeps `NATIVE` honest: an entry for a word nobody forbids is dead weight
    // that reads as a sanctioned exception.
    const forbidden = new Set(flagWords.map((w) => w.toLowerCase()));
    for (const [locale, words] of Object.entries(NATIVE)) {
      for (const w of words) expect(forbidden, `${locale}: ${w}`).toContain(w);
    }
  });
});
