import type { FlightResult, FlightSeries } from '../../engine/openRocketEngine';
import type { Quantity } from '../../prefs/units';
import type { Units } from '../../prefs/useUnits';
import { flightBranches } from '../../services/flight/flightColumns';
import { dynamicPressure, qAlpha, rollRate } from '../../services/flight/flightEvents';
import { token } from '../common/colorTokens';
import { ladderDigits } from '../../i18n/format';

/**
 * Owns what the flight chart draws: the series catalog (one panel per
 * measure, with its unit group and y-domain rules), the saved-panel filter,
 * and the flight-to-branch build that turns one simulation into one colored
 * line per stage. Pure data and functions; FlightChart re-exports
 * `buildTraces` and `ChartFlight` for GroundTrack.
 */

export type Key =
  | 'altitude'
  | 'velocity'
  | 'acceleration'
  | 'mach'
  | 'thrust'
  | 'drag'
  | 'mass'
  | 'stability'
  | 'cpLocation'
  | 'cgLocation'
  | 'aoa'
  | 'dynamicPressure'
  | 'qAlpha'
  | 'rollRate'
  | 'velocityAltitude';

export interface Meta {
  key: Key;
  label: string;
  /** Fixed unit label, for series that have no user-selectable unit (Mach). */
  unit: string;
  /** A fixed unit label that is a word, so it is translated (calibers). */
  unitKey?: string;
  digits: number;
  /**
   * The preference group this series belongs to. When set it supplies both the
   * scale and the label, and `unit`, `scale` and `digits` are unused; they
   * serve the handful of series (Mach, calibers) that are unitless.
   */
  quantity?: Quantity;
  /**
   * A second preference group the series is multiplied by, for a product of
   * two quantities: q·α is a pressure times an angle, shown in the reader's
   * pressure unit times their angle unit.
   */
  times?: Quantity;
  /** Multiply the raw SI series into display units (kg→g, m→cm, rad→deg). */
  scale?: number;
  /** Level bands (CG/CP/mass/stability) get a tight y-domain + no area fill;
   *  flow series (altitude/velocity/…) get a zero baseline + filled area. */
  level?: boolean;
  /** Aero-derived (CP / stability / q·α): only meaningful while flying forward; after
   *  recovery deploys the rocket tumbles (AoA≈90°) and these collapse to junk, so
   *  the series is clipped to the boost→apogee window. */
  aero?: boolean;
  /**
   * Plotted against altitude rather than time: velocity over altitude. It sits
   * outside the shared time axis, so it neither zooms with it nor shows event
   * lines; the crosshair's moment is marked on the curve instead.
   */
  xy?: boolean;
}

export const SERIES: Meta[] = [
  { key: 'altitude', label: 'flight.altitude', unit: 'm', digits: 0, quantity: 'distance' },
  { key: 'velocity', label: 'flight.velocity', unit: 'm/s', digits: 0, quantity: 'velocity' },
  { key: 'acceleration', label: 'flight.acceleration', unit: 'm/s²', digits: 0, quantity: 'acceleration' },
  { key: 'mach', label: 'flight.mach', unit: '', digits: 2 },
  { key: 'thrust', label: 'flight.thrust', unit: 'N', digits: 1, quantity: 'force' },
  { key: 'drag', label: 'flight.drag', unit: 'N', digits: 2, quantity: 'force' },
  { key: 'mass', label: 'flight.mass', unit: 'g', digits: 0, scale: 1000, level: true, quantity: 'mass' },
  {
    key: 'stability',
    label: 'flight.stability',
    unit: '',
    unitKey: 'stability.caliber',
    digits: 2,
    level: true,
    aero: true,
  },
  {
    key: 'cpLocation',
    label: 'flight.cp',
    unit: 'cm',
    digits: 1,
    scale: 100,
    level: true,
    aero: true,
    quantity: 'length',
  },
  { key: 'cgLocation', label: 'flight.cg', unit: 'cm', digits: 1, scale: 100, level: true, quantity: 'length' },
  { key: 'aoa', label: 'flight.aoa', unit: '°', digits: 1, scale: 180 / Math.PI, quantity: 'angle' },
  // Derived in buildTraces from what the kernel records; see flightEvents.ts.
  { key: 'dynamicPressure', label: 'flight.dynamicPressure', unit: 'Pa', digits: 0, quantity: 'pressure' },
  {
    key: 'qAlpha',
    label: 'flight.qAlpha',
    unit: 'Pa·rad',
    digits: 1,
    aero: true,
    quantity: 'pressure',
    times: 'angle',
  },
  { key: 'rollRate', label: 'flight.rollRate', unit: 'r/s', digits: 2, quantity: 'rollRate' },
  { key: 'velocityAltitude', label: 'flight.velocityAltitude', unit: '', digits: 0, xy: true },
];
/** What a series is multiplied by to show it in the reader's units. */
export const traceScale = (m: Meta, u: Pick<Units, 'factor'>): number =>
  m.quantity ? u.factor(m.quantity) * (m.times ? u.factor(m.times) : 1) : (m.scale ?? 1);

/** The unit a series is labeled in: the reader's, or its fixed label. */
export const traceUnit = (m: Meta, u: Pick<Units, 'sym'>, t: (key: string) => string): string =>
  m.quantity
    ? m.times
      ? `${u.sym(m.quantity)}·${u.sym(m.times)}`
      : u.sym(m.quantity)
    : m.unitKey
      ? t(m.unitKey)
      : m.unit;

