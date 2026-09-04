// A named simulation = one flight setup over the shared rocket design: its own
// motor (primary mount) + launch conditions + last result. The right panel is a
// list of these; switching the active one drives the stability readout and sim.
import type { MotorSpec, FlightResult, IgnitionEvent } from '../engine/openRocketEngine';
import type { LaunchConditions } from './orkTree';
import { uuid } from './uuid';

export interface Simulation {
  id: string;
  name: string;
  motor: MotorSpec;
  /** When the primary mount's motor ignites (undefined = automatic / at launch). */
  ignitionEvent?: IgnitionEvent;
  /** Seconds after the ignition event (default 0). */
  ignitionDelay?: number;
  launch: LaunchConditions;
  /** Cached last flight result (null until run, cleared when the design changes). */
  result: FlightResult | null;
}

/** Globally-unique id for a new simulation — a UUID (like OpenRocket's own ids),
 *  so ids minted after a reload can't collide with persisted ones. */
function newSimId(): string { return uuid(); }

export function newSimulation(name: string, motor: MotorSpec, launch: LaunchConditions): Simulation {
  return { id: newSimId(), name, motor, launch, result: null };
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Global simulation preferences applied to every run (see services/settings.ts). */
export interface SimPrefs { timeStep: number; maxTime: number; randomSeed: number | null }

/** Map UI launch conditions (+ global sim prefs) to the engine's simulate() options
 *  (radians, kelvin, Pa). */
export function simConditions(launch: LaunchConditions, prefs?: SimPrefs) {
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
    windLevels: launch.windLevels?.map((l) => ({ altitude: l.altitudeM, speed: l.speed, direction: rad(l.directionDeg), stddev: l.stddev })),
    geodetic: launch.geodetic,
    launchAltitude: launch.launchAltitudeM,
    launchLatitude: launch.latitudeDeg,
    launchLongitude: launch.longitudeDeg,
    temperature: launch.temperatureC != null ? launch.temperatureC + 273.15 : undefined,
    pressure: launch.pressureHPa != null ? launch.pressureHPa * 100 : undefined,
    timeStep: prefs?.timeStep,
    maxTime: prefs?.maxTime,
    randomSeed: prefs?.randomSeed ?? undefined,
    series: 'summary' as const,
  };
}
