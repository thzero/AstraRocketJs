import { describe, it, expect } from 'vitest';
import { flightDataCsv, aeroTableCsv, flightEventsCsv } from '../../src/services/csvExport';
import { METRIC_UNITS, IMPERIAL_UNITS } from '../../src/prefs/units';
import type { FlightResult, AeroSweep } from '../../src/engine/openRocketEngine';

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
      fieldDescriptions: false,
      simDescription: false,
      flightEvents: false,
    });
    expect(csv.split('\r\n')[0]).toBe('Time (s),Velocity (m/s)');
  });

  it('applies the chosen unit to every column', () => {
    const csv = flightDataCsv(result, METRIC_UNITS, {
      ...opts,
      columns: ['time', 'altitude', 'mass'],
      fieldDescriptions: false,
      simDescription: false,
      flightEvents: false,
      decimals: 1,
    });
    const rows = csv.split('\r\n');
    expect(rows[0]).toBe('Time (s),Altitude (m),Mass (g)');
    // kg -> g, so 0.05 reads as 50.
    expect(rows[1]).toBe('0.0,0.0,50.0');
  });

  it('honors the decimal places and exponential notation', () => {
    const body = (o: object) =>
      flightDataCsv(result, METRIC_UNITS, {
        ...opts,
        columns: ['altitude'],
        fieldDescriptions: false,
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
      fieldDescriptions: false,
      simDescription: false,
      flightEvents: false,
    });
    expect(csv.split('\r\n')[0]).toBe('Time (s)	Altitude (m)');
  });

  it('comments the simulation, the fields and the events, each on request', () => {
    const csv = flightDataCsv(result, METRIC_UNITS, { ...opts, columns: ['time'] }, 'Kept');
    const comments = csv.split('\r\n').filter((l) => l.startsWith('#'));
    expect(comments).toContain('# Simulation: Kept');
    expect(comments).toContain('# Time (s)');
    expect(comments).toContain('# Event BURNOUT at t=1.000 s');
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
      fieldDescriptions: false,
      flightEvents: false,
    });
    expect(csv.split('\r\n')[1]).toBe('0.000,');
  });

  it('offers the horizontal track, in the distance unit', () => {
    // The file carried altitude and nothing horizontal at all until these went
    // in, which made a landing point unanswerable from the CSV.
    const drifted = { ...result, series: { ...result.series, Px: [0, 30], Py: [0, -40] } } as unknown as FlightResult;
    const csv = flightDataCsv(drifted, IMPERIAL_UNITS, {
      ...opts,
      columns: ['Px', 'Py'],
      decimals: 2,
      simDescription: false,
      fieldDescriptions: false,
      flightEvents: false,
    });
    const rows = csv.split('\r\n');
    expect(rows[0]).toBe('East (ft),North (ft)');
    expect(rows[2]).toBe('98.43,-131.23');
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
    // brackets stripped, comma → semicolon
    expect(lines[0]).toBe('Mach,Cd,Cd_friction,Cd_pressure,Cd_base,Cd_powerOn,CP (cm),CNalpha (/rad),Cd_Nose1;x');
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
 * The events export. Where `flightDataCsv` can carry events as COMMENT lines
 * for a reader, this answers the other question: give me the events as data.
 */
/** Split one CSV line into fields, respecting quotes — what a reader does. */
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
  const csv = () => flightEventsCsv(rows, METRIC_UNITS, name, stage, 'C6 flight');

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
    const lines = flightEventsCsv(rows, IMPERIAL_UNITS, name, stage).trim().split('\r\n');
    expect(lines[0]).toContain('Altitude (ft)');
    expect(lines[1]!.split(',')[4]).toBe(String(Math.round((1.5 / 0.3048) * 1e6) / 1e6));
  });

  it('omits the title comment when there is no simulation name', () => {
    expect(flightEventsCsv(rows, METRIC_UNITS, name, stage).startsWith('Time (s),')).toBe(true);
  });

  it('quotes a name carrying a comma, so it cannot split the row', () => {
    const csvText = flightEventsCsv(
      [{ ...rows[0]!, branchName: 'Booster, lower' }],
      METRIC_UNITS,
      name,
      (r) => r.branchName,
    );
    const body = csvText.trim().split('\r\n')[1]!;
    expect(body).toContain('"Booster, lower"');
    // Eleven columns still, not twelve: the comma inside the quotes is data.
    expect(fields(body).length).toBe(11);
    expect(fields(body)[3]).toBe('Booster, lower');
  });
});