/** One stage's samples on a panel: the points drawn and the span it flew. */
export interface PanelLine {
  color: string;
  name: string;
  pts: (readonly [number, number])[];
  xs: number[];
  ys: number[];
  t0?: number;
  t1?: number;
}

/**
 * A time panel's lines, one per shown stage, and the y-domain they share so
 * they read against each other. Aero series stop at `clipT`, where the rocket
 * stops flying forward.
 */
export function panelSeries(
  branches: readonly Branch[],
  meta: Meta,
  scale: number,
  clipT: number,
): { list: PanelLine[]; lo: number; hi: number } {
  let dMin = Infinity;
  let dMax = -Infinity;
  // A plain loop: the domain scan writes dMin/dMax, a side effect that does
  // not belong in a `.map` callback.
  const out: PanelLine[] = [];
  for (const b of branches) {
    const time = b.series.time ?? [];
    const raw = b.series[meta.key] ?? [];
    const p: (readonly [number, number])[] = [];
    const xa: number[] = [];
    const ya: number[] = [];
    for (let i = 0; i < time.length; i++) {
      const ti = time[i];
      const v = raw[i];
      if (ti == null || v == null || !Number.isFinite(ti) || !Number.isFinite(v)) continue;
      if (meta.aero && ti > clipT) continue;
      const y = v * scale;
      p.push([ti, y] as const);
      xa.push(ti);
      ya.push(y);
      if (y < dMin) dMin = y;
      if (y > dMax) dMax = y;
    }
    out.push({ color: b.color, name: b.name, pts: p, xs: xa, ys: ya, t0: xa[0], t1: xa[xa.length - 1] });
  }
  if (!(dMin < Infinity)) {
    dMin = 0;
    dMax = 1;
  }
  let l: number;
  let h: number;
  if (meta.level) {
    const r = dMax - dMin || Math.abs(dMax) || 1;
    l = dMin - r * 0.1;
    h = dMax + r * 0.1;
  } else {
    l = Math.min(0, dMin);
    h = dMax + (dMax - l || 1) * 0.08;
  }
  return { list: out, lo: l, hi: h === l ? l + 1 : h };
}

/**
 * The decimals a panel's readouts carry. A fixed count belongs to a fixed
 * unit: "0 dp" is right for meters of altitude and wrong for kilometers, so a
 * quantity-backed series takes its count from the span on screen. The header
 * and the live region both read it, so what is heard is what is shown.
 */
export const panelDigits = (meta: Meta, lo: number, hi: number): number =>
  meta.quantity ? ladderDigits(Math.abs(hi - lo)) : meta.digits;

/** Every key the chart can draw, for validating what comes back from settings. */
const KEYS = new Set<string>(SERIES.map((m) => m.key));

/**
 * The saved panel choice, narrowed to keys this build actually has.
 *
 * A list saved by another version can name a series this build does not have;
 * dropping those here means a stale preference costs you
 * one panel rather than blanking the chart. The order is the series order, so
 * the panels stack the same way however the preference was written.
 */
export function visibleSeries(saved: readonly string[]): Key[] {
  const want = new Set(saved.filter((k) => KEYS.has(k)));
  return SERIES.filter((m) => want.has(m.key)).map((m) => m.key);
}

// One color per trace, in series-token order.
// Cycles if a design or a comparison somehow runs past six.
const STAGE_COLORS = [
  token('series-1'),
  token('series-2'),
  token('series-3'),
  token('series-4'),
  token('series-5'),
  token('series-6'),
];

/** The flight to draw, named so the pane can say which simulation it is. */
export interface ChartFlight {
  id: string;
  name: string;
  result: FlightResult;
}

/**
 * One drawn line: a single flight branch, with a stable key, a name and a color.
 *
 * A staged rocket separates into several, and each flies its own trajectory on
 * the same launch clock - a spent booster's climb, descent and landing beside
 * the sustainer's. A single-stage flight collapses to one synthetic branch, so
 * the common case is still one trace.
 */
export type Branch = {
  key: string;
  name: string;
  color: string;
  events: { type: string; time: number }[];
  series: FlightSeries;
};

/**
 * The lines to draw for one flight: one per branch.
 *
 * `stageLabel` renders "Stage 2" for a branch the engine did not name; it is
 * passed in rather than translated here so this stays a pure function.
 *
 * The key carries the simulation id as well as the branch index, so a hidden
 * stage of one flight never hides the same-numbered stage of another; the
 * chart itself is keyed on the simulation id by its host (CenterCanvas), which
 * is what gives a different flight a fresh selection and zoom.
 */
export function buildTraces(
  flight: ChartFlight | null,
  stageLabel: (i: number, name: string | undefined) => string,
): Branch[] {
  if (!flight) return [];
  return flightBranches(flight.result).map((b, i) => ({
    key: `${flight.id}:${i}`,
    name: stageLabel(i, b.name),
    color: STAGE_COLORS[i % STAGE_COLORS.length]!,
    events: b.events ?? [],
    // The derived panels ride as series of their own, so a panel reads them the
    // way it reads any other. A run that lacks their inputs leaves them absent.
    series: {
      ...b.series,
      dynamicPressure: dynamicPressure(b.series) ?? undefined,
      qAlpha: qAlpha(b.series) ?? undefined,
      rollRate: rollRate(b.series) ?? undefined,
    },
  }));
}
