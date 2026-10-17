import i18n from '../../i18n';
import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';

let counter = 1;

/** A fresh node id for a part read from a file; the kernel bridge addresses the
 *  part by the same id (setMotorById and the other *ById calls). */
export function freshId(): string {
  return `c${counter++}`;
}

/**
 * Tree components as a stage-node list. A flat tree (no explicit stages) is
 * wrapped into one implicit first stage, named by {@link defaultStageName};
 * already-staged trees pass through.
 */
export function asStageNodes(tree: RocketTree): ComponentNode[] {
  return tree.components.every((c) => c.type === 'stage')
    ? tree.components
    : [{ type: 'stage', name: defaultStageName(0), children: tree.components }];
}

/**
 * The name a file gives an unnamed stage: "Sustainer" for the first, "Booster n"
 * after it, as the `.ork` and `.rkt` readers, the writers and a new design name
 * them. File text, not a display label (that is `stageLabel` in
 * i18n/format.ts), but in the UI language: desktop OpenRocket names a new
 * design's stage from its own translations (`BasicFrame.StageName.Sustainer`)
 * and writes that name into the file, so a design made in German says so in
 * German either way.
 */
export const defaultStageName = (i: number): string =>
  i === 0 ? i18n.t('stageName.sustainer') : i18n.t('stageName.booster', { n: i });

/** A stage's name as a file states it: its own, else {@link defaultStageName}. */
export const stageFileName = (st: ComponentNode, i: number): string =>
  typeof st.name === 'string' ? st.name : defaultStageName(i);

/** One altitude level of a layered wind profile. */
export interface WindLevel {
  /** Altitude MSL, meters. */
  altitudeM: number;
  /** Wind speed, m/s. */
  speed: number;
  /** Wind heading, degrees. */
  directionDeg: number;
  /** Gust std-deviation, m/s. */
  stddev: number;
}

/**
 * One level of a forecast atmosphere: what the air is at one altitude, from a
 * weather model's pressure levels. With any present, the engine flies these in
 * place of the standard atmosphere above the site (bridge AtmosphereProfile).
 */
export interface AtmosphereLevel {
  /** Altitude MSL, meters. */
  altitudeM: number;
  temperatureC: number;
  pressureHPa: number;
  /** Relative humidity as a fraction (0..1). */
  relativeHumidity: number;
}

/**
 * An edit to launch conditions: a patch, or a function that makes one from a
 * row's own conditions and its id. An edit of several simulations at once
 * applies it to each, so a value worked out from the row (a deviation recomputed
 * to keep its turbulence, a profile seeded from its wind) is worked out from
 * that row rather than copied from the one on screen.
 */
export type LaunchPatch =
  Partial<LaunchConditions> | ((launch: LaunchConditions, rowId: string) => Partial<LaunchConditions>);

/** `p` as the patch it makes for one row. */
export const launchPatchFor = (p: LaunchPatch, launch: LaunchConditions, rowId: string): Partial<LaunchConditions> =>
  typeof p === 'function' ? p(launch, rowId) : p;

/**
 * A stored or file launch laid over the defaults, which fill the fields it
 * lacks. The wind profiles and the forecast atmosphere are the exception: they
 * come from `launch` alone. A launch without a flown profile flies the Average
 * model, and taking the defaults' would turn it into a multilevel flight; one
 * without a kept profile has none, and taking the defaults' would write a
 * profile into a file that never had it. A launch without forecast levels
 * flies the standard atmosphere: desktop never writes `<forecastlevel>`, and
 * a cleared forecast is stored as no levels. With no launch at all there is
 * nothing to override, and the defaults stand whole, as they do for a new
 * simulation.
 */
export const overLaunchDefaults = (
  defaults: LaunchConditions,
  launch: Partial<LaunchConditions> | undefined,
): LaunchConditions => {
  const out = { ...defaults, ...launch };
  if (!launch) return out;
  if (launch.windLevels === undefined) delete out.windLevels;
  if (launch.keptWindLevels === undefined) delete out.keptWindLevels;
  if (launch.atmosphereLevels === undefined) delete out.atmosphereLevels;
  return out;
};

