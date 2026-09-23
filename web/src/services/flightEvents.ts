import type { FlightBranch, FlightResult, FlightSeries } from '../engine/openRocketEngine';
import { lerpAt } from './interpolate';

/**
 * The flight as a TIMELINE: one row per event, each carrying the state of the
 * rocket at that instant.
 *
 * The charts have always marked events as a label strip (FlightChartEvents),
 * which answers "when" and nothing else, and a handful of instants reach the
 * summary tiles (rod exit, rail margin, deploy speed). Neither is a list you
 * can read down. Everything here was already computed: `FlightResult.events`
 * carries the kernel's full event list — not just the five the chart labels —
 * and every series needed to sample at an event time is on the same branch, so
 * this file is a JOIN, not physics.
 *
 * The one exception is {@link maxQ}, which the kernel does not record.
 *
 * Pure and component-free, like aeroTables.ts beside AeroComponentTables: the
 * join and the peak are provable without mounting a table.
 */

/**
 * Synthetic event type for the dynamic-pressure peak.
 *
 * Not a kernel `FlightEvent.Type` — the kernel has no such event — so it is
 * spelled in the same SCREAMING_CASE as the real ones and named the same way
 * only so the table treats one row like any other.
 */
export const MAX_Q = 'MAX_Q';

/**
 * Event types the timeline names, to their i18n keys.
 *
 * This is deliberately wider than `EVENT_LABEL` in simReport.ts, which is the
 * set worth DRAWING on a chart: five marks on a plot is a readable plot, and
 * fifteen is a smear. A table has rows and no such limit, so the events that
 * were previously invisible (rail departure, ignition, separation, tumble) get
 * named here.
 *
 * A type absent from this map is dropped rather than shown under its raw
 * kernel name. That is on purpose for the three diagnostics — SIM_WARN,
 * SIM_ABORT and EXCEPTION — which are not moments in the flight and already
 * reach the user through FlightWarnings; and for ALTITUDE, which is an
 * internal trigger the kernel raises for altitude-fired deployment rather than
 * something that happened to the rocket.
 */
export const EVENT_NAME: Record<string, string> = {
  LAUNCH: 'flightEvent.launch',
  IGNITION: 'flightEvent.ignition',
  LIFTOFF: 'flightEvent.liftoff',
  LAUNCHROD: 'flightEvent.railDeparture',
  [MAX_Q]: 'flightEvent.maxQ',
  BURNOUT: 'flightEvent.burnout',
  EJECTION_CHARGE: 'flightEvent.ejection',
  STAGE_SEPARATION: 'flightEvent.separation',
  APOGEE: 'flightEvent.apogee',
  RECOVERY_DEVICE_DEPLOYMENT: 'flightEvent.deploy',
  TUMBLE: 'flightEvent.tumble',
  GROUND_HIT: 'flightEvent.landing',
  SIMULATION_END: 'flightEvent.simEnd',
};

/** A per-event extra beyond the altitude and speed every row carries. */
export type ExtraKey = 'stability' | 'twr' | 'aoa' | 'mach' | 'q';

/**
 * What each event is actually READ FOR, beyond when it happened and how high
 * and fast the rocket was.
 *
 * Per type rather than as columns of one wide table: rail departure is the
 * only row where thrust-to-weight and angle of attack decide anything, Mach
 * matters at burnout and at the pressure peak and nowhere else, and a table
 * with a column per extra would be four fifths empty cells. An event type
 * absent here simply has no extras.
 */
export const EVENT_EXTRAS: Record<string, readonly ExtraKey[]> = {
  // The four numbers that say whether it left the rail flying rather than
  // merely leaving it: how stable, how hard it was still pushing, and how far
  // off the wind had already pitched it.
  LAUNCHROD: ['stability', 'twr', 'aoa'],
  [MAX_Q]: ['q', 'mach'],
  BURNOUT: ['mach'],
};

/** One row of the timeline: an event, and the flight state at its instant. */
export interface EventRow {
  /**
   * Stable React key.
   *
   * It carries the row's POSITION as well as its branch, type and time,
   * because those three do not identify a row: a clustered stage built from
   * separate mounts burns out once per motor, and the kernel queues each of
   * those at the same instant (BasicEventSimulationEngine:510), so two rows of
   * one table can agree on all three.
   */
  key: string;
  /** Kernel `FlightEvent.Type` name, or {@link MAX_Q}. */
  type: string;
  time: number;
  /** Index into the result's branches; 0 is the sustainer stack. */
  branch: number;
  /**
   * The branch's name from the design ("Booster"). EMPTY when the engine did
   * not name it, or when the flight never separated — the caller supplies the
   * "Stage N" fallback, so this file needs no translator (the same split
   * `buildTraces` makes with its `stageLabel`).
   */
  branchName: string;
  /** Component that raised the event: the motor mount that burned out, the
   *  parachute that deployed. Absent for events with no source. */
  source?: string;
  /** SI, and null wherever the branch did not record the series. */
  altitude: number | null;
  velocity: number | null;
  stability: number | null;
  twr: number | null;
  /** Radians. */
  aoa: number | null;
  mach: number | null;
  /** Dynamic pressure (Pa). Only the {@link MAX_Q} row carries one. */
  q: number | null;
}

