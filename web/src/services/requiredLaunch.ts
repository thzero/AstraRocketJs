import type { LaunchConditions } from './orkTree';

/**
 * The launch fields a flight cannot be computed without.
 *
 * These are exactly the non-optional keys of {@link LaunchConditions}. Every
 * other launch field either has a defensible default (rod direction, Earth
 * model, gravity) or means something specific by its absence (blank temperature
 * and pressure mean ISA standard).
 *
 * Why this needs saying at all: the panel used to coerce a cleared field with
 * `v ?? 0`, so emptying the rod length stored ZERO. That reads as a real value
 * to everything downstream, and five of these six are legitimately zero -- rod
 * angle straight up, still air, no gusts, sea level, the equator -- so "the
 * user cleared it" and "the user meant 0" were the same state. They are now
 * stored as null and told apart here.
 */
export const REQUIRED_LAUNCH_KEYS = [
  'launchRodLengthM',
  'launchRodAngleDeg',
  'windAverage',
  'windStdDev',
  'launchAltitudeM',
  'latitudeDeg',
] as const satisfies readonly (keyof LaunchConditions)[];

export type RequiredLaunchKey = (typeof REQUIRED_LAUNCH_KEYS)[number];

/** A launch block with every required field actually present. */
export type CompleteLaunch = LaunchConditions & { [K in RequiredLaunchKey]: number };

/** True when this one field is filled in. Zero counts; blank and NaN do not. */
export const isFilled = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** The required keys this launch block is still missing, in panel order. */
export function missingRequired(launch: LaunchConditions): RequiredLaunchKey[] {
  return REQUIRED_LAUNCH_KEYS.filter((k) => !isFilled(launch[k]));
}

/** Narrowing guard: every required field is present, so a run can use them. */
export function isComplete(launch: LaunchConditions): launch is CompleteLaunch {
  return missingRequired(launch).length === 0;
}

/**
 * Fill any blank required field from `fallback`.
 *
 * For the SETTINGS copy of the launch panel, which edits the defaults a new
 * simulation is seeded from. A blank default would hand every future
 * simulation a hole, so there is nothing useful for "cleared" to mean there --
 * the field simply keeps what it had.
 */
export function withRequiredFrom(launch: LaunchConditions, fallback: CompleteLaunch): CompleteLaunch {
  const out = { ...launch } as CompleteLaunch;
  for (const k of REQUIRED_LAUNCH_KEYS) if (!isFilled(launch[k])) out[k] = fallback[k];
  return out;
}
