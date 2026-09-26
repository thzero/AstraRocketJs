// @vitest-environment jsdom
// The detector reads localStorage and navigator on init, so this needs a DOM.
import { describe, it, expect, afterAll } from 'vitest';
import i18n, { LANGUAGES } from '../../src/i18n/index';

/**
 * Which bundle a browser's language tag lands on.
 *
 * This used to be one option (`load: 'languageOnly'`) doing one job: widen
 * es-ES / es-MX onto the 'es' bundle. Shipping pt-BR and pt-PT as separate
 * translations made that option actively wrong: it strips the region from
 * every code, so both Portuguese tags resolved to a 'pt' bundle that does not
 * exist and every Portuguese browser got English. Removing it leans on
 * i18next's own best-match instead, which widens in both directions:
 *
 *   - a region we do not ship, where we DO ship its base language, falls back
 *     to the base bundle (es-MX → es);
 *   - a bare language, where we ship only regions of it, falls forward to the
 *     first region listed in LOCALES (pt → pt-BR).
 *
 * Both halves are load-bearing and neither is obvious from the config, which is
 * why they are pinned here rather than left to be rediscovered.
 */
const CASES: [tag: string, bundle: string][] = [
  // Exact matches.
  ['en', 'en'],
  ['de', 'de'],
  ['es', 'es'],
  ['fr', 'fr'],
  ['pt-BR', 'pt-BR'],
  ['pt-PT', 'pt-PT'],
  ['nl', 'nl'],
  ['pl', 'pl'],
  ['ru', 'ru'],
  ['ja', 'ja'],
  // A region we do not ship, whose base language we do.
  ['en-GB', 'en'],
  ['de-CH', 'de'],
  ['es-ES', 'es'],
  ['es-MX', 'es'],
  ['fr-CA', 'fr'],
  ['nl-BE', 'nl'],
  ['pl-PL', 'pl'],
  ['ru-UA', 'ru'],
  ['ja-JP', 'ja'],
  // Portuguese is shipped only as regions, so a bare tag has to pick one.
  ['pt', 'pt-BR'],
  // Case is normalized before matching (?lng=pt-br is a real thing users type).
  ['pt-br', 'pt-BR'],
  // Angola and Mozambique write the European orthography, but they are not
  // shipped, and the widening picks the first pt-* row rather than the closest
  // one. Listing pt-BR first is a deliberate trade of those two against the
  // much larger pt-BR population behind a bare 'pt'.
  ['pt-AO', 'pt-BR'],
  ['pt-MZ', 'pt-BR'],
  // Nothing we ship: English, not a blank UI.
  ['zh-Hans-CN', 'en'],
  ['hu', 'en'],
];

afterAll(async () => {
  await i18n.changeLanguage('en');
});

describe('language resolution', () => {
  it.each(CASES)('%s resolves to the %s bundle', async (tag, bundle) => {
    await i18n.changeLanguage(tag);
    expect(i18n.resolvedLanguage).toBe(bundle);
  });

  it('resolves every selectable language to its own bundle', async () => {
    // The switcher sets `value` from `resolvedLanguage`, so a code that is
    // offered but resolves to something else renders as a blank <select>.
    for (const { code } of LANGUAGES) {
      await i18n.changeLanguage(code);
      expect(i18n.resolvedLanguage).toBe(code);
    }
  });
});
