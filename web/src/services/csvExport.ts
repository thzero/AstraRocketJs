import type { FlightResult, DragSweep, FlightSeries } from '../engine/openRocketEngine';

/**
 * CSV exporters for the flight time-series and the drag sweep. Metric units
 * throughout (labeled in each header cell) — a user-selectable unit system is a
 * later feature; until then everything is SI-derived (g / cm / deg for the
 * friendlier magnitudes, matching what the charts display).
 */
const EOL = '\r\n';

const cell = (v: number | null | undefined, digits?: number): string => {
  if (v == null || !Number.isFinite(v)) return '';
  return digits == null ? String(Math.round(v * 1e6) / 1e6) : v.toFixed(digits);
};
const mul = (v: number | null | undefined, f: number): number | null =>
  v == null || !Number.isFinite(v) ? null : v * f;
const row = (cells: (string | number)[]): string => cells.join(',');

/** Per-timestep flight data, prefixed with an OpenRocket-style event reference. */
export function flightDataCsv(r: FlightResult): string {
  const s = r.series;
  const n = s.time?.length ?? 0;
  const at = (k: keyof FlightSeries, i: number): number | null => {
    const v = (s[k] as (number | null)[] | undefined)?.[i];
    return v == null || !Number.isFinite(v) ? null : v;
  };
  const lines: string[] = [];
  for (const e of r.events ?? []) lines.push(`# Event ${e.type} at t=${cell(e.time, 3)} s`);
  lines.push(row([
    'Time (s)', 'Altitude (m)', 'Velocity (m/s)', 'Acceleration (m/s^2)', 'Mass (g)',
    'Thrust (N)', 'Drag (N)', 'Mach', 'Stability (cal)', 'CP (cm)', 'CG (cm)', 'AoA (deg)',
  ]));
  for (let i = 0; i < n; i++) {
    lines.push(row([
      cell(at('time', i), 4),
      cell(at('altitude', i)),
      cell(at('velocity', i)),
      cell(at('acceleration', i)),
      cell(mul(at('mass', i), 1000)),
      cell(at('thrust', i)),
      cell(at('drag', i)),
      cell(at('mach', i)),
      cell(at('stability', i)),
      cell(mul(at('cpLocation', i), 100)),
      cell(mul(at('cgLocation', i), 100)),
      cell(mul(at('aoa', i), 180 / Math.PI)),
    ]));
  }
  return lines.join(EOL) + EOL;
}

/** Cd / CP / CNα vs Mach, with the friction/pressure/base split and per-component Cd. */
export function dragTableCsv(d: DragSweep): string {
  const compHeader = (name: string) => `Cd_${name.replace(/[[\]]/g, '').replace(/,/g, ';')}`;
  const header = ['Mach', 'Cd', 'Cd_friction', 'Cd_pressure', 'Cd_base'];
  if (d.hasNozzle) header.push('Cd_powerOn');
  header.push('CP (cm)', 'CNalpha (/rad)');
  for (const c of d.components) header.push(compHeader(c.name));

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
    cells.push(cell(mul(d.cp[i], 100)));
    cells.push(cell(d.cna[i]));
    for (const c of d.components) cells.push(cell(c.cd[i]));
    lines.push(row(cells));
  }
  return lines.join(EOL) + EOL;
}

/** Trigger a browser download of CSV text. */
export function downloadCsv(filename: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}
