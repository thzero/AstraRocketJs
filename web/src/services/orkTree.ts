import type { ComponentNode, RocketTree } from '../engine/openRocketEngine';

let counter = 1;

/** A fresh editor/kernel node id (also used by setMotorById). */
export function freshId(): string {
  return `c${counter++}`;
}

/**
 * Tree components as a stage-node list. A flat tree (no explicit stages) is
 * wrapped into one implicit Sustainer stage; already-staged trees pass through.
 */
export function asStageNodes(tree: RocketTree): ComponentNode[] {
  return tree.components.every((c) => c.type === 'stage')
    ? tree.components
    : [{ type: 'stage', name: 'Sustainer', children: tree.components } as ComponentNode];
}

/** Launch conditions parsed from a .ork's first `<simulation>` `<conditions>`. */
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
   * What a wind level's altitude is measured FROM. OpenRocket's
   * `MultiLevelPinkNoiseWindModel.AltitudeReference`, defaulting to MSL as the
   * kernel's constructor does. It only means something with `windLevels` set.
   *
   * A sounding is published MSL, but a range briefing is given AGL, and at a
   * 1500 m site the two are different winds entirely.
   */
  windAltitudeReference?: 'msl' | 'agl';
  launchAltitudeM: number | null;
  latitudeDeg: number | null;
  /** Launch-site longitude, degrees (WGS84 Coriolis; optional). */
  /**
   * Required like the latitude, and `null` when cleared rather than absent.
   *
   * It was optional while nothing on screen could show what it meant; the
   * launch-site map made a wrong one visible, and a blank one is a hole in the
   * same place the latitude is. Null rather than undefined so that clearing it
   * SURVIVES a reload: `JSON.stringify` drops an undefined property, so the
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
   * Relative humidity as a FRACTION (0..1), like the kernel's own field, or
   * null for the ISA standard. Water vapor is lighter than dry air, so a humid
   * pad is a slightly thinner one.
   */
  relativeHumidity?: number | null;
}
