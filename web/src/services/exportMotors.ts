import type { RocketTree } from '../engine/openRocketEngine';
import { liveMotors, type FlightConfig } from './flightConfigs';
import type { OrkExportMotor } from './orkFile';

/**
 * Build the mount-id -> export-motor map shared verbatim by the `.ork` and
 * RASAero writers: every mount the flight configuration seats a motor in, in
 * tree order, with the ignition override that mount carries.
 *
 * `base` carries through fields captured at import that the app never edits
 * (e.g. `manufacturer`), so a round-trip export does not drop them.
 */
export function buildExportMotorMap(
  tree: RocketTree,
  config: FlightConfig,
  base: Record<string, OrkExportMotor> = {},
): Record<string, OrkExportMotor> {
  const motors: Record<string, OrkExportMotor> = {};
  for (const [id, m] of liveMotors(tree, config)) {
    motors[id] = {
      ...base[id],
      designation: m.spec.designation,
      diameter: m.spec.diameter,
      length: m.spec.length,
      delay: m.spec.ejectionDelay,
      ignitionEvent: m.ignitionEvent,
      ignitionDelay: m.ignitionDelay,
    };
  }
  return motors;
}
