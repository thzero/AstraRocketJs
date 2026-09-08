/**
 * RECOVERY SIZING — the descent half of the recovery story.
 *
 * The Recovery-weight stat already answers WHAT comes down (loaded mass minus
 * the propellant that burns off). This answers what to hang it under: for a
 * given descent mass, what canopy diameter lands it inside the accepted
 * descent-rate bands, and how fast the currently-fitted chute actually brings
 * it down.
 *
 * It is `sqrt`-law arithmetic on one equation,
 *
 *     v = sqrt( 2 m g / (rho . Cd . A) ),   A = pi D^2 / 4
 *
 * so three inputs decide whether the answer is right: m (the descent mass),
 * rho (the air density at the LAUNCH SITE, not sea level) and the canopy's
 * Cd.A. Each is handled below.
 *
 * Scope note: this is deliberately the SIZE answer only — the diameter and the
 * rate — not a catalogue of real parachutes to buy. The app carries no chute
 * preset catalogue, so matching named canopies is out of scope here.
 */

/** Standard gravity, m/s^2 (CODATA / the kernel's own g0). */
export const G0 = 9.80665;

/** Feet per second in m/s — the bands are quoted in ft/s, the code is SI. */
export const FT_S = 0.3048;

/** Specific gas constant of dry air, J/(kg.K) — the kernel's own value. */
const R_AIR = 287.053;

// ISA sea-level reference and troposphere lapse rate.
const T0 = 288.15; // K
const P0 = 101325; // Pa
const RHO0 = 1.225; // kg/m^3
const LAPSE = 0.0065; // K/m (positive)

/** The launch-condition fields this module reads (a structural subset). */
export interface SizingLaunch {
  launchAltitudeM?: number;
  /** Site temperature override, deg C, or null to use the ISA value. */
  temperatureC?: number | null;
  /** Site pressure override, hPa, or null to use the ISA value. */
  pressureHPa?: number | null;
}

/**
 * Air density at the launch site (kg/m^3). Descent happens at the field, not
 * at sea level, and it matters: rho falls ~14 % by 5,000 ft and v goes as
 * 1/sqrt(rho), so the same canopy lands ~8 % faster there. Uses the ISA model
 * from the site altitude, with explicit temperature / pressure overrides when
 * the launch conditions carry them.
 */
export function airDensity(launch?: SizingLaunch | null): number {
  if (!launch) return RHO0;
  const h = launch.launchAltitudeM ?? 0;
  const tIsa = T0 - LAPSE * h;
  const pIsa = P0 * Math.pow(tIsa / T0, G0 / (R_AIR * LAPSE));
  const t = launch.temperatureC != null ? launch.temperatureC + 273.15 : tIsa;
  const p = launch.pressureHPa != null ? launch.pressureHPa * 100 : pIsa;
  if (!(t > 0) || !(p > 0)) return RHO0;
  return p / (R_AIR * t);
}

/** Propellant a motor expels — loaded minus burnout mass (0 without a curve). */
export function propellantMass(m: { masses?: number[] } | null | undefined): number {
  const ms = m?.masses;
  return ms && ms.length ? Math.max(0, ms[0]! - ms[ms.length - 1]!) : 0;
}

/**
 * Descent mass (kg): loaded mass minus every motor's expelled propellant.
 * Returns null when no motor is loaded (nothing burns off, so there is no
 * distinct descent mass to size against) or the loaded mass is unknown.
 */
export function descentMass(
  loadedMassKg: number | null | undefined,
  motors: Array<{ masses?: number[] } | null | undefined>,
): number | null {
  if (loadedMassKg == null) return null;
  let propellant = 0;
  for (const m of motors) propellant += propellantMass(m);
  return propellant > 0 ? loadedMassKg - propellant : null;
}

/** Descent rate (m/s) of a canopy of diameter D (m) and drag coefficient Cd. */
export function descentRate(massKg: number, diameterM: number, cd: number, rho: number): number {
  const area = (Math.PI * diameterM * diameterM) / 4;
  if (!(area > 0) || !(cd > 0) || !(rho > 0)) return Infinity;
  return Math.sqrt((2 * massKg * G0) / (rho * cd * area));
}

/** Canopy diameter (m) that lands `massKg` at descent rate `rateMs` (m/s). */
export function canopyDiameter(massKg: number, rateMs: number, cd: number, rho: number): number {
  if (!(rateMs > 0) || !(cd > 0) || !(rho > 0)) return Infinity;
  const area = (2 * massKg * G0) / (rho * cd * rateMs * rateMs);
  return Math.sqrt((4 * area) / Math.PI);
}

/** m/s -> ft/s, for display alongside the SI value. */
export const msToFtS = (v: number): number => v / FT_S;

/** An accepted descent-rate window, plus the rate the SIZE line targets. */
export interface Band {
  key: 'main' | 'drogue';
  /** Slow edge of the accepted window (m/s). */
  min: number;
  /** Fast edge of the accepted window (m/s). */
  max: number;
  /** The rate the recommended diameter is computed at (m/s). */
  target: number;
}

/** Main descent: 15-20 ft/s, sized at 18 (toward the fast, less-drift end). */
export const MAIN_BAND: Band = { key: 'main', min: 15 * FT_S, max: 20 * FT_S, target: 18 * FT_S };

/** Drogue / high-speed descent: 50-75 ft/s, sized at 60. */
export const DROGUE_BAND: Band = { key: 'drogue', min: 50 * FT_S, max: 75 * FT_S, target: 60 * FT_S };

export const BANDS: Band[] = [MAIN_BAND, DROGUE_BAND];

/** Where a descent rate falls relative to the accepted bands. */
export type RateVerdict = 'slow' | 'main' | 'between' | 'drogue' | 'fast';

/** Classify a descent rate against the main / drogue windows. */
export function classifyRate(rateMs: number): RateVerdict {
  if (rateMs < MAIN_BAND.min) return 'slow';
  if (rateMs <= MAIN_BAND.max) return 'main';
  if (rateMs < DROGUE_BAND.min) return 'between';
  if (rateMs <= DROGUE_BAND.max) return 'drogue';
  return 'fast';
}
