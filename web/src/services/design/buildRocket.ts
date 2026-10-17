import { buildRocketTree } from '../../engine/api';
import type { OpenRocketDesign, RocketTree, StaticInfo } from '../../engine/openRocketEngine';
import { configuredTree, liveMotors, seatedMotorsKey, stageFlies, type FlightConfig } from '../flight/flightConfigs';
import { findStages } from './treeEdit';
import { badDimensions, overturnedFins, type BadDimension, type NamedPart } from './requiredComponent';
import { hasUsableCurve } from '../motors/motorCurve';
import { errorReason, type Keyed } from '../../i18n/keyedError';

/**
 * A key over every configuration input that can change the static info.
 *
 * `buildConfiguredRocket` reads three things off the configuration: the motors
 * (in `seatedMotorsKey`), their ignition and the grounded stages. Ignition is
 * left out on purpose, since it moves no static figure (see `seatedMotorsKey`).
 * Without `grounded` in the key, grounding a booster would leave `info`
 * describing the whole stack while the worker flies the sustainer alone, and
 * the mass, CG, CP and caliber readouts would describe a different rocket from
 * the flight.
 *
 * Sorted, because the key is about what is grounded and not the order the user
 * clicked. Combined with the tree's `components` identity by the caller.
 *
 * The configuration's deployment and separation overrides are deliberately not
 * here, although `configuredTree` bakes them in: they move when recovery fires
 * and when a stage lets go, which is flight timing, and change no static mass or
 * dimension. A rebuild for one of those would be a needless kernel build on
 * every chute-altitude keystroke.
 */
export function buildKey(tree: RocketTree, config: FlightConfig): string {
  const grounded = [...(config.grounded ?? [])].sort().join(',');
  return `${seatedMotorsKey(tree, config)}#${grounded}`;
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
 * Mounts are seated in tree order (`liveMotors`), which is also what drops a
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
    // The one "usable curve" predicate (motorCurve.ts). A curve-less motor
    // (an unresolved .ork motor, or a mount the file left empty) leaves the
    // mount empty rather than throwing "Too short thrust-curve"; the run gate
    // then reports "no motor" instead of the app failing to draw the rocket.
    if (!hasUsableCurve(m.spec)) continue;
    r.setMotorById(id, m.spec);
    // Automatic with no delay is the engine's own default and needs no call; a
    // delay alone still does.
    if (m.ignitionEvent || m.ignitionDelay)
      r.setMotorIgnitionById(id, m.ignitionEvent ?? 'automatic', m.ignitionDelay ?? 0);
  }
  // After the motors: grounding a stage refreshes the configuration's active
  // motor list, and a motor seated later would put a grounded stage's engine
  // back into it.
  for (const stage of findStages(tree)) {
    const id = stage.id as string;
    if (!stageFlies(config, id)) r.setStageActiveById(id, false);
  }
  sources.set(r, tree.components);
  return r;
}

/** The parts each live handle was built from (see `builtFrom`). */
const sources = new WeakMap<OpenRocketDesign, RocketTree['components']>();

/**
 * The `components` of the tree a handle from `buildConfiguredRocket` was built
 * from, compared by identity: every edit replaces it. A handle the store holds
 * can describe an earlier design while a rebuild waits out its debounce.
 */
export function builtFrom(rocket: OpenRocketDesign): RocketTree['components'] | undefined {
  return sources.get(rocket);
}

/**
 * Static info + the live handle it was read from, or a build/read failure.
 *
 * A failure carries the engine's own message (as its key and values when it is
 * keyed, so the banner can show it in the app's language) and, where the
 * design explains itself, the dimensions that are zero. The engine's message
 * does not name a part: a tube fin set with a zero length divides by its own chord for the
 * aspect ratio (`TubeFinSetCalc`), and what reaches the banner is "The number
 * NaN cannot be converted to a BigInt", which tells nobody which part to go and
 * fix. The app already knows (`badDimensions`), and the Run button already says
 * so in those words, so the banner says the same thing.
 */
export type StaticInfoResult =
  { info: StaticInfo; rocket: OpenRocketDesign } | { error: string | Keyed; bad?: BadDimension[]; fins?: NamedPart[] };

/**
 * Build the configured rocket and read its static info (CG / CP / stability),
 * then fill in the Mach-0.3 coast drag coefficient (a geometry property absent
 * from the static JSON) via a best-effort single-point drag sweep. This is the
 * pure core of the rebuild effect (useWorkspaceEffects), lifted out so the app's
 * central physics orchestration is testable and reusable: it returns the static
 * info plus the live engine handle, or an `error` reason if the build/read
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
    // What the design can say for itself about the failure: zero dimensions,
    // and fin sets canted through their own body, whose root points the kernel
    // computes as NaN (so the build reports a NaN mass that names no part).
    const bad = badDimensions(tree);
    const fins = overturnedFins(tree);
    return { error: errorReason(e), ...(bad.length ? { bad } : {}), ...(fins.length ? { fins } : {}) };
  }
}
