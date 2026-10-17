import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import en from '../../../src/i18n/locales/en.json';
import es from '../../../src/i18n/locales/es.json';
import { DEFAULT_CSV_COLUMNS, flightBranches, flightColumns } from '../../../src/services/flight/flightColumns';
import type { FlightResult } from '../../../src/engine/openRocketEngine';
import { flightDataCsv } from '../../../src/services/exports/csvExport';
import { METRIC_UNITS } from '../../../src/prefs/units';

/** A result carrying exactly these series keys. */
const withKeys = (keys: string[]) =>
  ({ series: Object.fromEntries(keys.map((k) => [k, [0, 1]])) }) as unknown as FlightResult;

const strings = (locale: Record<string, unknown>, ns: string) => (locale[ns] ?? {}) as Record<string, string>;

describe('flightColumns', () => {
  it('lists only what the run recorded', () => {
    // A column the run did not record would export empty.
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
   * The horizontal track has to be in the default set: it is the only thing in
   * the file that answers "where does it land".
   */
  it('exports the ground track by default', () => {
    for (const k of ['Px', 'Py']) expect(DEFAULT_CSV_COLUMNS).toContain(k);
  });

  /**
   * Every variable carries a name, in both languages.
   *
   * Bare kernel symbols ("Abx", "dΦ", "ha") are unreadable unless you already
   * know the symbol table. The names are generated from OpenRocket's own
   * `FlightDataType` and its message bundles, so a variable reads the same here
   * as it does in the desktop app; this catches a symbol that slipped through
   * without one.
   */
  it('names every column it can offer, in English and Spanish', () => {
    // A result carrying every key the table knows about.
    const all = flightColumns(withKeys(DEFAULT_CSV_COLUMNS.concat(['ha', 'Vz', 'Abx', 'dΦ', 'Cdf', 'ρ', 'Fta'])));
    expect(all.length).toBeGreaterThan(15);
    for (const c of all) {
      expect(c.labelKey, `${c.key} has no label key`).toBeTruthy();
      const [ns, key] = c.labelKey!.split('.');
      expect(strings(en, ns!)[key!], `en is missing ${c.labelKey}`).toBeTruthy();
      expect(strings(es, ns!)[key!], `es is missing ${c.labelKey}`).toBeTruthy();
    }
  });

  it('names and scales the thrust pressure correction the full set carries', () => {
    const [fta] = flightColumns(withKeys(['Fta']));
    expect(fta).toEqual({ key: 'Fta', labelKey: 'flightVar.Fta', quantity: 'force' });
  });

  it('puts the mass in the reader mass unit, as it does the propellant mass', () => {
    expect(flightColumns(withKeys(['mass', 'mp'])).map((c) => c.quantity)).toEqual(['mass', 'mass']);
  });

  /**
   * The kernel records the body rates and the natural frequency in rad/s, and
   * `r/s` in OpenRocket's unit list is revolutions per second, so the column
   * takes the roll-rate unit group and is converted with it.
   */
  it('puts the angular rates in the reader roll-rate unit, converted from rad/s', () => {
    const keys = ['dΦ', 'dθ', 'dΨ', 'ωn'];
    expect(flightColumns(withKeys(keys)).map((c) => c.quantity)).toEqual(keys.map(() => 'rollRate'));

    const r = { series: { time: [0, 1], dΦ: [0, 2 * Math.PI] } } as unknown as FlightResult;
    const bare = { fieldDescriptions: true, simDescription: false, flightEvents: false, decimals: 3 };
    const name = (c: { key: string }) => c.key;
    const revs = flightDataCsv(r, METRIC_UNITS, { ...bare, columns: ['time', 'dΦ'], columnName: name }).split('\r\n');
    expect(revs[0]).toBe('# time (s),dΦ (r/s)');
    expect(revs[2]).toBe('1.000,1.000');

    const rads = flightDataCsv(
      r,
      { ...METRIC_UNITS, rollRate: 'rad/s' },
      { ...bare, columns: ['time', 'dΦ'], columnName: name },
    ).split('\r\n');
    expect(rads[0]).toBe('# time (s),dΦ (rad/s)');
    expect(rads[2]).toBe(`1.000,${(2 * Math.PI).toFixed(3)}`);
  });

  it('gives every column a unit or an explicit blank, never undefined both ways', () => {
    // Mach and the coefficients are genuinely unitless; a missing unit and a
    // missing quantity would render as the string "undefined".
    for (const c of flightColumns(withKeys(['time', 'Cd', 'M', 'Px', 'ρ']))) {
      expect(c.quantity ?? c.unit, `${c.key} has neither`).toBeDefined();
    }
  });
});

/**
 * Every series the kernel can record has a column with a name and a unit, so
 * none exports as a bare symbol. The symbols are read from `FlightDataType.java`
 * itself; the app's dozen arrive under its own names, and the bridge never
 * sends the computation time.
 */
describe('flightColumns against FlightDataType', () => {
  const SENT_AS_APP_NAME: Record<string, string> = {
    t: 'time',
    h: 'altitude',
    Vt: 'velocity',
    At: 'acceleration',
    m: 'mass',
    Ft: 'thrust',
    Fd: 'drag',
    M: 'mach',
    S: 'stability',
    Cp: 'cpLocation',
    Cg: 'cgLocation',
    α: 'aoa',
  };
  const NOT_SENT = new Set(['tc']);
  const java = readFileSync(
    resolve(process.cwd(), '../engine-java/src/java/info/openrocket/core/simulation/FlightDataType.java'),
    'utf8',
  );
  const unescape = (x: string) =>
    x.replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  const symbols = [
    ...java.matchAll(/newType\(\s*"[^"]*",\s*trans\.get\("[^"]*"\),\s*"([^"]*)"(\s*\+\s*Chars\.ALPHA)?/g),
  ].map((m) => unescape(m[1]!) + (m[2] ? 'α' : ''));

  it('finds the kernel table', () => {
    expect(symbols.length).toBeGreaterThan(60);
    expect(symbols).toContain('CNα');
  });

  it('labels every recorded series', () => {
    const keys = symbols.filter((s) => !NOT_SENT.has(s)).map((s) => SENT_AS_APP_NAME[s] ?? s);
    const cols = flightColumns(withKeys(keys));
    for (const k of keys) {
      const col = cols.find((c) => c.key === k);
      expect(col?.labelKey, `${k} has no label`).toBeTruthy();
      expect(col!.quantity ?? col!.unit, `${k} has no unit`).not.toBeUndefined();
    }
  });
});

describe('flightBranches', () => {
  it('wraps a single flight as one branch, under the given name', () => {
    const r = { series: { time: [0] }, events: [{ type: 'LIFTOFF', time: 0 }] } as unknown as FlightResult;
    const [only, ...rest] = flightBranches(r, 'Flight');
    expect(rest).toEqual([]);
    expect(only).toEqual({ name: 'Flight', events: r.events, series: r.series });
  });

  it('reads a result without events as a branch with none', () => {
    const r = { series: { time: [0] } } as unknown as FlightResult;
    expect(flightBranches(r)[0]!.events).toEqual([]);
  });

  it('returns the separated branches as they are', () => {
    const branches = [
      { name: 'Sustainer', events: [], series: { time: [0] } },
      { name: 'Booster', events: [], series: { time: [0] } },
    ];
    const r = { series: { time: [0] }, events: [], branches } as unknown as FlightResult;
    expect(flightBranches(r)).toBe(branches);
  });
});

describe('flightColumns units', () => {
  it('names the stability unit in the UI language', async () => {
    const i18n = (await import('../../../src/i18n')).default;
    await i18n.changeLanguage('ru');
    try {
      const stability = flightColumns(withKeys(['stability'])).find((c) => c.key === 'stability')!;
      expect(stability.unit).toBe(i18n.t('stability.caliber'));
      expect(stability.unit).not.toBe('cal');
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});
