/**
 * Reading a persisted workspace: shape-check it, and lift an older one to the
 * current version.
 *
 * Every path that reads stored bytes goes through {@link migrateWorkspace} -
 * boot, the unload journal, and File > Open - so nothing downstream ever sees an
 * older shape, and the upgrade is written once rather than per reader.
 *
 * Version 1 kept each simulation's motor loadout inline: `motor` for the first
 * mount, `extraMotors` for the rest, ignition fields alongside. Version 2 holds
 * those as named flight configurations the simulations point at
 * (services/flight/flightConfigs.ts).
 */
import { findMounts } from '../design/treeEdit';
import { loadoutSignature, newFlightConfig, type FlightConfig, type MountMotor } from '../flight/flightConfigs';
import type { Simulation } from '../flight/simulations';
import type { Workspace } from './workspaceStore';
import type { IgnitionEvent, MotorSpec, RocketTree } from '../../engine/openRocketEngine';

/** One version-1 simulation: the loadout inline, the first mount apart from the rest. */
interface SimulationV1 extends Omit<Simulation, 'configId'> {
  motor?: MotorSpec;
  extraMotors?: Record<string, MountMotor>;
  ignitionEvent?: IgnitionEvent;
  ignitionDelay?: number;
}

interface WorkspaceV1 extends Omit<Workspace, 'version' | 'sims' | 'configs'> {
  version: 1;
  sims: SimulationV1[];
  /** Older still: ONE loadout for the whole workspace, applied to every sim. */
  extraMotors?: Record<string, MountMotor>;
}

/**
 * Accept a stored workspace, upgraded to the current version, or null.
 *
 * Null covers a truncated or hand-edited blob, and a version this build does not
 * know: `tree.components` that is not an array would crash `buildTree` deep in
 * the kernel rather than fail cleanly here, and a workspace written by a NEWER
 * build (an installed PWA can have an older one cached) must be refused rather
 * than half-read. The caller decides what a refusal means - the boot path
 * detaches rather than overwriting the design it could not read.
 */
export function migrateWorkspace(w: unknown): Workspace | null {
  const c = w as Partial<Workspace> | Partial<WorkspaceV1> | null;
  if (
    !c ||
    !c.tree ||
    !Array.isArray((c.tree as { components?: unknown }).components) ||
    !Array.isArray(c.sims) ||
    c.sims.length === 0
  ) {
    return null;
  }
  if (c.version === 2) {
    const v2 = c as Workspace;
    // `configs` is what every simulation's motors now live in, so a v2 blob
    // without one is not a v2 workspace.
    return Array.isArray(v2.configs) && v2.configs.length > 0 ? v2 : null;
  }
  if (c.version === 1) return fromV1(c as WorkspaceV1);
  return null;
}

/**
 * Version 1 to 2: mint a configuration per DISTINCT loadout.
 *
 * Deduped, because two rows that seated the same motors in the same mounts were
 * already flying the same configuration - one row per copy would open the
 * configurations list full of rows nobody could tell apart. Rows that differ
 * below the first mount (the reason the loadout moved onto each simulation in
 * the first place) still get a configuration each, so what the workspace flew is
 * unchanged.
 *
 * Every configuration is unnamed, which the desktop renders as its motor list.
 * Naming them would be inventing a name the user never typed.
 */
function fromV1(w: WorkspaceV1): Workspace {
  const primaryId = findMounts(w.tree as RocketTree)[0]?.id as string | undefined;
  const configs: FlightConfig[] = [];
  const bySignature = new Map<string, FlightConfig>();
  const sims: Simulation[] = w.sims.map((s) => {
    // The oldest shape kept ONE map for the whole workspace, which applied to
    // every simulation; folding it in reproduces exactly what that workspace
    // flew. A simulation carrying its own map keeps it.
    const extras = s.extraMotors ?? w.extraMotors ?? {};
    const motors: Record<string, MountMotor> = {};
    for (const [id, m] of Object.entries(extras)) {
      // A v1 workspace could hold a lingering entry for the first mount (it was
      // kept on purpose, so a motor survived a mount stopping being primary).
      // Every v1 consumer skipped it, so the loadout it actually flew skips it.
      if (id !== primaryId) motors[id] = m;
    }
    if (primaryId && s.motor) {
      motors[primaryId] = {
        spec: s.motor,
        ...(s.ignitionEvent ? { ignitionEvent: s.ignitionEvent } : {}),
        ...(s.ignitionDelay != null ? { ignitionDelay: s.ignitionDelay } : {}),
      };
    }
    const sig = loadoutSignature(motors);
    let config = bySignature.get(sig);
    if (!config) {
      config = newFlightConfig(motors);
      bySignature.set(sig, config);
      configs.push(config);
    }
    const { motor: _motor, extraMotors: _extras, ignitionEvent: _ev, ignitionDelay: _delay, ...rest } = s;
    return { ...rest, configId: config.id };
  });
  // A workspace with no mounts at all still needs one configuration to point at.
  if (!configs.length) {
    const empty = newFlightConfig();
    configs.push(empty);
    for (const s of sims) s.configId = empty.id;
  }
  return { version: 2, tree: w.tree, sims, configs, activeId: w.activeId, loadedMeta: w.loadedMeta };
}
