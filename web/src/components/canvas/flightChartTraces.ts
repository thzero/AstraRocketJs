import type { FlightResult, FlightSeries } from '../../engine/openRocketEngine';
import type { Quantity } from '../../prefs/units';

/**
 * Owns what the flight chart draws: the series catalog (one panel per
 * measure, with its unit group and y-domain rules), the saved-panel filter,
 * and the flight-to-branch build that turns one simulation into one colored
 * line per stage. Pure data and functions; FlightChart re-exports the public
 * ones for its callers and tests.
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
  | 'aoa';

export interface Meta {
  key: Key;
  label: string;
  /** Fixed unit label, for series that have no user-selectable unit (Mach, cal). */
  unit: string;
  digits: number;
  /**
   * The preference group this series belongs to. When set it supplies both the
   * scale and the label, and `unit`/`scale`/`digits` below are unused — they
   * stay for the handful of series (Mach, calibers) that are unitless.
   */
  quantity?: Quantity;
  /** Multiply the raw SI series into display units (kg→g, m→cm, rad→deg). */
  scale?: number;
  /** Level bands (CG/CP/mass/stability) get a tight y-domain + no area fill;
   *  flow series (altitude/velocity/…) get a zero baseline + filled area. */
  level?: boolean;
  /** Aero-derived (CP / stability): only meaningful while flying forward — after
   *  recovery deploys the rocket tumbles (AoA≈90°) and these collapse to junk, so
   *  the series is clipped to the boost→apogee window. */
  aero?: boolean;
}

export const SERIES: Meta[] = [
  { key: 'altitude', label: 'flight.altitude', unit: 'm', digits: 0, quantity: 'distance' },
  { key: 'velocity', label: 'flight.velocity', unit: 'm/s', digits: 0, quantity: 'velocity' },
  { key: 'acceleration', label: 'flight.acceleration', unit: 'm/s²', digits: 0, quantity: 'acceleration' },
  { key: 'mach', label: 'flight.mach', unit: '', digits: 2 },
  { key: 'thrust', label: 'flight.thrust', unit: 'N', digits: 1, quantity: 'force' },
  { key: 'drag', label: 'flight.drag', unit: 'N', digits: 2, quantity: 'force' },
  { key: 'mass', label: 'flight.mass', unit: 'g', digits: 0, scale: 1000, level: true, quantity: 'mass' },
  { key: 'stability', label: 'flight.stability', unit: 'cal', digits: 2, level: true, aero: true },
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
];
/** Every key the chart can draw, for validating what comes back from settings. */
const KEYS = new Set<string>(SERIES.map((m) => m.key));

/**
 * The saved panel choice, narrowed to keys this build actually has.
 *
 * A list saved by a later version can name a series that no longer exists (or
 * does not exist yet); dropping those here means a stale preference costs you
 * one panel rather than blanking the chart. The order is the SERIES order, so
 * the panels stack the same way however the preference was written.
 */
export function visibleSeries(saved: readonly string[]): Key[] {
  const want = new Set(saved.filter((k) => KEYS.has(k)));
  return SERIES.filter((m) => want.has(m.key)).map((m) => m.key);
}

// One color per trace: sky first (the original single line), then the rest.
// Matches the component-tree palette so a stage reads the same color everywhere.
// Cycles if a design or a comparison somehow runs past six.
const STAGE_COLORS = ['#38bdf8', '#fbbf24', '#34d399', '#a78bfa', '#fb7185', '#22d3ee'];

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
 * chart itself is keyed on the simulation id by its host (CenterView), which
 * is what gives a different flight a fresh selection and zoom.
 */
export function buildTraces(flight: ChartFlight | null, stageLabel: (i: number) => string): Branch[] {
  if (!flight) return [];
  // `branches` is only present once a staged rocket actually separates (branch 0
  // mirrors the top-level series); otherwise wrap the single top-level
  // trajectory so the rest of the chart is branch-agnostic.
  const bs = flight.result.branches?.length
    ? flight.result.branches
    : [{ name: '', events: flight.result.events ?? [], series: flight.result.series }];
  return bs.map((b, i) => ({
    key: `${flight.id}:${i}`,
    name: b.name || stageLabel(i),
    color: STAGE_COLORS[i % STAGE_COLORS.length]!,
    events: b.events ?? [],
    series: b.series,
  }));
}
