import type { RocketTree } from '../engine/openRocketEngine';
import { findMounts } from './treeEdit';
import { resolveFilePositions } from '../tree/position';
import { reconcileMounts } from './mountMotors';
import { newSimulation, type Simulation } from './simulations';
import { emptyMountMotor, type LoadedOrk, type MountMotor } from './loadOrk';
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
 * mount. A mount the file gave no motor for, primary or not, is seated with the
 * curve-less placeholder from `loadOrk.emptyMountMotor`, never a default: the
 * run gate then blocks with "no motor" until the user picks one. (This used to
 * put a C6 on an empty primary and let `reconcileMounts` seed a C6 into every
 * other empty mount, so a file saved without motors opened as a flyable rocket
 * on motors it never named, the very thing `loadOrk` refuses to do for a motor
 * it cannot resolve.) `reconcileMounts` then only drops motors whose mounts are
 * gone. Pure (no I/O): the caller supplies `launchDefaults` so this stays
 * testable — it's the .ork-import mapping most likely to regress on odd files.
 */
export function wireLoadedOrk(res: LoadedOrk, launchDefaults: LaunchConditions): WiredOrk {
  // `.ork` can position a component with method="absolute", which is a
  // ROCKET-origin offset. The editor works entirely in the parent frame, so
  // leaving it means the schematic, 3D view, drag handles and PDF all draw the
  // part at parent-start + offset while the engine flies it at offset — drawn
  // geometry disagreeing with simulated geometry. Resolve it to the equivalent
  // parent-relative offset; the original is preserved on the position so
  // `orkExport` still round-trips the file byte-for-byte.
  const tree = resolveFilePositions(res.tree);
  const mounts = findMounts(tree).map((m) => m.id as string);
  const primary = mounts[0];
  const extra = { ...res.motorSpecs };
  // Same policy as loadOrk, applied here too so a LoadedOrk built any other
  // way (tests, older persisted loads) cannot reach reconcileMounts with a
  // hole for it to fill with a default.
  for (const id of mounts) if (!extra[id]) extra[id] = { spec: emptyMountMotor() };
  const primaryMount = primary ? extra[primary] : undefined;
  const primaryMotor = primaryMount ? primaryMount.spec : emptyMountMotor();
  if (primary && extra[primary]) delete extra[primary]; // primary's motor rides on the sim, not extraMotors
  const sim0: Simulation = {
    ...newSimulation(res.name, primaryMotor, { ...launchDefaults, ...res.launch }),
    ignitionEvent: primaryMount?.ignitionEvent,
    ignitionDelay: primaryMount?.ignitionDelay,
  };
  return {
    tree,
    extraMotors: reconcileMounts(tree, extra),
    sim0,
    loadedMeta: { name: res.name, notes: res.notes, exportMotors: res.motors },
  };
}
