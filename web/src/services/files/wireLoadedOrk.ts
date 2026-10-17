import type { RocketTree } from '../../engine/openRocketEngine';
import { resolveFilePositions } from '../../tree/position';
import { loadoutLabel, newFlightConfig, reconcileConfig, type FlightConfig } from '../flight/flightConfigs';
import { newSimulation, resultKey, type Simulation, type SimPrefs } from '../flight/simulations';
import type { LoadedOrk } from './loadOrk';
import { overLaunchDefaults, type LaunchConditions } from '../design/orkTree';
import type { OrkExportMotor } from './orkFile';
import type { ImportNote } from './importNote';
import type { DesignFormat } from './designFile';

/** The workspace slices a loaded .ork maps onto: the design tree, its flight
 *  configurations, its simulations, and the round-trip export metadata. */
export interface WiredOrk {
  tree: RocketTree;
  configs: FlightConfig[];
  sims: Simulation[];
  /** The simulation flying the configuration the file marks default. */
  activeId: string;
  loadedMeta: {
    name: string;
    notes: ImportNote[];
    exportMotors: Record<string, OrkExportMotor>;
    /** The file's format, which the loaded-design card names. */
    format?: DesignFormat;
  };
}

/**
 * Map a freshly parsed .ork onto the workspace: every configuration it declared
 * becomes a flight configuration. The file's own simulations come in as they
 * are; a file with none gets one simulation per configuration.
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
  // `.ork` can position a component with method="after", which is measured from
  // the previous sibling, and no reader of a single part is given its sibling.
  // Resolve each to the equivalent parent-relative 'top' offset so the drawings
  // agree with the flight; the original is preserved on the position so
  // `orkExport` still writes it back as the file had it. 'absolute' is kept as
  // written: every reader resolves it against the parent's start.
  const tree = resolveFilePositions(res.tree);
  const launch = overLaunchDefaults(launchDefaults, res.launch);

  const configs = res.configs.map((c) => {
    const config = newFlightConfig(c.motors, c.name, c.id);
    // Here `reconcileConfig` only drops motors whose mounts are gone: the import
    // already seated a curve-less placeholder in every mount this configuration
    // named no motor for, so there is no hole for its default C6 to fill.
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
        // The file's own run settings, kept where they differ from this app's:
        // desktop keeps them per simulation, and its summary was flown with them.
        const own = fs.prefs ? ownPrefs(fs.prefs, simPrefs) : undefined;
        const sim = {
          ...newSimulation(fs.name, config.id, overLaunchDefaults(launchDefaults, fs.launch)),
          ...(fs.xmlExtra ? { xmlExtra: fs.xmlExtra } : {}),
          ...(own ? { prefs: own } : {}),
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
    loadedMeta: {
      name: res.name,
      notes: res.notes,
      exportMotors: res.motors,
      ...(res.format ? { format: res.format } : {}),
    },
  };
}

/** The settings in `file` that differ from `globals`, or undefined when none do. */
function ownPrefs(file: Partial<SimPrefs>, globals: SimPrefs | undefined): Partial<SimPrefs> | undefined {
  const own = Object.fromEntries(
    Object.entries(file).filter(([k, v]) => !globals || globals[k as keyof SimPrefs] !== v),
  ) as Partial<SimPrefs>;
  return Object.keys(own).length ? own : undefined;
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
