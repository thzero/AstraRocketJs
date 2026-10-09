import type { RocketTree } from '../../engine/openRocketEngine';
import { resolveFilePositions } from '../../tree/position';
import { loadoutLabel, newFlightConfig, reconcileConfig, type FlightConfig } from '../flight/flightConfigs';
import { newSimulation, resultKey, type Simulation, type SimPrefs } from '../flight/simulations';
import type { LoadedOrk } from './loadOrk';
import type { LaunchConditions } from '../design/orkTree';
import type { OrkExportMotor } from './orkFile';
import type { ImportNote } from './importNote';

/** The workspace slices a loaded .ork maps onto: the design tree, its flight
 *  configurations, one simulation per configuration, and the round-trip export
 *  metadata. */
export interface WiredOrk {
  tree: RocketTree;
  configs: FlightConfig[];
  sims: Simulation[];
  /** The simulation flying the configuration the file marks default. */
  activeId: string;
  loadedMeta: { name: string; notes: ImportNote[]; exportMotors: Record<string, OrkExportMotor> };
}

/**
 * Map a freshly parsed .ork onto the workspace: every configuration it declared
 * becomes a flight configuration, and each gets a simulation that flies it.
 *
 * One simulation per configuration because that is what a configuration is on
 * the desktop: a way the rocket is set up to fly. Importing three and opening
 * one would leave two setups the user could see in the table and had no run to
 * put numbers against.
 *
 * Each configuration keeps the file's own id, so a save writes the same
 * `configid` back and a round trip is identity rather than a rewrite.
 *
 * Pure (no I/O): the caller supplies `launchDefaults` so this mapping can be
 * tested directly against odd files.
 */
export function wireLoadedOrk(res: LoadedOrk, launchDefaults: LaunchConditions, simPrefs?: SimPrefs): WiredOrk {
  // `.ork` can position a component with method="absolute", which is a
  // rocket-origin offset. The editor works entirely in the parent frame, so
  // leaving it means the schematic, 3D view, drag handles and PDF all draw the
  // part at parent-start + offset while the engine flies it at offset, and the
  // drawing disagrees with the simulation. Resolve it to the equivalent
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
    // Everything the file carried for this configuration, not just the
    // deployments: a separation override and a grounded stage are its settings
    // too, and leaving any of the three out resets it to the default.
    return {
      ...reconciled,
      ...(c.deployments ? { deployments: c.deployments } : {}),
      ...(c.separations ? { separations: c.separations } : {}),
      ...(c.grounded?.length ? { grounded: c.grounded } : {}),
    };
  });

  // The file's own simulations when it has any: each with its name, the
  // configuration it flies, its launch and the summary of its result. A file
  // with none gets one simulation per configuration.
  const sims = res.simulations?.length
    ? res.simulations.map((fs) => {
        const config = configs.find((c) => c.id === fs.configId) ?? configs[0]!;
        const sim = {
          ...newSimulation(fs.name, config.id, { ...launchDefaults, ...fs.launch }),
          ...(fs.xmlExtra ? { xmlExtra: fs.xmlExtra } : {}),
        };
        if (!fs.summary) return sim;
        // Current as loaded, unless the file said otherwise or there is nothing
        // to key it against; from here on it ages the way a result does.
        const key = fs.outdated || !simPrefs ? null : resultKey(tree, config, sim, simPrefs);
        return { ...sim, fileSummary: { summary: fs.summary, key } };
      })
    : (() => {
        const taken = new Set<string>();
        return configs.map((c) => newSimulation(simName(tree, c, res.name, taken), c.id, launch));
      })();

  return {
    tree,
    configs,
    sims,
    activeId: sims.find((s) => s.configId === res.chosenConfigId)?.id ?? sims[0]!.id,
    loadedMeta: { name: res.name, notes: res.notes, exportMotors: res.motors },
  };
}

/**
 * What to call the simulation that flies one configuration: the configuration's
 * name, else its motors, else the rocket's own name.
 *
 * Used only for a file with no simulations of its own (a file that has them
 * keeps their names). The rows have to be told apart in the table, and the
 * thing that distinguishes them is the configuration; "Simulation 1" against a
 * three-configuration file says less than the motors do.
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
