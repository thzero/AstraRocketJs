/**
 * Keep the per-mount motor map in sync with the rocket's motor mounts.
 *
 * The *first* mount in tree order is the "primary" — its motor lives on the
 * active simulation (`sim.motor`), not here — so `extraMotors` holds every
 * *other* mount, keyed by mount id. Whenever a mount is added, removed, toggled
 * (`motorMount`), or reordered, this reconciles the map so it can't drift from
 * the tree:
 *   - drop entries whose mount no longer exists (stale — would misrender / linger), and
 *   - seed a default C6 for any non-primary mount that has no motor yet,
 * so every mount is always loaded and the sim stays runnable.
 *
 * A now-primary mount's old entry is *kept* (consumers ignore it — see
 * buildConfiguredRocket / selectMotorDims), so its motor survives if it later
 * stops being primary. Returns the SAME object when nothing changed, so the
 * common case (a plain dimension edit) is a cheap no-op that triggers no churn.
 */
import { findMounts } from './treeEdit';
import { C6 } from '../engine/api';
import type { RocketTree } from '../engine/openRocketEngine';
import type { MountMotor } from './loadOrk';

export function reconcileMounts(
  tree: RocketTree,
  extraMotors: Record<string, MountMotor>,
): Record<string, MountMotor> {
  const ids = findMounts(tree).map((m) => m.id as string);
  const primary = ids[0];
  const present = new Set(ids);
  let changed = false;
  const next: Record<string, MountMotor> = {};

  // Keep entries for mounts that still exist; drop the rest.
  for (const [id, m] of Object.entries(extraMotors)) {
    if (present.has(id)) next[id] = m;
    else changed = true;
  }
  // Seed a default motor for each non-primary mount that lacks one.
  for (const id of ids) {
    if (id !== primary && !next[id]) { next[id] = { spec: C6 }; changed = true; }
  }
  return changed ? next : extraMotors;
}
