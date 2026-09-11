import { buildRocketTree } from '../engine/api';
import type { IgnitionEvent, MotorSpec, OpenRocketDesign, RocketTree, StaticInfo } from '../engine/openRocketEngine';
import { findMountId, findNode } from './treeEdit';
import type { MountMotor } from './loadOrk';

/** A mount's ignition override (undefined event = engine default, "automatic"). */
export interface Ignition {
  event?: IgnitionEvent;
  delay?: number;
}

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
  primaryIgnition?: Ignition,
): OpenRocketDesign {
  const mountId = findMountId(tree);
  const r = buildRocketTree(tree, motor, mountId);
  // Seat the primary mount's ignition override (skip when "automatic" — that's
  // the engine default and needs no call).
  if (mountId && primaryIgnition?.event)
    r.setMotorIgnitionById(mountId, primaryIgnition.event, primaryIgnition.delay ?? 0);
  for (const [id, m] of Object.entries(extraMotors)) {
    if (id === mountId || !findNode(tree, id)) continue; // gone or already the primary
    if ((m.spec.times?.length ?? 0) < 2) continue; // unresolved/curve-less motor — leave the mount empty
    r.setMotorById(id, m.spec);
    if (m.ignitionEvent) r.setMotorIgnitionById(id, m.ignitionEvent, m.ignitionDelay ?? 0);
  }
  return r;
}

/** Static info + the live handle it was read from, or a build/read error message. */
export type StaticInfoResult = { info: StaticInfo; rocket: OpenRocketDesign } | { error: string };

/**
 * Build the configured rocket and read its static info (CG / CP / stability),
 * then fill in the Mach-0.3 coast drag coefficient — a geometry property absent
 * from the static JSON — via a best-effort single-point drag sweep. This is the
 * pure core of the rebuild effect (useWorkspaceEffects), lifted out so the app's
 * central physics orchestration is testable and reusable: it returns the static
 * info plus the live engine handle, or an `error` message if the build/read
 * throws. The `build` step is injectable so tests need no real engine.
 */
export function computeStaticInfo(
  tree: RocketTree,
  motor: MotorSpec | undefined,
  extraMotors: Record<string, MountMotor>,
  ignition?: Ignition,
  build: typeof buildConfiguredRocket = buildConfiguredRocket,
): StaticInfoResult {
  try {
    const rocket = build(tree, motor, extraMotors, ignition);
    const info = rocket.staticInfo();
    // Best-effort: a design the sweep can't evaluate just leaves cd undefined.
    try {
      info.cd = rocket.dragSweep({ machMin: 0.3, machMax: 0.3, machStep: 0.05 }).powerOff.total[0];
    } catch {
      /* leave cd undefined */
    }
    return { info, rocket };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
