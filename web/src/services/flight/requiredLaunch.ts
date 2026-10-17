import type { LaunchConditions } from '../design/orkTree';

/**
 * The launch fields a flight cannot be computed without.
 *
 * These are exactly the non-optional keys of {@link LaunchConditions}. Every
 * other launch field either has a defensible default (rod direction, Earth
 * model, gravity) or means something specific by its absence (blank temperature
 * and pressure mean ISA standard).
 *
 * Stored as null when cleared, never coerced with `v ?? 0`: zero reads as a real
 * value to everything downstream, and six of these seven are legitimately zero
 * (rod angle straight up, still air, no gusts, sea level, the equator, the prime
 * meridian), so a coerced field makes "the user cleared it" and "the user meant
 * 0" the same state.
 */
export const REQUIRED_LAUNCH_KEYS = [
  'launchRodLengthM',
  'launchRodAngleDeg',
  'windAverage',
  'windStdDev',
  'launchAltitudeM',
  'latitudeDeg',
  'longitudeDeg',
] as const satisfies readonly (keyof LaunchConditions)[];

export type RequiredLaunchKey = (typeof REQUIRED_LAUNCH_KEYS)[number];

/**
 * A launch block with every required field actually present.
 *
 * With a multilevel profile the single wind is not flown and may be blank (see
 * {@link missingRequired}); the engine options treat an absent average as unused.
 */
export type CompleteLaunch = LaunchConditions & { [K in RequiredLaunchKey]: number };

/** True when this one field is filled in. Zero counts; blank and NaN do not. */
export const isFilled = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** The single-wind keys a multilevel profile replaces. */
const SINGLE_WIND_KEYS: ReadonlySet<RequiredLaunchKey> = new Set(['windAverage', 'windStdDev']);

/**
 * The required keys this launch block is still missing, in panel order.
 *
 * A multilevel profile flies the kernel's `MultiLevelPinkNoiseWindModel` and
 * never reads the single average and deviation (`SimulationOptions.getWindModel`),
 * and the panel hides those two fields while a profile is set, so they are not
 * required then.
 */
export function missingRequired(launch: LaunchConditions): RequiredLaunchKey[] {
  const multilevel = (launch.windLevels?.length ?? 0) > 0;
  return REQUIRED_LAUNCH_KEYS.filter((k) => !(multilevel && SINGLE_WIND_KEYS.has(k)) && !isFilled(launch[k]));
}

/** Narrowing guard: every required field is present, so a run can use them. */
export function isComplete(launch: LaunchConditions): launch is CompleteLaunch {
  return missingRequired(launch).length === 0;
}

/**
 * Fill any blank required field from `fallback`.
 *
 * For the settings copy of the launch panel, which edits the defaults a new
 * simulation is seeded from. A blank default would hand every future
 * simulation a hole, so there is nothing useful for "cleared" to mean there --
 * the field simply keeps what it had.
 */
export function withRequiredFrom(launch: LaunchConditions, fallback: CompleteLaunch): CompleteLaunch {
  const out = { ...launch } as CompleteLaunch;
  for (const k of REQUIRED_LAUNCH_KEYS) if (!isFilled(launch[k])) out[k] = fallback[k];
  return out;
}
