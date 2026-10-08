import type { FlightResult, FlightSeries } from '../../engine/openRocketEngine';
import { lerpAt } from './interpolate';
import { flightBranches } from './flightColumns';

/**
 * The flight as a TIMELINE: one row per event, each carrying the state of the
 * rocket at that instant.
 *
 * The charts mark events as a label strip (FlightChartEvents), which answers
 * "when" and nothing else, and a handful of instants reach the summary tiles (rod
 * exit, rail margin, deploy speed). Neither is a list you can read down. Nothing
 * here is computed twice: `FlightResult.events` carries the kernel's full event
 * list, not just the five the chart labels, and every series needed to sample at
 * an event time is on the same branch, so this file is a JOIN, not physics.
 *
 * The one exception is {@link maxQ}, which the kernel does not record.
 *
 * Pure and component-free, like aeroTables.ts beside AeroComponentTables, so the
 * join and the peak are testable without mounting a table.
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
 * fifteen is a smear. A table has rows and no such limit, so the events a chart
 * cannot carry (rail departure, ignition, separation, tumble) are named here.
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

/**
 * A series value at a time, by key, tolerating both the named arrays and the
 * symbol-keyed ones. Null when the run did not record that series.
 */
export function seriesAt(series: FlightSeries, key: string, t: number): number | null {
  const ys = series[key];
  if (!Array.isArray(ys) || !Array.isArray(series.time)) return null;
  return lerpAt(series.time, ys, t);
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
 * When the rocket stops flying forward: the recovery deployment, else apogee.
 * After it the rocket tumbles under its recovery, so the aero figures (q·α,
 * stability, CP) say nothing about the airframe past this point.
 */
export function forwardFlightEnd(result: {
  events: readonly { type: string; time: number }[];
  summary?: { timeToApogee?: number };
}): number {
  return (
    result.events.find((e) => e.type === 'RECOVERY_DEVICE_DEPLOYMENT' || e.type === 'EJECTION_CHARGE')?.time ??
    result.events.find((e) => e.type === 'APOGEE')?.time ??
    result.summary?.timeToApogee ??
    Infinity
  );
}

/**
 * q·α over a branch, in Pa·rad: dynamic pressure times the angle of attack.
 * The aerodynamic side load on the airframe scales with it, which is why it is
 * the figure a fin or a coupler is judged against. Null when the run did not
 * record what {@link dynamicPressure} needs.
 */
export function qAlpha(series: FlightSeries | undefined): (number | null)[] | null {
  const qs = dynamicPressure(series);
  if (!qs || !series) return null;
  return qs.map((q, i) => {
    const a = series.aoa[i];
    return q == null || a == null ? null : q * Math.abs(a);
  });
}

/**
 * The largest q·α while the rocket is still flying forward, up to `untilT`
 * (the deployment, else apogee). After that it tumbles under its recovery, the
 * angle of attack reads near 90 degrees and the product says nothing about the
 * airframe, which is the same window the chart clips its aero series to.
 */
export function maxQAlpha(series: FlightSeries | undefined, untilT: number): { time: number; value: number } | null {
  const qa = qAlpha(series);
  if (!qa || !series) return null;
  let best: { time: number; value: number } | null = null;
  for (let i = 0; i < qa.length; i++) {
    const v = qa[i];
    const t = series.time[i];
    if (v == null || t == null || t > untilT) continue;
    if (!best || v > best.value) best = { time: t, value: v };
  }
  return best;
}

/** Roll rate over a branch (rad/s), the kernel's `dΦ`; null when not recorded. */
export function rollRate(series: FlightSeries | undefined): (number | null)[] | null {
  const r = series?.['dΦ'];
  return Array.isArray(r) ? r : null;
}

/** The fastest roll over the whole flight, by magnitude (rad/s). */
export function maxRollRate(series: FlightSeries | undefined): number | null {
  const r = rollRate(series);
  if (!r) return null;
  let best: number | null = null;
  for (const v of r) if (v != null && Number.isFinite(v) && (best == null || Math.abs(v) > best)) best = Math.abs(v);
  return best;
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
  flightBranches(result).forEach((b, i) => {
    const series = b.series;
    const push = (type: string, time: number, source: string | undefined, q: number | null) => {
      rows.push({
        key: `${i}:${type}:${time}:${rows.length}`,
        type,
        time,
        branch: i,
        branchName: b.name ?? '',
        ...(source ? { source } : {}),
        altitude: seriesAt(series, 'altitude', time),
        velocity: seriesAt(series, 'velocity', time),
        stability: seriesAt(series, 'stability', time),
        twr: seriesAt(series, 'Twr', time),
        aoa: seriesAt(series, 'aoa', time),
        mach: seriesAt(series, 'mach', time),
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
