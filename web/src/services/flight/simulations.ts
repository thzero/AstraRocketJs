// A named simulation = one flight setup over the shared rocket design: the
// flight configuration it flies + launch conditions + last result. The right
// panel is a list of these; switching the active one drives the stability
// readout and sim.
import type { FlightResult, RocketTree } from '../../engine/openRocketEngine';
import type { FlightConfig } from './flightConfigs';
import type { LaunchConditions } from '../design/orkTree';
import type { CompleteLaunch } from './requiredLaunch';
import { surfaceLevel } from './safetyLimits';
import { uuid } from '../app/uuid';

/**
 * The default compass heading (degrees) for the launch rod and the wind: due
 * east, the kernel's own (`SimulationOptions` defaults `launchRodDirection`
 * and `windDirection` to PI/2). One constant, where `settings.ts` and this
 * file each carried the literal 90 in several places.
 */
export const DEFAULT_HEADING_DEG = 90;

export interface Simulation {
  id: string;
  name: string;
  /**
   * The flight configuration this simulation flies (services/flight/flightConfigs.ts):
   * which motor sits in which mount, and when each one ignites.
   *
   * A reference, not a copy. Several simulations can name one configuration, so
   * "C6 sustainer vs. D12 sustainer" is two configurations that rows point at
   * rather than two duplicated loadouts, and pointing a row at another setup is
   * one field rather than a motor per mount.
   */
  configId: string;
  launch: LaunchConditions;
  /** Cached last flight result (null until this simulation has ever been run). */
  result: FlightResult | null;
  /**
   * What `result` was flown from, as {@link resultKey} wrote it at dispatch.
   *
   * Whether the result is outdated is DERIVED from this ({@link isOutdated}),
   * never stored: an edit leaves the result readable, as OpenRocket does, and the
   * row reads outdated for as long as the current inputs differ from these.
   * Being a value rather than a set of object references, it survives a reload,
   * and an edit undone back to the flown value reads current again.
   */
  resultKey?: string;
  /**
   * Per-simulation overrides of the global run preferences (Settings ›
   * Simulation). Unset keys fall through to the global value, so a workspace
   * that never touches this behaves exactly as before.
   *
   * NOTE: these ride on the workspace autosave, not the `.ork` — that file has
   * never carried simulation options in either direction (`orkFile.ts` neither
   * reads nor writes them), so a round-trip through `.ork` drops them.
   */
  prefs?: Partial<SimPrefs>;
}

/**
 * Everything one simulation's flight is computed FROM, other than the design.
 *
 * A run takes a snapshot of these and posts it to a worker; by the time the
 * answer comes back the user may have changed any of them. Installing it then
 * would mark the row current while showing numbers from the inputs it replaced,
 * which is worse than no numbers at all. `runSims` captures this before
 * dispatch and compares it again at install time, the way it already does with
 * the design tree.
 *
 * Reference identity is the whole test, and it is enough because every store
 * action replaces these rather than mutating them (`patchTargets` and
 * `patchActiveConfig` spread). An edit that happens to restore the same value is
 * a different object and costs a run, which is the safe direction to be wrong in.
 */
export interface SimInputs {
  /**
   * The configuration this row flies, by object.
   *
   * Covers both halves at once: pointing the row at another setup hands back a
   * different configuration, and editing the setup replaces the object (every
   * store action spreads rather than mutating).
   */
  config: FlightConfig;
  launch: LaunchConditions;
  prefs: Partial<SimPrefs> | undefined;
}

export function simInputs(sim: Simulation, config: FlightConfig): SimInputs {
  return { config, launch: sim.launch, prefs: sim.prefs };
}

/** True when nothing a flight depends on has moved since `a` was captured. */
export function sameSimInputs(a: SimInputs, b: SimInputs): boolean {
  return a.config === b.config && a.launch === b.launch && a.prefs === b.prefs;
}

/**
 * The run preferences a flight actually reads: the row's own overrides over the
 * globals. The run and {@link resultKey} both use this, so what a result is
 * compared against is what it was flown with.
 */
export function effectivePrefs(globals: SimPrefs, own: Partial<SimPrefs> | undefined): SimPrefs {
  return { ...globals, ...own };
}

/**
 * JSON with object keys sorted, so equal values give equal strings whatever
 * order their keys were written in. `sanitizeSims` rebuilds a launch block as
 * `{ ...defaults, ...stored }` on every load, which reorders it. Keys named in
 * `skip` are left out at every depth.
 */
