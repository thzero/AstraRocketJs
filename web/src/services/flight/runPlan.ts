import type { RocketTree } from '../../engine/openRocketEngine';
import type { UnitSymbols } from '../../prefs/units';
import { configFor, primaryMotor, type FlightConfig } from './flightConfigs';
import { isComplete, type CompleteLaunch } from './requiredLaunch';
import { designBlocker, unflyable, unflyableText, type DesignBlocker, type Unflyable } from './runnability';
import type { Simulation } from './simulations';

type Translate = (key: string, vars?: Record<string, unknown>) => string;

/** What a batch run will do, decided before anything is dispatched. */
export interface RunPlan {
  /** Why no row of this design can fly, or null. When set, nothing flies. */
  blocker: DesignBlocker | null;
  /** The rows that fly, each with its launch conditions proven complete. */
  flying: { sim: Simulation; launch: CompleteLaunch }[];
  /** The rows refused, each naming its reason. */
  skipped: Unflyable[];
  /**
   * The rows to record as failed ON this design: every requested row when the
   * design is blocked, else the skipped ones. The record is what holds auto-run
   * back from retrying them until the design changes (`selectRunFailed`).
   */
  failedIds: string[];
}

/**
 * Which of the requested rows fly, and why each of the others does not.
 *
 * A fault in the DESIGN stops the whole batch: no motor mount (nowhere to seat a
 * motor) or a part whose required dimension is zero, since a zero-volume body
 * tube would still hand back an apogee. The Run button is disabled for these
 * too; this is the guard a programmatic run cannot get past.
 *
 * Otherwise each row is judged on its own, by the same `unflyable` the Run
 * button reads (services/flight/runnability). A row with no usable motor, or with
 * launch conditions outside the NAR/Tripoli codes, is skipped: those are
 * simulation settings rather than design, so there is nothing to preserve by
 * flying them, and a number this app will not stand behind is worse than no
 * number. One bad row never abandons the rest.
 *
 * Ids that name no row are dropped.
 */
export function planRun(
  ids: readonly string[],
  sims: readonly Simulation[],
  tree: RocketTree,
  configs: readonly FlightConfig[],
): RunPlan {
  const rows = ids.flatMap((id) => sims.filter((x) => x.id === id).slice(0, 1));
  const blocker = designBlocker(tree);
  if (blocker) return { blocker, flying: [], skipped: [], failedIds: rows.map((x) => x.id) };

  const flying: RunPlan['flying'] = [];
  const skipped: Unflyable[] = [];
  for (const sim of rows) {
    const reason = unflyable(sim, primaryMotor(tree, configFor(configs, sim.configId)));
    if (reason) {
      skipped.push({ id: sim.id, name: sim.name, reason });
      continue;
    }
    // `unflyable` already established that every required launch field is
    // present; this restates it for the type system, which cannot see that
    // through the reason object. simConditions takes a CompleteLaunch precisely
    // so a blank can never be quietly turned into a number on its way to the
    // engine.
    if (!isComplete(sim.launch)) continue;
    flying.push({ sim, launch: sim.launch });
  }
  return { blocker: null, flying, skipped, failedIds: skipped.map((u) => u.id) };
}

/**
 * ONE line's worth of messages for everything in a batch that did not produce a
 * flight, refusals first and then failures, each naming its row.
 *
 * Collected and reported together rather than as they happen: a per-row error
 * write leaves only whichever row failed last, with no name on it, and sharing
 * one slot between the two kinds means six rows with two timeouts and one missing
 * motor report only the missing motor.
 */
export function runProblems(
  skipped: readonly Unflyable[],
  failed: readonly { name: string; msg: string }[],
  t: Translate,
  units: UnitSymbols,
): string[] {
  return [
    ...skipped.map((u) => unflyableText(u, t, units)),
    ...failed.map((f) => t('sim.failedNamed', { name: f.name, message: f.msg })),
  ];
}

/**
 * What the Results tab shows after a batch: the rows that landed, and which one
 * to open. The row you were working on when it is one of them, else the first.
 * Landing on some other row's flight is disorienting: you asked for these, and
 * the active one is the one you were just looking at. Null when nothing landed.
 *
 * `lastRunIds` is what the Results tab reads to decide between a name and a
 * picker; `resultSimId` points it at this run rather than at whatever was being
 * read before.
 */
export function landingView(
  landedIds: readonly string[],
  activeId: string,
): { lastRunIds: string[]; resultSimId: string } | null {
  if (!landedIds.length) return null;
  return { lastRunIds: [...landedIds], resultSimId: landedIds.includes(activeId) ? activeId : landedIds[0]! };
}
