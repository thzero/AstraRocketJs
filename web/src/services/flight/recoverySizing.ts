import { LAUNCH_SI } from '../../prefs/launchUnits';
import { uiToSi } from '../../prefs/units';
import { G0 } from '../motors/motorMath';
import type { AtmosphereLevel } from '../design/orkTree';
import { usableAtmosphereLevels } from './atmosphereLevels';
/**
 * Recovery sizing: the descent half of the recovery story.
 *
 * The Recovery-weight stat answers what comes down (loaded mass minus
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
 * rho (the air density at the launch site, not sea level) and the canopy's
 * Cd.A. Each is handled below.
 *
 * Scope: this is the size answer only (the diameter and the rate), not a
 * catalog of real parachutes to buy. The app carries no chute
 * preset catalog, so matching named canopies is out of scope here.
 */

/** Feet per second in m/s: the bands are quoted in ft/s, the code is SI. */
const FT_S = uiToSi('velocity', 'ft/s', 1);

/** Specific gas constant of dry air, J/(kg.K), the kernel's own value. */
const R_AIR = 287.053;

// ISA sea-level reference and troposphere lapse rate.
const T0 = 288.15; // K
const P0 = 101325; // Pa
const RHO0 = 1.225; // kg/m^3
const LAPSE = 0.0065; // K/m (positive)

/** The launch-condition fields this module reads (a structural subset). */
export interface SizingLaunch {
  /** Null while the user has the field cleared; `airDensity` reads it as sea level. */
  launchAltitudeM?: number | null;
  /** Site temperature override, deg C, or null to use the ISA value. */
  temperatureC?: number | null;
  /** Site pressure override, hPa, or null to use the ISA value. */
  pressureHPa?: number | null;
  /**
   * Site relative humidity as a fraction, or null for the kernel's 0.
   *
   * Read only to decide which air the flight is flying (see `airDensity`); the
   * density below is dry-air. The kernel's own humidity term raises the gas
   * constant by about a percent at 30 degrees C and saturation
   * (`AtmosphericConditions.getGasConstant`), which is inside this block's
   * stated accuracy and not worth a second copy of that formula.
   */
  relativeHumidity?: number | null;
  /** Forecast levels the flight flies through, if the launch carries any. */
  atmosphereLevels?: readonly AtmosphereLevel[];
}

/**
 * Air density at the launch site (kg/m^3). Descent happens at the field, not
 * at sea level, and it matters: rho falls ~14 % by 5,000 ft and v goes as
 * 1/sqrt(rho), so the same canopy lands ~8 % faster there.
 *
 * The rule is the flight's, not one chosen here, because a sizing panel that
 * sizes for air the rocket will not fly in is worse than one that says
 * nothing. The bridge (`api/OpenRocketEngine.simulate`) decides it in three
 * branches, and all three are mirrored below:
 *
 *   Forecast levels set, and the site temperature or pressure blank: the
 *   levels alone (`AtmosphereProfile`), read at the site altitude. See
 *   {@link profileDensity}. With both site values set, the site anchors the
 *   bottom of the profile, so the air at the pad is the site's own values: the
 *   custom branch below gives the same number.
 *
 *   Nothing set: standard ISA, which at the pad is the ISA value for the site
 *   altitude.
 *
 *   Any one of temperature, pressure or humidity set: an `ExtendedISAModel`
 *   anchored at the site altitude, where a field left blank is filled with the
 *   sea-level standard constant rather than with the ISA value for that
 *   altitude. Humidity alone switches branches.
 *
 * The second branch only differs away from sea level. At a 2,682 m field with
 * 30 C typed and the pressure left blank, filling the blank from the site
 * altitude would give 0.8388 kg/m^3 where the flight flies 1.1644, and a
 * descent rate 18 % apart. At sea level the two branches agree exactly.
 */
export function airDensity(launch?: SizingLaunch | null): number {
  if (!launch) return RHO0;
  const h = launch.launchAltitudeM ?? 0;
  const anchored = launch.temperatureC != null && launch.pressureHPa != null;
  const levels = launch.atmosphereLevels?.length ? usableAtmosphereLevels(launch.atmosphereLevels) : [];
  if (levels.length && !anchored) return profileDensity(levels, h);
  const custom = launch.temperatureC != null || launch.pressureHPa != null || launch.relativeHumidity != null;
  const { t: tIsa, p: pIsa } = isaAt(h);
  // T0 / P0 are the kernel's own ExtendedISAModel.STANDARD_TEMPERATURE and
  // STANDARD_PRESSURE; a blank in the custom branch is filled with those.
  const t = launch.temperatureC != null ? LAUNCH_SI.degC.toSi(launch.temperatureC) : custom ? T0 : tIsa;
  const p = launch.pressureHPa != null ? LAUNCH_SI.hPa.toSi(launch.pressureHPa) : custom ? P0 : pIsa;
  if (!(t > 0) || !(p > 0)) return RHO0;
  return p / (R_AIR * t);
}

