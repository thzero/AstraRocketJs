import { buildRocketTree } from '../engine/api';
import type { MotorSpec, OpenRocketDesign, RocketTree } from '../engine/openRocketEngine';
import { findMountId, findNode } from './treeEdit';
import type { MountMotor } from './loadOrk';

/**
 * Build the rocket exactly as the live rebuild effect does: the primary mount
 * takes `motor`, every other mount takes its imported motor from `extraMotors`
 * (skipping ones that are gone or are the primary). Shared by the main-thread
 * rebuild (useWorkspaceEffects) and the sim worker (engine/simWorker.ts) so a
 * worker-run flight sim executes on the *identical* configuration — no drift
 * between "what you see" (main-thread staticInfo) and "what you simulate".
 */
export function buildConfiguredRocket(
  tree: RocketTree,
  motor: MotorSpec | undefined,
  extraMotors: Record<string, MountMotor>,
): OpenRocketDesign {
  const mountId = findMountId(tree);
  const r = buildRocketTree(tree, motor, mountId);
  for (const [id, m] of Object.entries(extraMotors)) {
    if (id === mountId || !findNode(tree, id)) continue; // gone or already the primary
    r.setMotorById(id, m.spec);
    if (m.ignitionEvent) r.setMotorIgnitionById(id, m.ignitionEvent, m.ignitionDelay ?? 0);
  }
  return r;
}
