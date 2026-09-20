// A named simulation = one flight setup over the shared rocket design: its own
// motor (primary mount) + launch conditions + last result. The right panel is a
// list of these; switching the active one drives the stability readout and sim.
import type { MotorSpec, FlightResult, IgnitionEvent, RocketTree } from '../engine/openRocketEngine';
import type { MountMotor } from './loadOrk';
import type { LaunchConditions } from './orkTree';
import type { CompleteLaunch } from './requiredLaunch';
import { surfaceLevel } from './safetyLimits';
import { uuid } from './uuid';

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
  motor: MotorSpec;
  /** When the primary mount's motor ignites (undefined = automatic / at launch). */
  ignitionEvent?: IgnitionEvent;
  /** Seconds after the ignition event (default 0). */
  ignitionDelay?: number;
  /**
   * Motors for every NON-primary mount, keyed by mount id — the rest of this
   * simulation's motor loadout. Together with `motor` and the ignition fields
   * above, this is OpenRocket's "flight configuration": the whole set of motors
   * a given simulation flies.
   *
   * It used to be one workspace-level map shared by every simulation, which
   * meant a multi-mount or staged rocket could only ever be flown one way —
   * changing an upper-stage motor changed it for every simulation at once, and
   * so had to age all of their results. Per simulation, "C6 sustainer vs. D12
   * sustainer" is two rows in the table.
   */
  extraMotors: Record<string, MountMotor>;
  launch: LaunchConditions;
  /** Cached last flight result (null until this simulation has ever been run). */
  result: FlightResult | null;
  /**
   * The cached result no longer matches the inputs.
   *
   * An edit used to NULL every result outright, which is why the Results tab had
   * to appear and disappear and why you could not compare a change against the
   * run that preceded it. OpenRocket instead keeps the numbers and flags them,
   * and so do we: the result stays readable, the status column goes amber, and
   * re-running clears it.
   */
  outdated?: boolean;
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
 * action replaces these rather than mutating them (`patchActive` / `patchTargets`
 * spread). An edit that happens to restore the same value is a different object
 * and costs a run, which is the safe direction to be wrong in.
 */
export interface SimInputs {
  motor: MotorSpec;
  extraMotors: Record<string, MountMotor>;
  launch: LaunchConditions;
  prefs: Partial<SimPrefs> | undefined;
  ignitionEvent: IgnitionEvent | undefined;
  ignitionDelay: number | undefined;
}

export function simInputs(sim: Simulation): SimInputs {
  return {
    motor: sim.motor,
    extraMotors: sim.extraMotors,
    launch: sim.launch,
    prefs: sim.prefs,
    ignitionEvent: sim.ignitionEvent,
    ignitionDelay: sim.ignitionDelay,
  };
}

/** True when nothing a flight depends on has moved since `a` was captured. */
export function sameSimInputs(a: SimInputs, b: SimInputs): boolean {
  return (
    a.motor === b.motor &&
    a.extraMotors === b.extraMotors &&
    a.launch === b.launch &&
    a.prefs === b.prefs &&
    a.ignitionEvent === b.ignitionEvent &&
    a.ignitionDelay === b.ignitionDelay
  );
}

/** The flight the Results tab is drawing. */
export interface ResultFlight {
  id: string;
  name: string;
  result: FlightResult;
}

/**
 * The flight the Results tab shows.
 *
 * `chosen` is the Results picker's own selection; NULL means "whichever
 * simulation is active", which is what the tab did before the picker existed
 * and the right default - open Results and you are reading the row you were
 * just working on.
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
    return sim?.result ? { id: sim.id, name: sim.name, result: sim.result } : null;
  };
  return pick(chosen) ?? pick(activeId);
}

/** What the simulations table's status dot says about one row. */
export type SimStatus = 'notRun' | 'queued' | 'running' | 'failed' | 'outdated' | 'upToDate';

/**
 * Transient run state for ONE simulation, keyed by sim id in the store.
 *
 * It is per-sim because the worker pool runs several flights at once: a single
 * `runningId` could only ever name one of four, and a batch of twelve is queued
 * all at once and starts a few at a time, so "waiting its turn" and "in the air"
 * are different things a row has to be able to say.
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
export function simStatus(sim: Simulation, runs: Record<string, SimRun>, tree: RocketTree): SimStatus {
  const run = runs[sim.id];
  if (run?.phase === 'queued') return 'queued';
  if (run?.phase === 'running') return 'running';
  if (run?.phase === 'failed' && run.tree === tree) return 'failed';
  if (!sim.result) return 'notRun';
  return sim.outdated ? 'outdated' : 'upToDate';
}

/** Globally-unique id for a new simulation — a UUID (like OpenRocket's own ids),
 *  so ids minted after a reload can't collide with persisted ones. */
function newSimId(): string {
  return uuid();
}

export function newSimulation(name: string, motor: MotorSpec, launch: LaunchConditions): Simulation {
  return { id: newSimId(), name, motor, launch, result: null, extraMotors: {} };
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Global simulation preferences applied to every run (see services/settings.ts). */
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
const freshSeed = (): number => Math.floor(Math.random() * 2 ** 32) - 2 ** 31;

/**
 * Map UI launch conditions (+ global sim prefs) to the engine's simulate()
 * options (radians, kelvin, Pa).
 *
 * Takes a COMPLETE launch: the required fields are `number | null` in the
 * editor, because a cleared field has to be distinguishable from a typed zero,
 * and the type says that distinction is already resolved by the time anything
 * reaches the engine. `runSims` refuses an incomplete simulation before it gets
 * here (see services/runnability), so this cannot invent a value to paper over
 * a blank -- which is exactly what the old `v ?? 0` coercion did.
 */
export function simConditions(launch: CompleteLaunch, prefs?: SimPrefs) {
  // "Launch into the wind" aims the rod at the surface wind heading, overriding
  // the manual rod direction. Multilevel wind: the SURFACE level is the lowest
  // altitude (safetyLimits.surfaceLevel), not `windLevels[0]`; levels are not
  // kept sorted, and a top-down profile used to aim the rod at the wind aloft.
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
