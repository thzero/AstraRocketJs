import type { FlightResult, AeroSweep } from '../engine/openRocketEngine';
import { branchSeries, DEFAULT_CSV_COLUMNS, flightColumns, usableColumns, type FlightColumn } from './flightColumns';
import { siToUiDelta, type Quantity, type UnitSelection } from '../prefs/units';

/**
 * CSV exporters for the flight time-series and the drag sweep. Columns are
 * written in the user's chosen units, and every header cell names the unit it
 * carries — so a file stays self-describing whatever the preference was when it
 * was written. Numbers use '.' as the decimal separator regardless of locale.
 *
 * `siToUiDelta`, not `siToUi`: a whole column is being scaled, and none of these
 * quantities carries a temperature-style offset.
 */
const EOL = '\r\n';

const cell = (v: number | null | undefined, digits?: number): string => {
  if (v == null || !Number.isFinite(v)) return '';
  return digits == null ? String(Math.round(v * 1e6) / 1e6) : v.toFixed(digits);
};
const mul = (v: number | null | undefined, f: number): number | null =>
  v == null || !Number.isFinite(v) ? null : v * f;
const row = (cells: (string | number)[]): string => cells.join(',');

/** A column's SI→display multiplier and the symbol its header should name. */
const col = (units: UnitSelection, q: Quantity): { f: number; sym: string } => ({
  f: siToUiDelta(q, units[q], 1),
  sym: units[q],
});

/**
 * How a flight CSV is written: which columns, in what format, with which
 * comments — OpenRocket's own Export data options, which it keeps in
 * `CsvOptionPanel` and the export panel beside it.
 *
 * It used to be none of these: the button wrote a fixed twelve columns, comma
 * separated, six significant digits, with the event lines always on. That is one
 * opinion about a file somebody else has to read.
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
  /** A comment listing each column and the unit it carries. */
  fieldDescriptions: boolean;
  /** A comment per flight event, with its time. */
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
  columns: [...DEFAULT_CSV_COLUMNS],
  separator: ',',
  decimals: 3,
  exponential: false,
  simDescription: true,
  fieldDescriptions: true,
  flightEvents: true,
  commentChar: '#',
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
  // A separator inside a field would split the row; the comment character
  // leading a data line would comment it out. Neither can happen with the
  // separators and characters the dialog offers, and a header is the only text
  // in the file, so quoting stays out of it - but the header still gets stripped
  // rather than trusted.
  const clean = (text: string) =>
    text
      .split(sep)
      .join(' ')
      .replace(/[\r\n]/g, ' ');

  const unitOf = (c: (typeof cols)[number]): string => (c.quantity ? units[c.quantity] : (c.unit ?? ''));
  const factorOf = (c: (typeof cols)[number]): number =>
    c.quantity ? siToUiDelta(c.quantity, units[c.quantity], 1) : (c.scale ?? 1);

  const lines: string[] = [];
  const comment = (text: string) => lines.push(`${o.commentChar} ${text}`);

  if (o.simDescription && name) comment(`Simulation: ${clean(name)}`);
  if (o.simDescription && branch?.name) comment(`Stage: ${clean(branch.name)}`);
  if (o.fieldDescriptions) {
    for (const c of cols) {
      const u = unitOf(c);
      comment(`${clean(o.columnName(c))}${u ? ` (${u})` : ''}`);
    }
  }
  if (o.flightEvents) {
    for (const e of branch?.events ?? r.events ?? []) {
      comment(`Event ${e.type} at t=${e.time.toFixed(3)} s`);
    }
  }

  lines.push(
    cols
      .map((c) => {
        const u = unitOf(c);
        return clean(o.columnName(c)) + (u ? ` (${u})` : '');
      })
      .join(sep),
  );

  const n = (series?.['time']?.length ?? 0) as number;
  for (let i = 0; i < n; i++) {
    lines.push(
      cols
        .map((c) => {
          const raw = (series as Record<string, (number | null)[] | undefined>)[c.key]?.[i];
          return value(raw == null ? null : raw * factorOf(c), o);
        })
        .join(sep),
    );
  }
  return lines.join(EOL) + EOL;
}

/** Cd / CP / CNα vs Mach, with the friction/pressure/base split and per-component Cd. */
export function aeroTableCsv(d: AeroSweep, units: UnitSelection): string {
  const len = col(units, 'length');
  // Strip the delimiters/newlines/quotes an imported component name could carry
  // so it can't split or corrupt the comma-joined row. (No formula-injection
  // risk: the `Cd_` prefix means the cell never leads with =/+/-/@.)
  const compHeader = (name: string) => `Cd_${name.replace(/[[\]"\r\n]/g, '').replace(/,/g, ';')}`;
  const header = ['Mach', 'Cd', 'Cd_friction', 'Cd_pressure', 'Cd_base'];
  if (d.hasNozzle) header.push('Cd_powerOn');
  header.push(`CP (${len.sym})`, 'CNalpha (/rad)');
  // Components are identified by a stable key, not by name, so two unnamed body
  // tubes now arrive as two distinct columns rather than one merged one. Number
  // the repeats so the header still says which column is which.
  const seen = new Map<string, number>();
  for (const c of d.components) {
    const base = compHeader(c.name);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    header.push(n > 1 ? `${base} (${n})` : base);
  }

  const lines = [row(header)];
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

/** The MIME type the CSV exports are served under. */
export const CSV_MIME = 'text/csv;charset=utf-8';
