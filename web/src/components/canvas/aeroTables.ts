import type { CSSProperties } from 'react';
import type { AeroSweep, ComponentMass } from '../../engine/openRocketEngine';

/**
 * The pure half of AeroAnalysis: the cell-shading formulas, the per-table row
 * builders and the chart geometry (domain, stacked bands, axis ticks). Pulled
 * out of the component so each is provable without mounting the pane, which
 * had 14% coverage while carrying a formula-for-formula port of OpenRocket's
 * heat map and three table joins.
 */

export type HeatStyle = 'sky' | 'openrocket';

/** HSV to CSS rgb, matching java.awt.Color.getHSBColor. */
export function hsv(h: number, sat: number, val: number): string {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return Math.round(255 * (val - val * sat * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return `rgb(${f(5)}, ${f(3)}, ${f(1)})`;
}

/**
 * Cell shading for a magnitude. Two styles, because which one reads faster is a
 * matter of taste and of what you are already used to.
 *
 * `sky` (default) is ONE hue that strengthens with the value, scaled against the
 * row set's own largest - a magnitude ramp, which is what these numbers are, and
 * it sits on our dark table without fighting it. It is capped short of opaque so
 * the text keeps its own color.
 *
 * `openrocket` is the desktop's renderer, formula for formula: hue rotates green
 * to red over an ABSOLUTE Cd scale (full red at 1.5), saturation climbs with it,
 * value pinned at 1. That means light cells, so the text goes dark with them -
 * the same trade the desktop makes.
 */
export function heat(value: number, max: number, style: HeatStyle): CSSProperties | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;

  if (style === 'openrocket') {
    const r = value / 1.5;
    const hue = Math.max(0, Math.min(0.3333 * (1 - 2 * r), 0.3333));
    const sat = Math.max(0, Math.min(0.8 * r + 0.1 * (1 - r), 1));
    return { backgroundColor: hsv(hue, sat, 1), color: '#000' };
  }

  if (!(max > 0)) return undefined;
  const a = Math.min(1, value / max) * 0.55;
  return { backgroundColor: `rgba(2, 132, 199, ${a.toFixed(3)})` };
}

/** Engine aero-component keys arrive as "[Class.Instance]"; show the user's name
 *  when set, else the CamelCase class split into words (BodyTube -> "Body Tube"). */
export function niceName(raw: string): string {
  const m = raw.match(/^\[?([^.\]]+)\.([^.\]]+)\]?$/);
  const cls = m?.[1] ?? raw.replace(/[[\]]/g, '');
  const inst = m?.[2];
  const base = inst && inst !== cls ? inst : cls;
  return base.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

/**
 * SVG `d` for one series, skipping non-finite samples.
 *
 * Tracks whether a command has actually been EMITTED rather than taking the
 * letter from the array index. With `${i ? 'L' : 'M'}` a non-finite sample at
 * index 0 produced a `d` starting with `L...` - invalid path data, so the browser
 * silently drops the whole <path> and the curve renders blank with no error.
 * A gap mid-series starts a fresh `M` too, so a hole reads as a break instead
 * of a straight line bridging across it.
 */
export function buildLinePath(
  machs: readonly number[],
  vals: readonly number[],
  X: (m: number) => number,
  Y: (v: number) => number,
): string {
  const out: string[] = [];
  let open = false;
  machs.forEach((m, i) => {
    const v = vals[i] ?? NaN;
    if (!Number.isFinite(m) || !Number.isFinite(v)) {
      open = false;
      return;
    }
    out.push(`${open ? 'L' : 'M'}${X(m).toFixed(1)},${Y(v).toFixed(1)}`);
    open = true;
  });
  return out.join(' ');
}

/**
 * The sampled Mach nearest `mach`. The tables quote a real sample rather than
 * interpolating between two, so their numbers match the CSV exactly. Ties go
 * to the lower index, as the scan always has.
 */
export function nearestSampleIndex(machs: readonly number[], mach: number): number {
  let best = 0;
  for (let k = 1; k < machs.length; k++) {
    if (Math.abs(machs[k]! - mach) < Math.abs(machs[best]! - mach)) best = k;
  }
  return best;
}

type SweepComponent = AeroSweep['components'][number];

/** The engine's stable id. Two parts can share a NAME (an unnamed pair are
 *  both "Body tube"), so the label cannot be the row key. */
const rowKey = (c: SweepComponent): string => c.key ?? c.name;

export interface DragRow {
  key: string;
  name: string;
  instances: number;
  cdInstance: number | null | undefined;
  cd: number;
  friction: number | null | undefined;
  pressure: number | null | undefined;
  base: number | null | undefined;
}

/** Per-component drag at sample `i`, the worst offender first: that is the question. */
export function dragRows(sweep: AeroSweep, i: number): DragRow[] {
  return sweep.components
    .map((c) => ({
      key: rowKey(c),
      name: niceName(c.name),
      instances: c.instances ?? 1,
      cdInstance: c.cdInstance?.[i],
      cd: c.cd[i] ?? 0,
      friction: c.friction?.[i],
      pressure: c.pressure?.[i],
      base: c.base?.[i],
    }))
    .sort((a, b) => b.cd - a.cd);
}

/**
 * The whole-rocket figures the drag table reads against. Rounding aside, the
 * component totals ARE the rocket's drag; `unattributed` is the remainder, which
 * only matters if the kernel starts booking drag somewhere the walk does not
 * reach. `hasSplit` and `hasInstances` say which optional columns have data.
 */