function stableJson(value: unknown, skip?: ReadonlySet<string>): string {
  return JSON.stringify(value, (key, v: unknown) => {
    if (skip?.has(key)) return undefined;
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, o[k]]),
    );
  });
}

const PART_NAME = new Set(['name']);
/** One key per tree object. A design edit replaces the tree, so every row of every render until then is a cache hit. */
const treeKeys = new WeakMap<RocketTree, string>();

/**
 * A key over everything about a design that can change a FLIGHT.
 *
 * Deliberately narrower than the tree object: the root carries `name`,
 * `designer`, `comment`, `revision` and `designType`, which are round-tripped to
 * the `.ork` and touch no physics, and every node carries a `name` that is a
 * label. So typing a designer name or renaming a part leaves results current.
 *
 * Everything else is treated as flight-bearing, including fields we may not know
 * about (`ComponentNode` has an open index signature). That is the safe
 * direction to be wrong in: a needless invalidation costs a re-run, a missed one
 * shows numbers for a rocket that no longer exists.
 */
export function flightKey(tree: RocketTree): string {
  let key = treeKeys.get(tree);
  if (key === undefined) {
    key = stableJson(tree.components, PART_NAME);
    treeKeys.set(tree, key);
  }
  return key;
}

/**
 * Everything one row's flight is computed from, as one comparable string: the
 * design ({@link flightKey}), the configuration (less its id and name), the launch
 * conditions, and the {@link effectivePrefs}. A row that pins a preference is
 * unaffected by the global one moving, because its override is what it reads.
 */
export function resultKey(tree: RocketTree, config: FlightConfig, sim: Simulation, globals: SimPrefs): string {
  const { id: _id, name: _name, ...flown } = config;
  const prefs = effectivePrefs(globals, sim.prefs);
  return stableJson([flightKey(tree), flown, sim.launch, SIM_PREF_KEYS.map((k) => prefs[k] ?? null)]);
}

/** The row has a result, and it was flown from inputs other than the current ones. */
export function isOutdated(sim: Simulation, tree: RocketTree, config: FlightConfig, globals: SimPrefs): boolean {
  return sim.result !== null && sim.resultKey !== resultKey(tree, config, sim, globals);
}

/** The flight the Results tab is drawing. */
export interface ResultFlight {
  id: string;
  name: string;
  result: FlightResult;
  /**
   * The conditions this flight was flown under, carried along rather than read
   * off the ACTIVE simulation by whoever draws it.
   *
   * The Results picker can be showing a flight from a different row than the
   * one being edited, so `selectActive(s).launch` is not reliably this flight's
   * launch site. The ground track draws map imagery at these coordinates, and
   * imagery centered on someone else's pad is worse than none.
   */
  launch: LaunchConditions;
}

/**
 * The flight the Results tab shows.
 *
 * `chosen` is the Results picker's own selection; NULL means "whichever
 * simulation is active", so opening Results reads the row you were just
 * working on.
 *
 * Falls back to the active simulation whenever the choice cannot be honored -
 * an id that no longer names a row, or one whose run has since been cleared -
 * because an empty Results tab with a chart frame and no data reads as a bug
 * rather than as a choice.
 */
export function resultFlight(
  sims: readonly Simulation[],
  chosen: string | null,
  activeId: string,
): ResultFlight | null {
  const pick = (id: string | null): ResultFlight | null => {
    const sim = id == null ? undefined : sims.find((x) => x.id === id);
    return sim?.result ? { id: sim.id, name: sim.name, result: sim.result, launch: sim.launch } : null;
  };
  return pick(chosen) ?? pick(activeId);
}

/** What the simulations table's status dot says about one row. */
export type SimStatus = 'notRun' | 'queued' | 'running' | 'failed' | 'outdated' | 'upToDate';

/**
 * Transient run state for ONE simulation, keyed by sim id in the store.
 *
 * Per-sim because the worker pool runs several flights at once, and because a
 * batch of twelve is queued all at once and starts a few at a time: "waiting its
 * turn" and "in the air" are different things a row has to be able to say.
 *
 * `failed` carries the design it failed ON, which is what stops auto-run
 * retrying a configuration already known to fail while still allowing a retry
 * the moment the design changes (see `selectRunFailed`).
 */
export type SimRun = { phase: 'queued' } | { phase: 'running' } | { phase: 'failed'; tree: RocketTree };

