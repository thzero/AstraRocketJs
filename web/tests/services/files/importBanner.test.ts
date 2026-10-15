// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { importNotes } from '../../../src/services/files/importBanner';
import { importNoteText, type KeyedNote } from '../../../src/services/files/importNote';
import type { LaunchConditions } from '../../../src/services/design/orkTree';
import type { PowerClass } from '../../../src/services/flight/powerClass';
import { unitSymbols } from '../../../src/prefs/units';
import { DEFAULT_SETTINGS } from '../../../src/services/storage/settings';
import i18n from '../../../src/i18n';
import en from '../../../src/i18n/locales/en.json';
import es from '../../../src/i18n/locales/es.json';

const units = unitSymbols(DEFAULT_SETTINGS.units, DEFAULT_SETTINGS.unitOverrides);
const within = { launchRodAngleDeg: 5, windAverage: 2 } as unknown as LaunchConditions;
const fly = (launch: LaunchConditions, powerClass: PowerClass = 'model') => ({ launch, powerClass });
const keyed = (n: unknown): KeyedNote => {
  expect(typeof n).toBe('object');
  return n as KeyedNote;
};

/**
 * The launch-limit notes are keyed, like every other import note, and the
 * workspace keeps them that way: a note made with the app in one language
 * renders in whichever language the banner is read in.
 */
describe('importNotes', () => {
  it("hands back the reader's notes untouched when the launch is within the codes", () => {
    const notes = ['A part was approximated.'];
    expect(importNotes(notes, [fly(within)], null, units)).toBe(notes);
  });

  it('adds a keyed note per launch condition outside the codes, after the reader notes', () => {
    const steep = { ...within, launchRodAngleDeg: 45 } as LaunchConditions;
    const out = importNotes(['A part was approximated.'], [fly(steep)], null, units);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe('A part was approximated.');
    const note = keyed(out[1]);
    expect(note.key).toBe('limits.rodAngleModel');
    expect(note.values).toEqual({ value: expect.any(String), limit: expect.any(String) });
  });

  it("names the design's launcher in the rod angle sentence, and nothing in the wind one", () => {
    const steep = { ...within, launchRodAngleDeg: 45, windAverage: 40 } as LaunchConditions;
    const rail = importNotes([], [fly(steep)], 'rail', units).map((n) => keyed(n).key);
    expect(rail).toEqual(['limits.rodAngleModel_rail', 'limits.wind']);
    const rod = importNotes([], [fly(steep, 'highPower')], 'rod', units).map((n) => keyed(n).key);
    expect(rod).toEqual(['limits.rodAngleHighPower_rod', 'limits.wind']);
  });

  it('judges the angle by the class each simulation flies, and says a shared sentence once', () => {
    const tilted = { ...within, launchRodAngleDeg: 25 } as LaunchConditions;
    expect(importNotes([], [fly(tilted)], null, units)).toEqual([]);
    const both = importNotes([], [fly(tilted), fly(tilted, 'highPower'), fly(tilted, 'highPower')], null, units);
    expect(both).toHaveLength(1);
    expect(keyed(both[0]).key).toBe('limits.rodAngleHighPower');
    const windy = { ...within, windAverage: 40 } as LaunchConditions;
    expect(importNotes([], [fly(windy), fly(windy, 'highPower')], null, units)).toHaveLength(1);
  });

  // A file's own simulations each carry their own launch, and the run gate
  // judges each; the banner has to warn about the same ones on open.
  it('judges every simulation on its own launch, not only the first', () => {
    const windy = { ...within, windAverage: 40 } as LaunchConditions;
    const out = importNotes([], [fly(within), fly(windy)], null, units);
    expect(out).toHaveLength(1);
    expect(keyed(out[0]).key).toBe('limits.wind');
  });

  it('renders in the language the banner is read in, not the one the file was opened in', async () => {
    const steep = { ...within, launchRodAngleDeg: 45 } as LaunchConditions;
    const note = keyed(importNotes([], [fly(steep)], 'rod', units)[0]);
    const figure = (name: string): string => {
      const v = note.values![name];
      return typeof v === 'string' ? v : '';
    };
    const fill = (sentence: string) =>
      sentence.replace('{{value}}', figure('value')).replace('{{limit}}', figure('limit'));
    expect(importNoteText(note, i18n.t)).toBe(fill(en.limits.rodAngleModel_rod));
    await i18n.changeLanguage('es');
    try {
      expect(importNoteText(note, i18n.t)).toBe(fill(es.limits.rodAngleModel_rod));
    } finally {
      await i18n.changeLanguage('en');
    }
    expect(fill(en.limits.rodAngleModel_rod)).not.toBe(fill(es.limits.rodAngleModel_rod));
  });
});
