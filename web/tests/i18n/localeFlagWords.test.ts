import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import en from '../../src/i18n/locales/en.json';
import de from '../../src/i18n/locales/de.json';
import es from '../../src/i18n/locales/es.json';
import fr from '../../src/i18n/locales/fr.json';
import ptBR from '../../src/i18n/locales/pt-BR.json';
import ptPT from '../../src/i18n/locales/pt-PT.json';
import nl from '../../src/i18n/locales/nl.json';
import pl from '../../src/i18n/locales/pl.json';
import ru from '../../src/i18n/locales/ru.json';
import ja from '../../src/i18n/locales/ja.json';

/**
 * No British spelling in any locale's user-visible text.
 *
 * `cspell.json` holds the forbidden list and the spell gate applies it, but its
 * `files` is an ALLOWLIST whose only locale entry is `en.json`. So the nine
 * translated files, which are all user-visible UI text, sat outside it: a
 * British spelling, or an untranslated English leftover carrying one, passed
 * every gate. Demonstrated during the audit by planting one in `es.json` and
 * watching `npm run spell` report 671 files and 0 issues.
 *
 * Checked HERE rather than by widening cspell's `files`, because cspell cannot
 * do it. Spell-checking a translation needs that language's dictionary, and the
 * `cspell` package bundles none of the nine (its `dict-java`, `dict-ruby` and
 * `dict-rust` are programming languages). Pointing it at `es.json` would flag
 * every Spanish word. The forbidden-word half needs no dictionary at all, and
 * it is the half that matters: the list is entirely British forms.
 *
 * The list is read FROM `cspell.json` rather than copied, so the two cannot
 * drift: add a word there and it is enforced in all ten locales at once.
 */

/** Words on the list that are native to a given language, not British leaks. */
const NATIVE: Record<string, readonly string[]> = {
  // All six are ordinary French.
  fr: ['analyse', 'catalogue', 'catalogues', 'centre', 'fibre', 'stabiliser'],
  // `Analyse` is a German noun.
  de: ['analyse'],
  // ...and a Dutch one.
  nl: ['analyse'],
};

const LOCALES = { en, de, es, fr, 'pt-BR': ptBR, 'pt-PT': ptPT, nl, pl, ru, ja } as const;

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
    // Keeps NATIVE honest: an entry for a word nobody forbids is dead weight
    // that reads as a sanctioned exception.
    const forbidden = new Set(flagWords.map((w) => w.toLowerCase()));
    for (const [locale, words] of Object.entries(NATIVE)) {
      for (const w of words) expect(forbidden, `${locale}: ${w}`).toContain(w);
    }
  });
});