/**
 * The status of one simulation: its live run state if it has one, else what its
 * stored result says.
 *
 * A `failed` entry only counts against the design it was recorded on. On any
 * other design it is stale, and the row falls back to describing its result.
 */
export function simStatus(
  sim: Simulation,
  runs: Record<string, SimRun>,
  tree: RocketTree,
  outdated: boolean,
): SimStatus {
  const run = runs[sim.id];
  if (run?.phase === 'queued') return 'queued';
  if (run?.phase === 'running') return 'running';
  if (run?.phase === 'failed' && run.tree === tree) return 'failed';
  if (!sim.result) return 'notRun';
  return outdated ? 'outdated' : 'upToDate';
}

/** Globally-unique id for a new simulation — a UUID (like OpenRocket's own ids),
 *  so ids minted after a reload can't collide with persisted ones. */
function newSimId(): string {
  return uuid();
}

export function newSimulation(name: string, configId: string, launch: LaunchConditions): Simulation {
  return { id: newSimId(), name, configId, launch, result: null };
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Global simulation preferences applied to every run (see services/storage/settings.ts). */
export interface SimPrefs {
  timeStep: number;
  maxTime: number;
  /**
   * The most the rocket may rotate in one RK4 step, RADIANS. The stepper
   * shortens its step to respect it, so a smaller value buys accuracy through a
   * fast pitch-over without paying for it over the whole coast.
   */
  maxAngleStep: number;
  randomSeed: number | null;
  /** Recovery-deployment warning thresholds (m/s) - see SimulationSettings. */
  deploymentSpeedWarn: number;
  mainHighSpeedWarn: number;
  mainLowSpeedWarn: number;
  /** Drogue-side minimum, dual deployment only. */
  drogueLowSpeedWarn: number;
  /**
   * Which launch-guide clearance model to fly - see `SimulationSettings`. The
   * only member of this type that changes the FLIGHT rather than a warning
   * threshold, and the only reason it lives here is that `settings.simulation`
   * is handed to `runSims` as the prefs whole: there is no per-simulation
   * control for it, and a design does not carry one.
   */
  guideAwareRodClearance: boolean;
}

/**
 * Every {@link SimPrefs} key, at runtime.
 *
 * `SimPrefs` is exactly the settings a FLIGHT reads, which is what makes it the
 * right list for deciding whether a saved result still describes the current
 * ones: `SimulationSettings` also carries `confirmDelete` and `autoRunOutdated`
 * (interface only) and `railExitVelocityMin` (the rod-exit tile's color, never
 * passed to the engine), none of which can change a number.
 *
 * The check below is what keeps this honest. A type cannot be enumerated at
 * runtime, so this list is hand-written, and a key added to `SimPrefs` without
 * being added here would silently stop invalidating results. `EXHAUSTIVE` fails
 * to compile in that case.
 */
export const SIM_PREF_KEYS = [
  'timeStep',
  'maxTime',
  'maxAngleStep',
  'randomSeed',
  'deploymentSpeedWarn',
  'mainHighSpeedWarn',
  'mainLowSpeedWarn',
  'drogueLowSpeedWarn',
  'guideAwareRodClearance',
] as const satisfies readonly (keyof SimPrefs)[];

/** Compile-time proof that {@link SIM_PREF_KEYS} names every `SimPrefs` key. */
type EXHAUSTIVE =
  Exclude<keyof SimPrefs, (typeof SIM_PREF_KEYS)[number]> extends never
    ? true
    : ['SIM_PREF_KEYS is missing', Exclude<keyof SimPrefs, (typeof SIM_PREF_KEYS)[number]>];
const _exhaustive: EXHAUSTIVE = true;
void _exhaustive;

/**
 * Which flight-affecting preferences differ between two sets of GLOBALS.
 *
 * Compared key by key rather than by identity, because the settings object is
 * rebuilt on every unrelated change in the same store: switching a unit or a
 * part color hands out a new `simulation` object holding the same nine numbers,
 * and treating that as an edit would age every result on screen.
 */
export function changedPrefKeys(before: SimPrefs, after: SimPrefs): (keyof SimPrefs)[] {
  return SIM_PREF_KEYS.filter((k) => before[k] !== after[k]);
}

/**
 * A fresh seed for the wind turbulence, for when the user has not pinned one.
 *
 * This has to be minted HERE rather than left out of the payload. The engine
 * bridge reads `JsonLite.dbl(o, "randomSeed", 42)`, and an omitted key is not an
 * absent seed — it is the constant 42. So "auto" quietly meant "always 42": two
 * runs of the same turbulent-wind flight came back bit-identical, which is the
 * one thing a turbulence model exists to avoid. OpenRocket seeds from
 * `new Random().nextInt()` when `randomSeedFixed` is false; this is that.
 *
 * Signed 32-bit, because the bridge casts to a Java `int`.
 */
export const freshSeed = (): number => Math.floor(Math.random() * 2 ** 32) - 2 ** 31;

/**
 * Map UI launch conditions (+ global sim prefs) to the engine's simulate()
 * options (radians, kelvin, Pa).
 *
 * Takes a COMPLETE launch: the required fields are `number | null` in the
 * editor, because a cleared field has to be distinguishable from a typed zero,
 * and the type says that distinction is already resolved by the time anything
 * reaches the engine. `runSims` refuses an incomplete simulation before it gets
 * here (see services/flight/runnability), so this cannot invent a value to paper over
 * a blank -- which is exactly what the old `v ?? 0` coercion did.
 */
export function simConditions(launch: CompleteLaunch, prefs?: SimPrefs) {
  // "Launch into the wind" aims the rod at the surface wind heading, overriding
  // the manual rod direction. Multilevel wind: the SURFACE level is the lowest
  // altitude (safetyLimits.surfaceLevel), not `windLevels[0]`: levels are not
  // kept sorted, so a top-down profile would aim the rod at the wind aloft.
  const windDirDeg = surfaceLevel(launch)?.directionDeg ?? launch.windDirectionDeg ?? DEFAULT_HEADING_DEG;
  const rodDirDeg = launch.launchIntoWind ? windDirDeg : (launch.launchRodDirectionDeg ?? DEFAULT_HEADING_DEG);
  return {
    launchRodLength: launch.launchRodLengthM,
    launchRodAngle: rad(launch.launchRodAngleDeg),
    launchRodDirection: rad(rodDirDeg),
    windAverage: launch.windAverage,
    windStdDeviation: launch.windStdDev,
    windDirection: rad(launch.windDirectionDeg ?? DEFAULT_HEADING_DEG),
    windLevels: launch.windLevels?.map((l) => ({
      altitude: l.altitudeM,
      speed: l.speed,
      direction: rad(l.directionDeg),
      stddev: l.stddev,
    })),
    windAltitudeReference: launch.windAltitudeReference,
    geodetic: launch.geodetic,
    gravityModel: launch.gravityModel,
    constantGravity: launch.constantGravity,
    maxAngleStep: prefs?.maxAngleStep,
    launchAltitude: launch.launchAltitudeM,
    launchLatitude: launch.latitudeDeg,
    launchLongitude: launch.longitudeDeg,
    temperature: launch.temperatureC != null ? launch.temperatureC + 273.15 : undefined,
    pressure: launch.pressureHPa != null ? launch.pressureHPa * 100 : undefined,
    // Omitted rather than sent as standard when null: the bridge reads an absent
    // key as NaN and only leaves ISA when one of the three is actually given.
    relativeHumidity: launch.relativeHumidity ?? undefined,
    timeStep: prefs?.timeStep,
    maxTime: prefs?.maxTime,
    randomSeed: prefs?.randomSeed ?? freshSeed(),
    recoverySpeedWarn: prefs?.deploymentSpeedWarn,
    mainHighSpeedWarn: prefs?.mainHighSpeedWarn,
    mainLowSpeedWarn: prefs?.mainLowSpeedWarn,
    drogueLowSpeedWarn: prefs?.drogueLowSpeedWarn,
    guideAwareRodClearance: prefs?.guideAwareRodClearance,
    // EVERY series the branch records, not the friendly dozen.
    //
    // `summary` was the default here since the option existed, so a run kept 17
    // series out of the 69 the kernel had already computed - and the app could
    // never plot or export the rest, because it had never asked for them. That
    // is a strange thing to withhold: the work is done either way, the flight is
    // simulated the same, and only the serialization differs.
    //
    // Measured on a C6 flight at a 0.01 s step, three runs each: 509 ms and
    // 427 KB for `summary` against 596 ms and 1537 KB for `full`. 87 ms is not
    // worth two thirds of the flight data, and IndexedDB has room for the
    // payload. (An older comment in the bridge put the cost at ~45%; it is 17%.)
    series: 'full' as const,
  };
}
