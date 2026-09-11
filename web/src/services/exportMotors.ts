import type { IgnitionEvent, MotorSpec, RocketTree } from '../engine/openRocketEngine';
import { findMountId, findNode } from './treeEdit';
import type { MountMotor } from './loadOrk';
import type { OrkExportMotor } from './orkFile';

/** The active configuration's primary motor plus its ignition override. */
export interface PrimaryMotor {
  motor: MotorSpec;
  ignitionEvent?: IgnitionEvent;
  ignitionDelay?: number;
}

/**
 * Build the mount-id → export-motor map shared verbatim by the .ork and RASAero
 * writers. The primary mount takes the active configuration's motor; every other
 * mount takes its imported motor from `extraMotors`, skipping the primary's own
 * (exported above) entry and mounts that no longer exist in the tree. `base`
 * carries through fields captured at import that the app never edits (e.g.
 * `manufacturer`), so a round-trip export doesn't drop them.
 */
export function buildExportMotorMap(
  tree: RocketTree,
  primary: PrimaryMotor,
  extraMotors: Record<string, MountMotor>,
  base: Record<string, OrkExportMotor> = {},
): Record<string, OrkExportMotor> {
  const mountId = findMountId(tree);
  const motors: Record<string, OrkExportMotor> = {};
  if (mountId)
    motors[mountId] = {
      ...base[mountId],
      designation: primary.motor.designation,
      diameter: primary.motor.diameter,
      length: primary.motor.length,
      delay: primary.motor.ejectionDelay,
      ignitionEvent: primary.ignitionEvent,
      ignitionDelay: primary.ignitionDelay,
    };
  for (const [id, m] of Object.entries(extraMotors)) {
    if (id === mountId || !findNode(tree, id)) continue;
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
