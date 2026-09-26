import { describe, it, expect } from 'vitest';
import en from '../../src/i18n/locales/en.json';
import es from '../../src/i18n/locales/es.json';
import { DEFAULT_CSV_COLUMNS, flightColumns } from '../../src/services/flightColumns';
import type { FlightResult } from '../../src/engine/openRocketEngine';

/** A result carrying exactly these series keys. */
const withKeys = (keys: string[]) =>
  ({ series: Object.fromEntries(keys.map((k) => [k, [0, 1]])) }) as unknown as FlightResult;

const strings = (locale: Record<string, unknown>, ns: string) => (locale[ns] ?? {}) as Record<string, string>;

describe('flightColumns', () => {
  it('lists only what the run recorded', () => {
    // Offering a column the file cannot fill would be a menu of empty promises.
    expect(flightColumns(withKeys(['time', 'altitude'])).map((c) => c.key)).toEqual(['time', 'altitude']);
  });

  it('puts the named series first, in reading order', () => {
    const cols = flightColumns(withKeys(['Cd', 'altitude', 'time']));
    expect(cols.map((c) => c.key)).toEqual(['time', 'altitude', 'Cd']);
  });

  it('reads a staged flight from the branch it was asked for', () => {
    const r = {
      series: { time: [0] },
      branches: [{ series: { time: [0], altitude: [1] } }, { series: { time: [0], Cd: [1] } }],
    } as unknown as FlightResult;
    expect(flightColumns(r, 1).map((c) => c.key)).toEqual(['time', 'Cd']);
  });

  /**
   * The horizontal track has to be in the DEFAULT set: it is the only thing in
   * the file that answers "where does it land", and it is why the columns were
   * added in the first place.
   */
  it('exports the ground track by default', () => {
    for (const k of ['Px', 'Py']) expect(DEFAULT_CSV_COLUMNS).toContain(k);
  });

  /**
   * Every variable carries a NAME, in both languages.
   *
   * The dialog used to show bare kernel symbols — "Abx", "dΦ", "ha" — for
   * everything beyond the app's own dozen, which is unreadable unless you
   * already know the symbol table. The names are generated from OpenRocket's
   * own `FlightDataType` and its message bundles, so a variable reads the same
   * here as it does in the desktop app; this catches a symbol that slipped
   * through without one.
   */
  it('names every column it can offer, in English and Spanish', () => {
    // A result carrying every key the table knows about.
    const all = flightColumns(withKeys(DEFAULT_CSV_COLUMNS.concat(['ha', 'Vz', 'Abx', 'dΦ', 'Cdf', 'ρ', 'tc'])));
    expect(all.length).toBeGreaterThan(15);
    for (const c of all) {
      expect(c.labelKey, `${c.key} has no label key`).toBeTruthy();
      const [ns, key] = c.labelKey!.split('.');
      expect(strings(en, ns!)[key!], `en is missing ${c.labelKey}`).toBeTruthy();
      expect(strings(es, ns!)[key!], `es is missing ${c.labelKey}`).toBeTruthy();
    }
  });

  it('gives every column a unit or an explicit blank, never undefined both ways', () => {
    // Mach and the coefficients are genuinely unitless; a missing unit AND a
    // missing quantity would render as the string "undefined".
    for (const c of flightColumns(withKeys(['time', 'Cd', 'M', 'Px', 'ρ']))) {
      expect(c.quantity ?? c.unit, `${c.key} has neither`).toBeDefined();
    }
  });
});