/** ISA reference Earth radius (m), for the geopotential altitude. */
const ISA_EARTH_RADIUS = 6356766;
/** Spacing (m) of the kernel's precomputed standard-atmosphere table. */
const ISA_TABLE_STEP = 500;
/** The tropopause: geopotential altitude (m) and temperature (K). */
const H_TROPOPAUSE = 11000;
const T_TROPOPAUSE = T0 - LAPSE * H_TROPOPAUSE;
const P_TROPOPAUSE = P0 * Math.pow(T_TROPOPAUSE / T0, G0 / (R_AIR * LAPSE));

/** The standard atmosphere's exact values at geometric altitude `h` m, up to 20 km. */
function isaExact(h: number): { t: number; p: number } {
  const geo = Math.min((ISA_EARTH_RADIUS * h) / (ISA_EARTH_RADIUS + h), 20000);
  if (geo < H_TROPOPAUSE) {
    const t = T0 - LAPSE * geo;
    return { t, p: P0 * Math.pow(t / T0, G0 / (R_AIR * LAPSE)) };
  }
  // 11 to 20 km is isothermal.
  return { t: T_TROPOPAUSE, p: P_TROPOPAUSE * Math.exp((-(geo - H_TROPOPAUSE) * G0) / (R_AIR * T_TROPOPAUSE)) };
}

/**
 * Standard-atmosphere temperature (K) and pressure (Pa) at `h` m, as the
 * kernel's ExtendedISAModel reads it: exact values every 500 m (geopotential
 * altitude), linear in between, and sea level at or below 0.
 */
function isaAt(h: number): { t: number; p: number } {
  if (!(h > 0)) return isaExact(0);
  const i = Math.floor(h / ISA_TABLE_STEP);
  const f = (h - i * ISA_TABLE_STEP) / ISA_TABLE_STEP;
  const lo = isaExact(i * ISA_TABLE_STEP);
  const hi = isaExact((i + 1) * ISA_TABLE_STEP);
  return { t: lo.t + (hi.t - lo.t) * f, p: lo.p + (hi.p - lo.p) * f };
}

/**
 * Air density (kg/m^3) at `h` m in a forecast profile, as the bridge's
 * `AtmosphereProfile.getConditions` computes it. Between two levels the
 * temperature is linear in altitude and the pressure is linear in its
 * logarithm. Below the lowest level or above the highest, the standard
 * atmosphere's change from that level is applied to its values.
 *
 * `levels` are the usable ones, lowest first (`usableAtmosphereLevels`).
 */
function profileDensity(levels: readonly AtmosphereLevel[], h: number): number {
  const tK = (l: AtmosphereLevel) => LAUNCH_SI.degC.toSi(l.temperatureC);
  const pPa = (l: AtmosphereLevel) => LAUNCH_SI.hPa.toSi(l.pressureHPa);
  const first = levels[0]!;
  const last = levels[levels.length - 1]!;
  let t: number;
  let p: number;
  const outside = h <= first.altitudeM ? first : h >= last.altitudeM ? last : null;
  if (outside) {
    const atLevel = isaAt(outside.altitudeM);
    const atH = isaAt(h);
    t = tK(outside) + (atH.t - atLevel.t);
    p = pPa(outside) * (atH.p / atLevel.p);
  } else {
    let i = 0;
    while (levels[i + 1]!.altitudeM < h) i++;
    const lo = levels[i]!;
    const hi = levels[i + 1]!;
    const f = (h - lo.altitudeM) / (hi.altitudeM - lo.altitudeM);
    t = tK(lo) + (tK(hi) - tK(lo)) * f;
    p = Math.exp(Math.log(pPa(lo)) + (Math.log(pPa(hi)) - Math.log(pPa(lo))) * f);
  }
  return t > 0 && p > 0 ? p / (R_AIR * t) : RHO0;
}

/** Propellant a motor expels: loaded minus burnout mass (0 without a curve). */
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
  if (propellant <= 0) return null;
  // Propellant exceeding loaded mass is a data error (a bad motor curve): a
  // negative descent mass is meaningless and would sqrt→NaN downstream, so
  // treat it as "no distinct descent mass" rather than passing it on.
  const dm = loadedMassKg - propellant;
  return dm > 0 ? dm : null;
}

/** Descent rate (m/s) of a canopy of diameter D (m) and drag coefficient Cd. */
export function descentRate(massKg: number, diameterM: number, cd: number, rho: number): number {
  const area = (Math.PI * diameterM * diameterM) / 4;
  if (!(massKg > 0) || !(area > 0) || !(cd > 0) || !(rho > 0)) return Infinity;
  return Math.sqrt((2 * massKg * G0) / (rho * cd * area));
}

/** Canopy diameter (m) that lands `massKg` at descent rate `rateMs` (m/s). */
export function canopyDiameter(massKg: number, rateMs: number, cd: number, rho: number): number {
  if (!(massKg > 0) || !(rateMs > 0) || !(cd > 0) || !(rho > 0)) return Infinity;
  const area = (2 * massKg * G0) / (rho * cd * rateMs * rateMs);
  return Math.sqrt((4 * area) / Math.PI);
}

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
