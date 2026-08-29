// A named simulation = one flight setup over the shared rocket design: its own
// motor (primary mount) + launch conditions + last result. The right panel is a
// list of these; switching the active one drives the stability readout and sim.
import type { MotorSpec, FlightResult } from '../engine/openRocketEngine';
import type { LaunchConditions } from './orkTree';

export interface Simulation {
  id: string;
  name: string;
  motor: MotorSpec;
  launch: LaunchConditions;
  /** Cached last flight result (null until run, cleared when the design changes). */
  result: FlightResult | null;
}

let counter = 0;
/** Session-unique id for a new simulation. */
export function newSimId(): string { counter += 1; return `sim-${counter}`; }

export function newSimulation(name: string, motor: MotorSpec, launch: LaunchConditions): Simulation {
  return { id: newSimId(), name, motor, launch, result: null };
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Map UI launch conditions to the engine's simulate() options (radians, kelvin, Pa). */
export function simConditions(launch: LaunchConditions) {
  return {
    launchRodLength: launch.launchRodLengthM,
    launchRodAngle: rad(launch.launchRodAngleDeg),
    windAverage: launch.windAverage,
    windStdDeviation: launch.windStdDev,
    windDirection: rad(launch.windDirectionDeg ?? 90),
    windLevels: launch.windLevels?.map((l) => ({ altitude: l.altitudeM, speed: l.speed, direction: rad(l.directionDeg), stddev: l.stddev })),
    geodetic: launch.geodetic,
    launchAltitude: launch.launchAltitudeM,
    launchLatitude: launch.latitudeDeg,
    temperature: launch.temperatureC != null ? launch.temperatureC + 273.15 : undefined,
    pressure: launch.pressureHPa != null ? launch.pressureHPa * 100 : undefined,
    series: 'summary' as const,
  };
}
