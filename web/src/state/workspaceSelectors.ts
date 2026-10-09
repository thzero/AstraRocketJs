// The store's pure helpers and selectors: no store instance, and only a type
// edge back to store.ts. fileSlice reads these at run time, and store.ts builds
// fileSlice while it is itself still loading, so they cannot live in store.ts.
import i18n from '../i18n';
import type { RocketTree } from '../engine/openRocketEngine';
import { configFor, newFlightConfig, reconcileConfig, type FlightConfig } from '../services/flight/flightConfigs';
import { repairedText, type RepairedValue } from '../services/design/repairValues';
import type { Simulation } from '../services/flight/simulations';
import { loadSettings } from '../services/storage/settings';
import type { Workspace } from '../services/storage/workspaceStore';
import { designNameOf } from '../services/app/appInfo';
import { unitSymbols } from '../prefs/units';
import type { WorkspaceState } from './store';

/**
 * Display units for a message the store builds outside React. Read per call,
 * not once: the store outlives any one settings value, and a message quoting
 * the unit the reader had when the app booted is worse than one quoting none.
 */
export const displayUnits = () => {
  const s = loadSettings();
  return unitSymbols(s.units, s.unitOverrides);
};

/** Each repaired value as the banner's own line. */
export const repairNotes = (repaired: RepairedValue[]): string[] => repaired.map((r) => repairedText(r, i18n.t));

/** Which condition raised `storageWarning`; only 'full' is save-clearable. */
export type StorageWarningKind = 'full' | 'degraded' | 'loadFailed' | 'conflict';

/**
 * The warning a refused save deserves, from what refused it.
 *
 * A conflict is not a storage failure: nothing is wrong with the browser, and
 * telling the user to free space would send them off fixing the wrong thing.
 * Another tab has moved the design on, and what they need to know is that this
 * tab's edits are not being kept and how to rescue them.
 */
export const saveFailure = (e: unknown): { msg: string; kind: StorageWarningKind } =>
  e instanceof Error && e.message === 'conflict'
    ? { msg: i18n.t('storage.conflict'), kind: 'conflict' }
    : { msg: i18n.t('storage.full'), kind: 'full' };

/** The active simulation (falls back to the first if the id no longer exists). */
export const selectActive = (s: WorkspaceState): Simulation => s.sims.find((x) => x.id === s.activeId) ?? s.sims[0]!;

/**
 * What to call this rocket: its own name, else the name of the file it was
 * imported from, else the app's default.
 *
 * The same three-step fallback (`designNameOf`) the .ork, .rkt, 3MF and RASAero
 * exports use, so every download that carries the rocket's name carries the same
 * one (see `exportFilename`).
 */
export const selectDesignName = (s: WorkspaceState): string => designNameOf(s.tree, s.loadedMeta);

/**
 * The flight configuration the active simulation flies.
 *
 * Safe to subscribe to: it hands back a stored object, so a re-render happens
 * when that configuration or the active row changes and not otherwise.
 */
export const selectConfig = (s: WorkspaceState): FlightConfig => configFor(s.configs, selectActive(s).configId);

/** The configuration one given row flies (the table, the Run button). */
export const configOf = (configs: readonly FlightConfig[], sim: Simulation): FlightConfig =>
  configFor(configs, sim.configId);

/** A configuration with the app default motor in every mount. */
export function defaultConfig(tree: RocketTree): FlightConfig {
  return reconcileConfig(tree, newFlightConfig());
}

/**
 * The persistable shape of the current design (what autosave, the unload flush
 * and the design library write).
 *
 * Results included. They do not go in the design blob: `workspaceStore.save`
 * splits them out to their own key and writes them only when a run has changed
 * them, so the per-keystroke autosave still only serializes the inputs.
 */
export const workspaceSnapshot = (
  s: Pick<WorkspaceState, 'tree' | 'sims' | 'configs' | 'activeId' | 'loadedMeta'>,
): Workspace => ({
  version: 2,
  tree: s.tree,
  sims: s.sims,
  configs: s.configs,
  activeId: s.activeId,
  loadedMeta: s.loadedMeta,
});