/** The peak of the dynamic-pressure curve, and the flight state there. */
export interface MaxQPoint {
  time: number;
  /** Dynamic pressure (Pa). */
  q: number;
  altitude: number | null;
  mach: number | null;
  /** True AIRSPEED at the peak (m/s) — see {@link dynamicPressure}. */
  velocity: number;
}

/** A series by key, tolerating both the named arrays and the symbol-keyed ones. */
function at(series: FlightSeries, key: string, t: number): number | null {
  const ys = series[key];
  return Array.isArray(ys) ? lerpAt(series.time, ys, t) : null;
}

/**
 * Dynamic pressure q = ½ρv² over a branch, in Pa. Null when the run did not
 * record what it needs.
 *
 * q is what decides whether an airframe holds together, and the kernel does not
 * record it — but it records both halves. `ρ` and `Vs` (air density and the
 * speed of sound) arrive with every run the app makes, because simulations.ts
 * asks for the `full` series set; a result saved back when `summary` was the
 * default has neither, which is the null case.
 *
 * v is `mach * Vs`, NOT the `velocity` series. `velocity` is the kernel's
 * TYPE_VELOCITY_TOTAL, the rocket's speed over the ground, while Mach comes
 * from the flight conditions (AbstractSimulationStepper:457) and so is measured
 * against the air the rocket is actually flying through. On a windy launch the
 * two differ, and dynamic pressure is a property of the airflow.
 */
export function dynamicPressure(series: FlightSeries | undefined): (number | null)[] | null {
  if (!series) return null;
  const rho = series['ρ'];
  const vs = series.Vs;
  const mach = series.mach;
  if (!Array.isArray(rho) || !Array.isArray(vs) || !Array.isArray(mach)) return null;
  return series.time.map((_, i) => {
    const r = rho[i];
    const s = vs[i];
    const m = mach[i];
    if (r == null || s == null || m == null) return null;
    const v = m * s;
    const q = 0.5 * r * v * v;
    return Number.isFinite(q) ? q : null;
  });
}

/**
 * Max-Q: the largest sample of {@link dynamicPressure}, and where it happened.
 *
 * The sample rather than a fitted peak, because the flight is only ever known
 * at its own time steps — the same thing every other "max" in the summary is.
 */
export function maxQ(series: FlightSeries | undefined): MaxQPoint | null {
  const qs = dynamicPressure(series);
  if (!qs || !series) return null;
  let best = -1;
  let bi = -1;
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i];
    if (q != null && q > best) {
      best = q;
      bi = i;
    }
  }
  if (bi < 0) return null;
  const mach = series.mach[bi] ?? null;
  const vs = series.Vs?.[bi] ?? null;
  return {
    time: series.time[bi]!,
    q: best,
    altitude: series.altitude[bi] ?? null,
    mach,
    velocity: mach != null && vs != null ? mach * vs : 0,
  };
}

/** The branches to walk: the real ones, or the top-level flight wrapped as one. */
function branchesOf(result: FlightResult): FlightBranch[] {
  return result.branches?.length ? result.branches : [{ name: '', events: result.events ?? [], series: result.series }];
}

/**
 * The whole flight as rows, earliest first.
 *
 * EVERY branch, interleaved on the one launch clock rather than grouped per
 * stage, because that is the order the flight happened in: a booster's descent
 * and landing run alongside the sustainer's coast, and reading them apart hides
 * that they overlap. The charts beside this table already draw every branch
 * (FlightChart's stage toggle), so a sustainer-only table would read as a bug.
 * The stage each row belongs to travels with it.
 *
 * Max-Q is inserted on branch 0 only. It is a property of the stack under
 * boost, and a spent booster tumbling down never approaches its own.
 *
 * Ties are broken by branch so a separation and the stage that follows it do
 * not swap places run to run; `Array.prototype.sort` is stable, so within one
 * branch same-instant events keep the order the kernel raised them in, which is
 * the causal one (an ejection charge before the deployment it fires).
 */
export function eventRows(result: FlightResult | null | undefined): EventRow[] {
  if (!result) return [];
  const rows: EventRow[] = [];
  branchesOf(result).forEach((b, i) => {
    const series = b.series;
    const push = (type: string, time: number, source: string | undefined, q: number | null) => {
      rows.push({
        key: `${i}:${type}:${time}:${rows.length}`,
        type,
        time,
        branch: i,
        branchName: b.name ?? '',
        ...(source ? { source } : {}),
        altitude: at(series, 'altitude', time),
        velocity: at(series, 'velocity', time),
        stability: at(series, 'stability', time),
        twr: at(series, 'Twr', time),
        aoa: at(series, 'aoa', time),
        mach: at(series, 'mach', time),
        q,
      });
    };
    for (const e of b.events ?? []) {
      if (!Number.isFinite(e.time) || !EVENT_NAME[e.type]) continue;
      push(e.type, e.time, e.source, null);
    }
    if (i !== 0) return;
    const peak = maxQ(series);
    if (peak) push(MAX_Q, peak.time, undefined, peak.q);
  });
  return rows.sort((a, b) => a.time - b.time || a.branch - b.branch);
}
