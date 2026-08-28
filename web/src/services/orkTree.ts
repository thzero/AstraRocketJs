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
  /** Altitude MSL, metres. */
  altitudeM: number;
  /** Wind speed, m/s. */
  speed: number;
  /** Wind heading, degrees. */
  directionDeg: number;
  /** Gust std-deviation, m/s. */
  stddev: number;
}

export interface LaunchConditions {
  launchRodLengthM: number;
  launchRodAngleDeg: number;
  /** Launch-rod compass heading, degrees. Ignored when launchIntoWind is set. */
  launchRodDirectionDeg?: number;
  /** When true, aim the rod into the wind (overrides the rod direction). */
  launchIntoWind?: boolean;
  windAverage: number;
  windStdDev: number;
  /** Wind heading, degrees (single-wind model). */
  windDirectionDeg?: number;
  /** Altitude-layered wind profile (24.x multilevel); overrides the single wind. */
  windLevels?: WindLevel[];
  launchAltitudeM: number;
  latitudeDeg: number;
  /** Launch-site longitude, degrees (WGS84 Coriolis; optional). */
  longitudeDeg?: number;
  /** Earth model for the trajectory. */
  geodetic?: 'flat' | 'spherical' | 'wgs84';
  /** null when the file declares the ISA standard atmosphere. */
  temperatureC: number | null;
  /** null when the file declares the ISA standard atmosphere. */
  pressureHPa: number | null;
}
