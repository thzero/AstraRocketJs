import { C6 } from '../engine/api';
import type { RocketTree } from '../engine/openRocketEngine';
import { findMountId } from './treeEdit';
import { reconcileMounts } from './mountMotors';
import { newSimulation, type Simulation } from './simulations';
import type { LoadedOrk, MountMotor } from './loadOrk';
import type { LaunchConditions } from './orkTree';
import type { OrkExportMotor } from './orkFile';

/** The workspace slices a loaded .ork maps onto: the design tree, the non-primary
 *  mount motors, the initial simulation, and the round-trip export metadata. */
export interface WiredOrk {
  tree: RocketTree;
  extraMotors: Record<string, MountMotor>;
  sim0: Simulation;
  loadedMeta: { name: string; notes: string[]; exportMotors: Record<string, OrkExportMotor> };
}

/**
 * Map a freshly parsed .ork onto the workspace. The primary mount (first in tree
 * order) drives the Motor panel: its motor rides on the initial simulation and
 * its ignition override lives on that sim, NOT in extraMotors like every other
 * mount. A primary mount with no motor falls back to a default C6. `reconcileMounts`
 * then drops motors whose mounts are gone and seeds C6 into any empty non-primary
 * mount. Pure (no I/O): the caller supplies `launchDefaults` so this stays
 * testable — it's the .ork-import mapping most likely to regress on odd files.
 */
export function wireLoadedOrk(res: LoadedOrk, launchDefaults: LaunchConditions): WiredOrk {
  const primary = findMountId(res.tree);
  const extra = { ...res.motorSpecs };
  const primaryMount = primary ? extra[primary] : undefined;
  const primaryMotor = primaryMount ? primaryMount.spec : C6;
  if (primary && extra[primary]) delete extra[primary]; // primary's motor rides on the sim, not extraMotors
  const sim0: Simulation = {
    ...newSimulation(res.name, primaryMotor, { ...launchDefaults, ...res.launch }),
    ignitionEvent: primaryMount?.ignitionEvent,
    ignitionDelay: primaryMount?.ignitionDelay,
  };
  return {
    tree: res.tree,
    extraMotors: reconcileMounts(res.tree, extra),
    sim0,
    loadedMeta: { name: res.name, notes: res.notes, exportMotors: res.motors },
  };
}
