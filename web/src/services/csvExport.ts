import type { FlightResult, AeroSweep, FlightSeries } from '../engine/openRocketEngine';
import { saveText } from './saveFile';
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

/** Per-timestep flight data, prefixed with an OpenRocket-style event reference. */
export function flightDataCsv(r: FlightResult, units: UnitSelection): string {
  const dist = col(units, 'distance');
  const vel = col(units, 'velocity');
  const acc = col(units, 'acceleration');
  const mass = col(units, 'mass');
  const force = col(units, 'force');
  const len = col(units, 'length');
  const ang = col(units, 'angle');
  const s = r.series;
  const n = s.time?.length ?? 0;
  const at = (k: keyof FlightSeries, i: number): number | null => {
    const v = (s[k] as (number | null)[] | undefined)?.[i];
    return v == null || !Number.isFinite(v) ? null : v;
  };
  const lines: string[] = [];
  for (const e of r.events ?? []) lines.push(`# Event ${e.type} at t=${cell(e.time, 3)} s`);
  lines.push(
    row([
      'Time (s)',
      `Altitude (${dist.sym})`,
      `Velocity (${vel.sym})`,
      `Acceleration (${acc.sym})`,
      `Mass (${mass.sym})`,
      `Thrust (${force.sym})`,
      `Drag (${force.sym})`,
      'Mach',
      'Stability (cal)',
      `CP (${len.sym})`,
      `CG (${len.sym})`,
      `AoA (${ang.sym})`,
    ]),
  );
  for (let i = 0; i < n; i++) {
    lines.push(
      row([
        cell(at('time', i), 4),
        cell(mul(at('altitude', i), dist.f)),
        cell(mul(at('velocity', i), vel.f)),
        cell(mul(at('acceleration', i), acc.f)),
        cell(mul(at('mass', i), mass.f)),
        cell(mul(at('thrust', i), force.f)),
        cell(mul(at('drag', i), force.f)),
        cell(at('mach', i)),
        cell(at('stability', i)),
        cell(mul(at('cpLocation', i), len.f)),
        cell(mul(at('cgLocation', i), len.f)),
        cell(mul(at('aoa', i), ang.f)),
      ]),
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

/** Trigger a browser download of arbitrary text under the given MIME type. */
export function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8'): void {
  void saveText(text, filename, mime);
}

/** Trigger a browser download of CSV text. */
export function downloadCsv(filename: string, text: string): void {
  downloadText(filename, text, 'text/csv;charset=utf-8');
}
