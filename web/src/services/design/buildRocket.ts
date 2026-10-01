import { buildRocketTree } from '../../engine/api';
import type { OpenRocketDesign, RocketTree, StaticInfo } from '../../engine/openRocketEngine';
import { configuredTree, liveMotors, stageFlies, type FlightConfig } from '../flight/flightConfigs';
import { findStages } from './treeEdit';
import { badDimensions, type BadDimension } from './requiredComponent';
import { hasUsableCurve } from '../motors/motorCurve';

/**
 * A key over everything about a design that can change a FLIGHT.
 *
 * Deliberately narrower than the tree object: the root carries `name`,
 * `designer`, `comment`, `revision` and `designType`, which are round-tripped to
 * the `.ork` and touch no physics, and every node carries a `name` that is a
 * label. Keying result-invalidation on the tree's object identity meant typing a
 * designer name in the Rocket-configuration dialog — or renaming a part —
 * silently threw away every simulation result the user had.
 *
 * Everything else is treated as flight-bearing, including fields we may not know
 * about (`ComponentNode` has an open index signature). That is the safe
 * direction to be wrong in: a needless invalidation costs a re-run, a missed one
 * shows numbers for a rocket that no longer exists.
 */
export function flightKey(tree: RocketTree): string {
  return JSON.stringify(tree.components, (k, v) => (k === 'name' ? undefined : (v as unknown)));
}

/**
 * Build the rocket with one flight configuration seated in it: every live mount
 * takes the motor that configuration puts there, plus its ignition override.
 *
 * Shared by the main-thread rebuild (useWorkspaceEffects) and the sim worker
 * (engine/simWorker.ts) so a worker-run flight executes on the *identical*
 * configuration: no drift between "what you see" (main-thread staticInfo) and
 * "what you simulate".
 *
 * Mounts are seated in TREE ORDER (`liveMotors`), which is also what drops a
 * motor whose mount is gone, so the build cannot depend on the order the motors
 * were edited in. The configuration's recovery and separation overrides are
 * applied to the tree first, so when it recovers and when it stages are the
 * configuration's too, and any stage it grounds is flagged inactive after the
 * motors are in.
 */
export function buildConfiguredRocket(tree: RocketTree, config: FlightConfig): OpenRocketDesign {
  // The configuration's recovery and separation overrides go in as node values,
  // which is where the kernel already reads both from.
  const r = buildRocketTree(configuredTree(tree, config));
  for (const [id, m] of liveMotors(tree, config)) {
    // The one "usable curve" predicate (motorCurve.ts). A curve-less motor -
    // an unresolved .ork motor, or a mount the file left empty - leaves the
    // mount empty rather than throwing "Too short thrust-curve"; the run gate
    // then reports "no motor" instead of the app failing to draw the rocket.
    if (!hasUsableCurve(m.spec)) continue;
    r.setMotorById(id, m.spec);
    // Skip "automatic": it is the engine's own default and needs no call.
    if (m.ignitionEvent) r.setMotorIgnitionById(id, m.ignitionEvent, m.ignitionDelay ?? 0);
  }
  // AFTER the motors: grounding a stage refreshes the configuration's active
  // motor list, and a motor seated later would put a grounded stage's engine
  // back into it.
  for (const stage of findStages(tree)) {
    const id = stage.id as string;
    if (!stageFlies(config, id)) r.setStageActiveById(id, false);
  }
  return r;
}

/**
 * Static info + the live handle it was read from, or a build/read failure.
 *
 * A failure carries the engine's own message AND, where the design explains
 * itself, the dimensions that are zero. The engine's message does not name a
 * part: a tube fin set with a zero length divides by its own chord for the
 * aspect ratio (`TubeFinSetCalc`), and what reaches the banner is "The number
 * NaN cannot be converted to a BigInt", which tells nobody which part to go and
 * fix. The app already knows (`badDimensions`), and the Run button already says
 * so in those words, so the banner says the same thing.
 */
export type StaticInfoResult = { info: StaticInfo; rocket: OpenRocketDesign } | { error: string; bad?: BadDimension[] };

/**
 * Build the configured rocket and read its static info (CG / CP / stability),
 * then fill in the Mach-0.3 coast drag coefficient — a geometry property absent
 * from the static JSON — via a best-effort single-point drag sweep. This is the
 * pure core of the rebuild effect (useWorkspaceEffects), lifted out so the app's
 * central physics orchestration is testable and reusable: it returns the static
 * info plus the live engine handle, or an `error` message if the build/read
 * throws. The `build` step is injectable so tests need no real engine.
 */
export function computeStaticInfo(
  tree: RocketTree,
  config: FlightConfig,
  build: typeof buildConfiguredRocket = buildConfiguredRocket,
): StaticInfoResult {
  try {
    const rocket = build(tree, config);
    const info = rocket.staticInfo();
    // Best-effort: a design the sweep can't evaluate just leaves cd undefined.
    try {
      info.cd = rocket.aeroSweep({ machMin: 0.3, machMax: 0.3, machStep: 0.05 }).powerOff.total[0];
    } catch {
      /* leave cd undefined */
    }
    return { info, rocket };
  } catch (e) {
    const bad = badDimensions(tree);
    return { error: e instanceof Error ? e.message : String(e), ...(bad.length ? { bad } : {}) };
  }
}
