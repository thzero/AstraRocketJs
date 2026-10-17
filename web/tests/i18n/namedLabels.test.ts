import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Text that names something on screen uses the name the screen shows, in every
 * locale: a note that explains a menu option by another name, or docs that send
 * the reader to a dialog under a title it does not have, cannot be followed.
 */

const dir = join(__dirname, '../../src/i18n/locales');
const locales = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: f, json: JSON.parse(readFileSync(join(dir, f), 'utf8')) }));
const website = join(__dirname, '../../../website');

describe.each(locales)('$file', ({ json }) => {
  it('explains each table shading option by the name its menu shows', () => {
    const { aeroHeatNote, aeroHeatSky, aeroHeatOr } = json.settings as Record<string, string>;
    const note = aeroHeatNote!.toLowerCase();
    expect(note).toContain(aeroHeatSky!.toLowerCase());
    expect(note).toContain(aeroHeatOr!.toLowerCase());
  });

  it('titles the report dialog by the report it makes, as English does', () => {
    const english = locales.find((l) => l.file === 'en.json')!.json.export;
    expect(english.title).toBe(english.designReport);
    expect(json.export.title).toBe(json.export.designReport);
  });

  it('says the engine is compiled to WASM and JavaScript', () => {
    for (const text of [json.about.body, json.about.credits] as string[]) {
      expect(text).toMatch(/WASM/);
      expect(text).toMatch(/JavaScript/);
    }
  });
});

describe('the docs name the design report dialog by its title', () => {
  it.each([
    ['en', join(website, 'docs/files-and-exports.md')],
    ['es', join(website, 'i18n/es/docusaurus-plugin-content-docs/current/files-and-exports.md')],
  ])('%s', (locale, page) => {
    const title = locales.find((l) => l.file === `${locale}.json`)!.json.export.title as string;
    const doc = readFileSync(page, 'utf8');
    // The section's first paragraph: the heading is the one titled "(PDF / CSV)" in both.
    const at = doc.search(/^## .*\(PDF \/ CSV\)/m);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(doc.slice(at).split(/\r?\n\r?\n/)[1]).toContain(`**${title}**`);
  });
});

describe('the glossary names each plotted symbol as the app labels it', () => {
  it.each([
    ['en', join(website, 'docs/glossary.md')],
    ['es', join(website, 'i18n/es/docusaurus-plugin-content-docs/current/glossary.md')],
  ])('%s', (locale, page) => {
    const names = locales.find((l) => l.file === `${locale}.json`)!.json.flightVar as Record<string, string>;
    const doc = readFileSync(page, 'utf8');
    const rows = [...doc.matchAll(/^\| `([^`]+)` \| (.+) \|$/gm)].filter((m) => m[1]! in names);
    expect(rows.length).toBeGreaterThan(30);
    for (const [, symbol, name] of rows) expect([symbol, name]).toEqual([symbol, names[symbol!]]);
  });
});