/** Launch conditions, in the shape a .ork's `<simulation>` `<conditions>` is parsed into. */
export interface LaunchConditions {
  launchRodLengthM: number | null;
  launchRodAngleDeg: number | null;
  /** Launch-rod compass heading, degrees. Ignored when launchIntoWind is set. */
  launchRodDirectionDeg?: number;
  /** When true, aim the rod into the wind (overrides the rod direction). */
  launchIntoWind?: boolean;
  windAverage: number | null;
  windStdDev: number | null;
  /** Wind heading, degrees (single-wind model). */
  windDirectionDeg?: number;
  /** Altitude-layered wind profile (24.x multilevel); overrides the single wind. */
  windLevels?: WindLevel[];
  /**
   * The multilevel profile held while the Average model is selected. Never
   * flown: `simConditions` reads `windLevels` alone and `resultKey` leaves this
   * out. The desktop keeps its multilevel model beside the average one and
   * `<windmodeltype>` only picks between them, so a file saved with Average
   * selected still carries the profile (OpenRocketSaver writes it whenever it
   * has levels), and switching back to Multilevel shows it again. Absent while
   * `windLevels` is set: there is one profile, in one place.
   */
  keptWindLevels?: WindLevel[];
  /**
   * What a wind level's altitude is measured from. OpenRocket's
   * `MultiLevelPinkNoiseWindModel.AltitudeReference`, defaulting to MSL as the
   * kernel's constructor does. It only means something with `windLevels` set.
   *
   * A sounding is published MSL, but a range briefing is given AGL, and at a
   * 1500 m site the two are different winds entirely.
   */
  windAltitudeReference?: 'msl' | 'agl';
  launchAltitudeM: number | null;
  latitudeDeg: number | null;
  /**
   * Launch-site longitude, degrees. Required like the latitude, and `null` when
   * cleared rather than absent.
   *
   * The launch-site map makes a wrong one visible, and a blank one is a hole in
   * the same place the latitude is. Null rather than undefined so that clearing
   * it survives a reload: `JSON.stringify` drops an undefined property, so the
   * persisted workspace merge would quietly hand the field its default back.
   */
  longitudeDeg: number | null;
  /** Earth model for the trajectory. */
  geodetic?: 'flat' | 'spherical' | 'wgs84';
  /**
   * Gravity model. 'wgs' (the default) varies g with latitude and altitude;
   * 'constant' holds it at {@link constantGravity}, which is what you want when
   * checking against a hand calculation that assumed one number.
   */
  gravityModel?: 'wgs' | 'constant';
  /** g in m/s^2, used only when `gravityModel` is 'constant'. */
  constantGravity?: number;
  /** null when the file declares the ISA standard atmosphere. */
  temperatureC: number | null;
  /** null when the file declares the ISA standard atmosphere. */
  pressureHPa: number | null;
  /**
   * Relative humidity as a fraction (0..1), like the kernel's own field, or
   * null for the ISA standard. Water vapor is lighter than dry air, so a humid
   * pad is a slightly thinner one.
   */
  relativeHumidity?: number | null;
  /**
   * A forecast atmosphere above the site, from the Weather dialog. When the
   * site's temperature and pressure are both set, the site is the profile's
   * lowest level and the engine drops any level at or below it; otherwise the
   * levels stand alone. Absent or empty is the standard atmosphere.
   */
  atmosphereLevels?: AtmosphereLevel[];
  /**
   * Where the weather-filled fields came from, written by the Weather dialog's
   * Apply. Describes the other fields and is never flown: `resultKey` leaves it
   * out, so a refresh that changes no value leaves results current.
   */
  weatherSource?: WeatherSource;
}

/** The forecast a simulation's launch conditions were filled from. */
export interface WeatherSource {
  provider: 'open-meteo';
  endpoint: 'forecast' | 'archive';
  /** The site-calendar date and hour (0..23) asked for, in `timezone`. */
  date: string;
  hour: number;
  timezone: string;
  /** Where it was asked for. A site moved since is a different forecast. */
  latitudeDeg: number;
  longitudeDeg: number;
  elevationM: number;
  /** The hour the values are for, ISO 8601. */
  validAt: string;
  /** When it was fetched, ISO 8601. */
  fetchedAt: string;
  /** The dialog groups that were applied. */
  groups: ('temperature' | 'pressure' | 'humidity' | 'wind' | 'atmosphere')[];
  /** Whether the forecast's terrain elevation was applied as the site altitude. */
  elevationApplied: boolean;
  /**
   * The values Apply wrote, to tell whether any has been edited since. Absent
   * when read from a file, which records the answer as `edited` instead.
   */
  applied?: Partial<LaunchConditions>;
  /** Set when a file says the values were edited after they were applied. */
  edited?: true;
}