export function dragTotals(
  sweep: AeroSweep,
  i: number,
): { totalCd: number; attributed: number; unattributed: number; hasSplit: boolean; hasInstances: boolean } {
  const totalCd = sweep.powerOff.total[i] ?? 0;
  const attributed = sweep.components.reduce((a, c) => a + (c.cd[i] ?? 0), 0);
  return {
    totalCd,
    attributed,
    unattributed: totalCd - attributed,
    hasSplit: sweep.components.some((c) => c.friction || c.pressure || c.base),
    hasInstances: sweep.components.some((c) => (c.instances ?? 1) > 1),
  };
}

/** Masses keyed on the engine's stable id, not the label: joining on the name
 *  gave two same-named parts each other's mass. */
export const massIndex = (masses: readonly ComponentMass[]): Map<string, ComponentMass> =>
  new Map(masses.map((m) => [m.key || m.name, m]));

export interface StabilityRow {
  key: string;
  name: string;
  cna: number;
  cp: number;
  mass: ComponentMass | undefined;
}

/** Each component's share of the normal-force slope at sample `i`, largest
 *  first; a part with no normal force has no CP to report and is dropped. */
export function stabilityRows(sweep: AeroSweep, i: number, massOf: Map<string, ComponentMass>): StabilityRow[] {
  return sweep.components
    .map((c) => ({
      key: rowKey(c),
      name: niceName(c.name),
      cna: c.cna?.[i] ?? 0,
      cp: c.cp?.[i] ?? 0,
      mass: massOf.get(rowKey(c)),
    }))
    .filter((r) => Math.abs(r.cna) > 1e-9)
    .sort((a, b) => b.cna - a.cna);
}

export interface RollRow {
  key: string;
  name: string;
  type: string;
  force: number;
  damp: number;
}

/**
 * Roll forcing and damping per fin set at sample `i`. Fin sets are the only
 * parts that generate or resist roll, which is what the desktop lists; anything
 * with a non-zero coefficient is kept too, so a kernel that starts attributing
 * roll elsewhere is not hidden. Fin sets are picked out by the kernel's class
 * name, because their numbers at rest are indistinguishable from a body tube's.
 */
export function rollRows(sweep: AeroSweep, i: number): RollRow[] {
  return sweep.components
    .map((c) => ({
      key: rowKey(c),
      name: niceName(c.name),
      type: c.type ?? '',
      force: c.rollForce?.[i] ?? 0,
      damp: c.rollDamp?.[i] ?? 0,
    }))
    .filter((r) => /FinSet/i.test(r.type) || Math.abs(r.force) > 1e-12 || Math.abs(r.damp) > 1e-12);
}

/** The largest magnitude in a column; 0 for an empty one. */
export function columnMax(rows: readonly number[]): number {
  let m = 0;
  for (const v of rows) if (Math.abs(v) > m) m = Math.abs(v);
  return m;
}

export interface ChartSeries {
  name: string;
  color: string;
  values: number[];
}

/**
 * The y-domain of a chart: for a stacked chart the tallest cumulative column
 * (floored at 0), otherwise the finite extremes of every series with 0 always
 * in range. Degenerate data gets a unit span, and 8% of headroom is added so
 * the top curve clears the frame.
 */
export function chartDomain(
  series: readonly ChartSeries[],
  machs: readonly number[],
  stacked: boolean,
): { yMin: number; yMax: number } {
  let yMin = 0;
  let yMax = 0;
  if (stacked) {
    for (let i = 0; i < machs.length; i++) {
      let s = 0;
      for (const se of series) s += Math.max(0, se.values[i] ?? 0);
      if (s > yMax) yMax = s;
    }
  } else {
    yMin = Infinity;
    yMax = -Infinity;
    for (const se of series)
      for (const v of se.values)
        if (Number.isFinite(v)) {
          if (v > yMax) yMax = v;
          if (v < yMin) yMin = v;
        }
    if (!Number.isFinite(yMax)) {
      yMax = 1;
      yMin = 0;
    }
    yMin = Math.min(0, yMin);
  }
  if (yMax === yMin) yMax = yMin + 1;
  yMax += (yMax - yMin) * 0.08;
  return { yMin, yMax };
}

/**
 * Stacked areas: cumulative bottom-to-top, each band a closed polygon whose top
 * edge is the running sum through this series and whose bottom edge is the
 * running sum before it. Negative samples count as zero so a band never
 * inverts.
 */
export function stackedBands(
  series: readonly ChartSeries[],
  machs: readonly number[],
  X: (m: number) => number,
  Y: (v: number) => number,
): { fill: string; d: string }[] {
  const bands: { fill: string; d: string }[] = [];
  const cum = new Array<number>(machs.length).fill(0);
  for (const se of series) {
    const lower = cum.slice();
    for (let i = 0; i < machs.length; i++) cum[i] = (cum[i] ?? 0) + Math.max(0, se.values[i] ?? 0);
    const top = machs.map((m, i) => `${X(m).toFixed(1)},${Y(cum[i]!).toFixed(1)}`).join(' L');
    const bot = machs
      .map((m, i) => `${X(m).toFixed(1)},${Y(lower[i]!).toFixed(1)}`)
      .reverse()
      .join(' L');
    bands.push({ fill: se.color, d: `M${top} L${bot} Z` });
  }
  return bands;
}

/**
 * Mach axis ticks: the sweep's first sample, then every 0.2 for a sweep that
 * ends at 1 (whole numbers would carry two ticks for the whole axis) or every
 * whole Mach above that.
 */
export function machTicks(machMin: number, machMax: number): number[] {
  const step = machMax <= 1 ? 0.2 : 1;
  const ticks = [machMin];
  for (let m = step; m <= machMax + 1e-9; m += step) ticks.push(Number(m.toFixed(2)));
  return ticks;
}
