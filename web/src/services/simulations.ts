// A named simulation = one flight setup over the shared rocket design: its own
// motor (primary mount) + launch conditions + last result. The right panel is a
// list of these; switching the active one drives the stability readout and sim.
import type { MotorSpec, FlightResult, IgnitionEvent } from '../engine/openRocketEngine';
import type { MountMotor } from './loadOrk';
import type { LaunchConditions } from './orkTree';
import type { CompleteLaunch } from './requiredLaunch';
import { uuid } from './uuid';

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

/** What the simulations table's status dot says about one row. */
export type SimStatus = 'notRun' | 'running' | 'failed' | 'outdated' | 'upToDate';

/**
 * The status of one simulation. `runningId` / `failedId` come from the store —
 * only ONE of each exists today (a single in-flight run), which is exactly what
 * the worker pool is expected to generalize.
 */
export function simStatus(sim: Simulation, ctx: { runningId: string | null; failedId: string | null }): SimStatus {
  if (ctx.runningId === sim.id) return 'running';
  if (ctx.failedId === sim.id) return 'failed';
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
  // the manual rod direction. Multilevel wind → use the lowest (surface) level.
  const windDirDeg = launch.windLevels?.[0]?.directionDeg ?? launch.windDirectionDeg ?? 90;
  const rodDirDeg = launch.launchIntoWind ? windDirDeg : (launch.launchRodDirectionDeg ?? 90);
  return {
    launchRodLength: launch.launchRodLengthM,
    launchRodAngle: rad(launch.launchRodAngleDeg),
    launchRodDirection: rad(rodDirDeg),
    windAverage: launch.windAverage,
    windStdDeviation: launch.windStdDev,
    windDirection: rad(launch.windDirectionDeg ?? 90),
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
    series: 'summary' as const,
  };
}
