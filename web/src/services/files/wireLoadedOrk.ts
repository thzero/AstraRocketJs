import type { RocketTree } from '../../engine/openRocketEngine';
import { resolveFilePositions } from '../../tree/position';
import { loadoutLabel, newFlightConfig, reconcileConfig, type FlightConfig } from '../flight/flightConfigs';
import { newSimulation, type Simulation } from '../flight/simulations';
import type { LoadedOrk } from './loadOrk';
import type { LaunchConditions } from '../design/orkTree';
import type { OrkExportMotor } from './orkFile';

/** The workspace slices a loaded .ork maps onto: the design tree, its flight
 *  configurations, one simulation per configuration, and the round-trip export
 *  metadata. */
export interface WiredOrk {
  tree: RocketTree;
  configs: FlightConfig[];
  sims: Simulation[];
  /** The simulation flying the configuration the file marks default. */
  activeId: string;
  loadedMeta: { name: string; notes: string[]; exportMotors: Record<string, OrkExportMotor> };
}

/**
 * Map a freshly parsed .ork onto the workspace: every configuration it declared
 * becomes a flight configuration, and each gets a simulation that flies it.
 *
 * One simulation per configuration because that is what a configuration IS on
 * the desktop: a way the rocket is set up to fly. Importing three and opening
 * one would leave two setups the user could see in the table and had no run to
 * put numbers against.
 *
 * Each configuration keeps the file's own id, so a save writes the same
 * `configid` back and a round trip is identity rather than a rewrite.
 *
 * Pure (no I/O): the caller supplies `launchDefaults` so this stays testable, it
 * being the .ork-import mapping most likely to regress on odd files.
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
  const launch = { ...launchDefaults, ...res.launch };

  const configs = res.configs.map((c) => {
    const config = newFlightConfig(c.motors, c.name, c.id);
    // `reconcileConfig` only drops motors whose mounts are gone: the import
    // already seated a curve-less placeholder in every mount this configuration
    // named no motor for, so there is no hole for it to fill with a default.
    // Seeding a C6 would open a file saved without motors as a flyable rocket on
    // motors it never named.
    const reconciled = reconcileConfig(tree, config);
    return c.deployments ? { ...reconciled, deployments: c.deployments } : reconciled;
  });

  const taken = new Set<string>();
  const sims = configs.map((c) => newSimulation(simName(tree, c, res.name, taken), c.id, launch));

  return {
    tree,
    configs,
    sims,
    activeId: sims[configs.findIndex((c) => c.id === res.chosenConfigId)]?.id ?? sims[0]!.id,
    loadedMeta: { name: res.name, notes: res.notes, exportMotors: res.motors },
  };
}

/**
 * What to call the simulation that flies one configuration: the configuration's
 * name, else its motors, else the rocket's own name.
 *
 * The rows have to be told apart in the table, and the thing that distinguishes
 * them IS the configuration. `.ork` does name its simulations, but those names
 * are not read here, and "Simulation 1" against a three-configuration file says
 * less than the motors do.
 *
 * `taken` carries across the set, because two configurations can seat the same
 * motors and a file may name two the same.
 */
function simName(tree: RocketTree, config: FlightConfig, fallback: string, taken: Set<string>): string {
  const base = config.name || loadoutLabel(tree, config) || fallback;
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
  taken.add(name);
  return name;
}
