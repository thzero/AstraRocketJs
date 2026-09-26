import { describe, it, expect } from 'vitest';
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

// English is the source-of-truth locale and every other locale falls back to it
// for a missing key (see i18n/index.ts). That fallback is silent: a key dropped
// from a translation shows up as English in a Spanish UI rather than as an error,
// which is exactly the kind of drift nobody notices. These tests make it loud.
//
// "Every English key" is the rule for ordinary keys, but NOT for a plural family.
// i18next picks the suffix with `Intl.PluralRules`, so the set of forms a locale
// needs is a fact about that locale, not about English:
//
//   en, de, nl  one, other
//   es, fr, pt  one, many, other
//   ja          other
//   ru, pl      one, few, many, other
//
// Checking those against English's two suffixes fails both ways round. It demands
// `_one` from Japanese, which never selects it, and it rejects the `_few` that
// Russian cannot work without. The gap is not theoretical: a category the locale
// declares but the file omits does not degrade to that locale's `_other`, it
// falls through to ENGLISH, so `t('sweep.flights', { count: 3 })` renders
// "3 flights" inside an otherwise Russian UI. So each locale is held to its own
// categories, which is also what caught `_many` missing from Spanish, French and
// both Portuguese files.

type Tree = { [k: string]: string | Tree };

/** `{ a: { b: 'x' } }` → `{ 'a.b': 'x' }`. */
function flatten(node: Tree, prefix = '', out: Record<string, string> = {}) {
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else flatten(v, key, out);
  }
  return out;
}

/** The interpolation placeholders a string uses, normalized for comparison. */
const placeholders = (s: string) => [...s.matchAll(/{{\s*([^}]+?)\s*}}/g)].map((m) => m[1]!).sort();

/** i18next's plural suffix, which is a CLDR category name. */
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

const EN = flatten(en as Tree);

/** A plural family's base key: `sim.skipping`, from `sim.skipping_one`. */
const base = (key: string) => key.replace(PLURAL_SUFFIX, '');

/** Every plural family English declares, by base key. */
const FAMILIES = [
  ...new Set(
    Object.keys(EN)
      .filter((k) => PLURAL_SUFFIX.test(k))
      .map(base),
  ),
].sort();

/** Keys that are one string, not a family of forms. */
const SINGULAR = Object.keys(EN).filter((k) => !PLURAL_SUFFIX.test(k));

/** The categories `Intl.PluralRules` says this locale selects between. */
const categories = (locale: string) => new Intl.PluralRules(locale).resolvedOptions().pluralCategories;

/** Exactly the keys a locale needs: every singular, and every family spelled out
 *  in that locale's own categories. */
function required(locale: string): string[] {
  const cats = categories(locale);
  return [...SINGULAR, ...FAMILIES.flatMap((b) => cats.map((c) => `${b}_${c}`))];
}

/** The English string a key is measured against. A form English does not spell
 *  (`_few`) is compared to the family's `_other`, which carries the same values. */
const enFor = (key: string) => EN[key] ?? EN[`${base(key)}_other`];

const LOCALES: [string, Record<string, string>][] = [
  // English is in here too: it is the reference for WHICH keys exist, but it has
  // no standing over its own plural forms, and a stray `skipping_few` added to
  // it would otherwise go unnoticed.
  ['en', EN],
  ['de', flatten(de as Tree)],
  ['es', flatten(es as Tree)],
  ['fr', flatten(fr as Tree)],
  ['pt-BR', flatten(ptBR as Tree)],
  ['pt-PT', flatten(ptPT as Tree)],
  ['nl', flatten(nl as Tree)],
  ['pl', flatten(pl as Tree)],
  ['ru', flatten(ru as Tree)],
  ['ja', flatten(ja as Tree)],
];

describe('plural families', () => {
  it('has some, or every plural assertion below is passing on an empty list', () => {
    expect(FAMILIES.length).toBeGreaterThan(5);
  });

  it('never leaves a family base as a bare key too', () => {
    // `banner.notes` alongside `banner.notes_other` worked, because i18next
    // falls back to the bare key when `_one` is absent, but it hid the family
    // from anything counting forms. One spelling only.
    expect(FAMILIES.filter((b) => b in EN)).toEqual([]);
  });
});

describe.each(LOCALES)('%s locale', (name, L) => {
  it('has every key it needs (a gap silently renders as English)', () => {
    expect(required(name).filter((k) => !(k in L))).toEqual([]);
  });

  it('has no key it cannot reach (dead strings nothing selects)', () => {
    const allowed = new Set(required(name));
    expect(Object.keys(L).filter((k) => !allowed.has(k))).toEqual([]);
  });

  it('uses the same interpolation placeholders as English', () => {
    // A placeholder present here but not in English renders literally as
    // "{{name}}" when the caller does not pass it; one missing here quietly drops
    // a value the English string shows.
    const mismatched = Object.keys(L)
      .filter((k) => enFor(k) !== undefined)
      .filter((k) => placeholders(enFor(k)!).join(',') !== placeholders(L[k]!).join(','))
      .map((k) => `${k}: en=[${placeholders(enFor(k)!)}] vs [${placeholders(L[k]!)}]`);
    expect(mismatched).toEqual([]);
  });

  it('interpolates {{count}} in every plural form', () => {
    // A plural form must never spell its number out. English's `_one` only ever
    // means exactly 1, so "Reset 1 field" read fine and every translation copied
    // it — but Russian's `one` also covers 21, 31 and 101, where that string
    // says "1". The count is the one thing a plural form is selected BY, so it
    // has to come from the interpolation.
    expect(
      Object.entries(L)
        .filter(([k, v]) => PLURAL_SUFFIX.test(k) && !v.includes('{{count}}'))
        .map(([k]) => k),
    ).toEqual([]);
  });

  it('has no empty or whitespace-only translations', () => {
    expect(
      Object.entries(L)
        .filter(([, v]) => v.trim() === '')
        .map(([k]) => k),
    ).toEqual([]);
  });
});
