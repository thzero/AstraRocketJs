import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import es from './locales/es.json';

// English is the source-of-truth locale and every other locale falls back to it
// for a missing key (see i18n/index.ts). That fallback is silent: a key dropped
// from a translation shows up as English in a Spanish UI rather than as an error,
// which is exactly the kind of drift nobody notices. These tests make it loud.

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

const EN = flatten(en as Tree);
const LOCALES: [string, Record<string, string>][] = [['es', flatten(es as Tree)]];

describe.each(LOCALES)('%s locale', (_name, L) => {
  it('translates every English key (a gap silently renders as English)', () => {
    expect(Object.keys(EN).filter((k) => !(k in L))).toEqual([]);
  });

  it('has no keys English has dropped (dead strings nothing can reach)', () => {
    expect(Object.keys(L).filter((k) => !(k in EN))).toEqual([]);
  });

  it('uses the same interpolation placeholders as English', () => {
    // A placeholder present here but not in English renders literally as
    // "{{name}}" when the caller does not pass it; one missing here quietly drops
    // a value the English string shows.
    const mismatched = Object.keys(EN)
      .filter((k) => k in L)
      .filter((k) => placeholders(EN[k]!).join(',') !== placeholders(L[k]!).join(','))
      .map((k) => `${k}: en=[${placeholders(EN[k]!)}] vs [${placeholders(L[k]!)}]`);
    expect(mismatched).toEqual([]);
  });

  it('has no empty or whitespace-only translations', () => {
    expect(
      Object.entries(L)
        .filter(([, v]) => v.trim() === '')
        .map(([k]) => k),
    ).toEqual([]);
  });
});
