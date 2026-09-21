import { create } from 'zustand';
import i18n from '../i18n';
import { confirm } from './confirmStore';
import { scaleRocket } from '../tree/scaleRocket';
import { buildRocketTree, specToTree, C6, type RocketSpec, type StaticInfo } from '../engine/api';
import type {
  MotorSpec,
  RocketTree,
  ComponentNode,
  ComponentType as PartType,
  IgnitionEvent,
} from '../engine/openRocketEngine';
import { findMountId, updateNode, removeNode, addPart, addStage, moveNode } from '../services/treeEdit';
import { activeExtraMounts, reconcileMounts } from '../services/mountMotors';
import type { LaunchConditions } from '../services/orkTree';
import type { OrkExportMotor } from '../services/orkFile';
import type { DesignInfo } from '../services/orkTypes';
import type { MountMotor } from '../services/loadOrk';
import { buildExportMotorMap } from '../services/exportMotors';
import { wireLoadedOrk } from '../services/wireLoadedOrk';
// Static, not the lazy import the neighboring .ork paths use: this is a fetch
// wrapper with no heavy dependencies, and the library dialog imports it
// statically anyway, so a dynamic import here only produces rolldown's
// INEFFECTIVE_DYNAMIC_IMPORT warning without moving a byte.
import { fetchExample } from '../services/exampleLibrary';
import {
  newSimulation,
  sameSimInputs,
  simConditions,
  simInputs,
  type Simulation,
  type SimPrefs,
  type SimRun,
} from '../services/simulations';
import { simulateInWorker, SimTimeoutError, SimCanceledError } from '../engine/simClient';
import { loadSettings } from '../services/settings';
import { launchLimitViolations, limitText } from '../services/safetyLimits';
import {
  unflyable,
  unflyableText,
  hasThrustCurve,
  designBlocker,
  designBlockerText,
  type Unflyable,
} from '../services/runnability';
import { isComplete, type CompleteLaunch } from '../services/requiredLaunch';
import { defaultDesignName } from '../services/appInfo';
import { getDesignLibrary, type DesignMeta } from '../services/designLibrary';
import { getWorkspaceStore, validateWorkspace, type Workspace } from '../services/workspaceStore';
import type { MotorDims } from '../components/canvas/Rocket3D';
import { isResultView, type Tab, type DesignPane, type ViewMode } from './tabs';

// A clean, classic sport rocket (~55 cm, 26 mm airframe, swept 3-fin).
const DEFAULT_SPEC: RocketSpec = {
  noseCone: { length: 0.13, aftRadius: 0.013, thickness: 0.0008, shape: 'ogive' },
  bodyTube: { length: 0.42, outerRadius: 0.013, thickness: 0.0005 },
  fins: { count: 3, rootChord: 0.08, tipChord: 0.038, sweep: 0.055, height: 0.058, thickness: 0.0028 },
  motorMount: { length: 0.07, outerRadius: 0.0092, thickness: 0.0004 },
  parachute: { diameter: 0.4, dragCoefficient: 0.8 },
};

type Rocket = ReturnType<typeof buildRocketTree>;
type LoadedMeta = { name: string; notes: string[]; exportMotors: Record<string, OrkExportMotor> } | null;

/** One undo/redo checkpoint: the whole editable workspace — the design tree (and
 *  which part was selected, so undo re-focuses what changed) plus the simulations,
 *  the active sim, and the extra-mount motors, all of which persist to the same
 *  file. Cached flight `result`s are stripped in {@link snap}: they're large,
 *  recomputable outputs, not edits. */
type HistoryEntry = {
  tree: RocketTree;
  selectedId: string | null;
  sims: Simulation[];
  activeId: string;
  /**
   * The three fields `deleteSim` prunes alongside `sims`.
   *
   * Without them, undoing a delete brought the row back but not its tick (so
   * the Run button's count was wrong) and not its place in `lastRunIds` (so
   * the Results picker collapsed to a single name even though the run really
   * had flown it).
   */
  selectedSimIds: string[];
  lastRunIds: string[];
  resultSimId: string | null;
};
/** Cap the stack so a long session can't grow memory without bound. */
const HISTORY_LIMIT = 100;

/** Which condition raised `storageWarning` — only 'full' is save-clearable. */
export type StorageWarningKind = 'full' | 'degraded' | 'loadFailed';

export interface WorkspaceState {
  // --- design ---
  tree: RocketTree;
  info: StaticInfo | null;
  /** Transient failure of the thing the user just did — a bad .ork, a sim that
   *  threw. Cleared by the next successful rebuild. */
  err: string | null;
  /**
   * Browser storage is not keeping the user's work (quota hit, or IndexedDB
   * blocked and we are back on the 5 MB localStorage cap).
   *
   * A SEPARATE slot from `err` on purpose. It used to share it, and the rebuild
   * effect clears `err` on every successful build — which happens milliseconds
   * after load and again on every keystroke — so the one warning telling the
   * user their work is no longer being saved was wiped before it could be read.
   * A successful save clears ONLY the transient "full" case. `degraded` and
   * `loadFailed` are facts about this session that a later save does not undo:
   * `idbKeyValueStore.markDegraded()` is one-way and never notifies twice, so
   * clearing its message on the next successful write retired it permanently —
   * one keystroke after it appeared — and the user met the 5 MB cap later with
   * nothing on screen to explain it. Hence the `kind`.
   */
  storageWarning: string | null;
  storageWarningKind: StorageWarningKind | null;
  selectedId: string | null;
  loadedMeta: LoadedMeta;
  rocket: Rocket | null; // live engine handle (set by the rebuild effect; used by runSim)
  // --- history (undo/redo of component edits) ---
  past: HistoryEntry[];
  future: HistoryEntry[];
  // --- simulations ---
  sims: Simulation[];
  activeId: string;
  /**
   * Rows ticked for running, which is a DIFFERENT question from `activeId`.
   *
   * `activeId` is the simulation the editor is pointed at - exactly one, always.
   * This is the set the Run button will fly, and it is normally empty: with
   * nothing ticked, Run flies the active one, which is what you want when there
   * is only one simulation or you are iterating on a single setup. Ticking rows
   * is how you say "these several".
   */
  selectedSimIds: string[];
  /** True while a batch is draining. Coarse on purpose: it gates the UI as a
   *  whole (the Run button, which becomes Cancel), where per-row detail belongs
   *  in {@link simRuns}. */
  simBusy: boolean;
  /**
   * Transient per-simulation run state: which rows are queued, which are in the
   * air, and which threw on the design they were flown against.
   *
   * Per-sim rather than a single `runningId` because the worker pool runs
   * several flights at once. It is deliberately NOT part of a `Simulation`,
   * which is persisted: "running" must not survive a reload.
   *
   * The failed entries carry their design because CenterView's "auto-run
   * outdated" re-fires whenever `simBusy` goes false while a result view is open
   * and there is no result — exactly the state a failed run leaves behind, so a
   * reproducible failure (a sim that times out) retried without limit.
   * Recording the design it failed on lets the retry wait for an actual change.
   */
  simRuns: Record<string, SimRun>;
  /**
   * Which flight the Results tab is showing, chosen from its own picker.
   *
   * NULL means "whichever simulation is active", which is the behavior the tab
   * had before the picker existed and the right default: open Results and you
   * see the row you were just working on, without having chosen anything.
   *
   * Separate from `selectedSimIds` on purpose. The ticks answer "which rows
   * should Run fly"; this answers "which flight am I reading". They are
   * different questions asked at different moments, and tying them together
   * meant that reading one result silently re-armed the Run button, or that
   * ticking rows to fly them yanked the charts around.
   *
   * An id that no longer names a simulation falls back rather than being pruned,
   * so deleting a row cannot leave the tab empty mid-read.
   */
  resultSimId: string | null;
  /**
   * The simulations the LAST run actually flew, in the order they were asked for.
   *
   * This, not "every simulation that has a result", is what decides whether the
   * Results tab shows a plain name or a picker: results persist, so counting
   * them meant running one simulation today after running another yesterday put
   * a dropdown on screen for a single run. One run, one name.
   */
  lastRunIds: string[];
  // --- view / navigation ---
  tab: Tab;
  /** Which half of the Design tab a phone shows; ignored at lg+, where both do. */
  designPane: DesignPane;
  view: ViewMode;
  twoD: 'side' | 'aft';
  roll: number; // 2D fin-spin, radians, kept in [0, 2π)
  resetKey: number; // bump to remount the 2D schematic

  // --- actions ---
  setErr: (err: string | null) => void;
  /** Raise (or clear, with null) the persistent storage warning. */
  setStorageWarning: (msg: string | null, kind?: StorageWarningKind) => void;
  /** A save succeeded: retire a "storage full" warning, leave the standing ones. */
  clearSaveWarning: () => void;
  applyBuild: (info: StaticInfo | null, rocket: Rocket | null) => void; // from the rebuild effect
  markOutdated: () => void; // from the tree-change effect
  /**
   * Bumped by every `hydrate`. Restoring a design is not editing it: the
   * flight-invalidation effect (useWorkspaceEffects) re-seeds its baseline on
   * a change here instead of flagging the restored results stale. Boot is one
   * hydrate; File > Open is another, and that one carried results the effect
   * used to age (and `autoRunOutdated` then re-flew) for nothing.
   */
  hydrationGen: number;
  hydrate: (w: {
    tree: RocketTree;
    sims: Simulation[];
    activeId: string;
    /** LEGACY: pre-per-simulation workspaces kept one shared map here. */
    extraMotors?: Record<string, MountMotor>;
    loadedMeta: LoadedMeta;
  }) => void;

  scaleDesign: (factor: number) => void;
  setSelectedId: (id: string | null) => void;
  patchSelected: (patch: Partial<ComponentNode>) => void;
  removeSelected: () => void;
  addPartToTree: (type: PartType) => void;
  addStageToTree: () => void;
  moveSelected: (dir: -1 | 1) => void;
  updateDesignMeta: (
    patch: Partial<Pick<RocketTree, 'name' | 'designer' | 'comment' | 'revision' | 'designType'>>,
  ) => void;
  /** Finalize the in-flight edit (slider drag / text entry) into one undo entry.
   *  Called by the editors when an interaction ends (blur / discrete change). */
  commitEdit: () => void;
  undo: () => void;
  redo: () => void;

  setActiveId: (id: string) => void;
  setActiveMotor: (m: MotorSpec) => void;
  /** Set when the primary mount's motor ignites (per active simulation). */
  setActiveIgnition: (event: IgnitionEvent, delay: number) => void;
  /** Set the motor for a non-primary mount (multi-mount rockets). */
  setExtraMotor: (mountId: string, m: MotorSpec) => void;
  /** Set when a non-primary mount's motor ignites. */
  setExtraIgnition: (mountId: string, event: IgnitionEvent, delay: number) => void;
  patchLaunch: (p: Partial<LaunchConditions>) => void;
  addSim: () => void;
  duplicateSim: (id: string) => void;
  deleteSim: (id: string) => void;
  renameSim: (id: string, name: string) => void;
  /** Override a global run preference for the active sim; null clears the override. */
  setSimPref: <K extends keyof SimPrefs>(key: K, value: SimPrefs[K] | null) => void;
  /** Drop every override on the active simulation, so all of them follow the globals again. */
  clearSimPrefs: () => void;
  /** Choose which flight the Results tab shows; null follows the active row. */
  setResultSimId: (id: string | null) => void;
  /** Tick or untick one row for the next run. */
  toggleSimSelected: (id: string) => void;
  /** Tick every row, or none. */
  setSimsSelected: (ids: string[]) => void;
  /** Run the active simulation. */
  runSim: (prefs: SimPrefs) => Promise<void>;
  /** Run these simulations. They fly concurrently over the worker pool. */
  runSims: (ids: string[], prefs: SimPrefs) => Promise<void>;
  /** Run every simulation whose result is missing or stale. */
  runOutdated: (prefs: SimPrefs) => Promise<void>;
  /** Stop the batch in flight. Rows already finished keep their results. */
  cancelRun: () => void;

  setTab: (tab: Tab) => void;
  /** Open the Design tab on one of its two phone panes (see {@link DesignPane}). */
  setDesignPane: (pane: DesignPane) => void;
  setView: (view: ViewMode) => void;
  setTwoD: (v: 'side' | 'aft') => void;
  setRoll: (roll: number) => void;
  rollBy: (d: number) => void;
  resetView: () => void;

  /** Open a `.ork`. A `Blob` rather than a `File` so a bundled example, which
   *  arrives as bytes from a fetch, takes the identical path a picked file does
   *  — `.arrayBuffer()` is the only thing this ever wanted from a File. */
  openOrkFile: (file: Blob) => Promise<void>;
  /** Open one of the bundled OpenRocket examples by its file name. */
  openExample: (file: string) => Promise<void>;
  resetWorkspace: () => void;
  /** Saved designs, newest first (designLibrary.ts). Refreshed on demand. */
  designs: DesignMeta[];
  /** Id of the design currently being edited, or null before the first save. */
  activeDesignId: string | null;
  refreshDesigns: () => Promise<void>;
  openDesign: (id: string) => Promise<void>;
  /** Commit the open design now. Resolves false when there is nothing to save
   *  into yet (never named) — the caller should offer Save As instead. */
  /** `true` saved; `'unnamed'` the design has no library entry yet (Save As);
   *  `false` the write was refused and the storage banner is already up. */
  saveDesign: () => Promise<boolean | 'unnamed'>;
  saveDesignAs: (name: string) => Promise<void>;
  renameDesign: (id: string, name: string) => Promise<void>;
  deleteDesign: (id: string) => Promise<void>;
  // These four are implemented `async`. Declaring them `() => void` was a
  // lie the type system then enforced: no caller and no test could await
  // them, which is part of why none of the four had a test. The `void`-calling
  // sites in AppHeader keep their `void`.
  newWorkspace: () => Promise<void>;
  saveOrk: () => Promise<void>;
  saveRasaero: () => Promise<void>;
  /** Export a single component as a 3D mesh (stl/obj/glb) or a 2D cut sheet (dxf). */
  exportComponent: (nodeId: string, format: 'stl' | 'obj' | 'glb' | 'dxf') => Promise<void>;
}

/** The active simulation (falls back to the first if the id no longer exists). */
export const selectActive = (s: WorkspaceState): Simulation => s.sims.find((x) => x.id === s.activeId) ?? s.sims[0]!;

/**
 * What the Run button will fly: the ticked rows, or the active simulation when
 * nothing is ticked. One place decides it, so the button's label, its enabled
 * state and the action itself can never disagree.
 *
 * NOT for `useWorkspaceStore(selectRunIds)`: it builds a fresh array per call
 * and zustand compares by reference, so subscribing to it re-renders forever.
 * Components subscribe to `selectedSimIds` and the active id and derive it.
 */
export const selectRunIds = (s: WorkspaceState): string[] =>
  s.selectedSimIds.length ? s.selectedSimIds : [selectActive(s).id];

/**
 * What an EDIT in the right-hand editor applies to: the ticked rows, or the
 * active simulation when nothing is ticked.
 *
 * Deliberately the same rule as {@link selectRunIds}. A tick already means
 * "these ones" for Run and for Delete; making it mean something else for Edit
 * would be a third selection concept for the user to hold. The editor says so
 * in a banner, so a multi-target edit is never silent.
 *
 * Same subscription caveat as `selectRunIds`: it builds a fresh array, so
 * components derive it rather than subscribing to it.
 */
const selectEditIds = (s: WorkspaceState): string[] => selectRunIds(s);

/** The active simulation's non-primary-mount motors — its flight configuration. */
export const selectExtraMotors = (s: WorkspaceState): Record<string, MountMotor> => selectActive(s).extraMotors;

/**
 * True when the ACTIVE sim's last run threw on the design that is still loaded.
 *
 * Self-expiring by construction: it compares the recorded tree against the
 * current one, so any edit makes it false again and a retry is allowed. That is
 * the whole point — auto-run must not retry a configuration it already knows
 * fails, but it must try again the moment the user changes something.
 */
export const selectRunFailed = (s: WorkspaceState): boolean => {
  const run = s.simRuns[selectActive(s).id];
  return run?.phase === 'failed' && run.tree === s.tree;
};

/**
 * A motor is usable only if it carries a full thrust curve.
 *
 * Re-exported from `services/runnability`, which is where the whole "can this
 * row fly" question lives now so the Run button and the run loop share it.
 */
export { hasThrustCurve };

/**
 * Repair a persisted workspace so a stale/partial blob can't blank the app.
 * We merge each launch over the current defaults (a `launch` missing fields
 * would blank the Launch panel) and drop any stale results. A curve-less motor
 * is KEPT as-is — the rebuild no longer seats it (so it can't blank the app),
 * the run stays blocked ("no motor"), and an unresolved .ork motor is never
 * silently replaced with a default. Only a wholly-missing motor falls back to C6.
 */
function sanitizeSims(sims: Simulation[]): Simulation[] {
  const launchDefaults = loadSettings().launchDefaults;
  const safe = (Array.isArray(sims) ? sims : []).filter((s) => s && typeof s.id === 'string');
  if (!safe.length) return [newSimulation('Simulation 1', C6, launchDefaults)];
  return safe.map((s) => ({
    ...s,
    launch: { ...launchDefaults, ...(s.launch ?? {}) },
    motor: s.motor ?? C6,
    extraMotors: s.extraMotors ?? {},
    // Kept, not dropped: flights persist under their own key and are re-attached
    // by the workspace store before this sees them (workspaceStore.withResults).
    result: s.result ?? null,
  }));
}

/** Motor case dimensions for the 2D/3D views (primary mount + any extra mounts). */
export function selectMotorDims(
  tree: RocketTree,
  motor: MotorSpec,
  extraMotors: Record<string, MountMotor>,
): MotorDims {
  const m: MotorDims = {};
  const mountId = findMountId(tree);
  if (mountId) m[mountId] = { length: motor.length, diameter: motor.diameter, label: motor.designation };
  // The primary mount is drawn from `motor` above; the shared filter skips any
  // lingering extra entry for it (and for mounts no longer in the tree) so
  // nothing misrenders, and so this cannot drift from what the builder seats.
  for (const [id, mm] of activeExtraMounts(tree, extraMotors, mountId)) {
    m[id] = { length: mm.spec.length, diameter: mm.spec.diameter, label: mm.spec.designation };
  }
  return m;
}

/** First `label(n)` (n = start, start+1, …) not already used by a sim — so New
 *  and Duplicate never reuse a name, even after deletions. */
/**
 * Re-key every simulation's extra-mount motors against the tree.
 *
 * Returns the same array — and the same per-simulation objects — when nothing
 * mount-related moved, so the per-keystroke edit path allocates nothing and the
 * autosave effect does not see a change that isn't one.
 */
function reconcileAll(tree: RocketTree, sims: Simulation[]): Simulation[] {
  let changed = false;
  const next = sims.map((x) => {
    const em = reconcileMounts(tree, x.extraMotors);
    if (em === x.extraMotors) return x;
    changed = true;
    return { ...x, extraMotors: em };
  });
  return changed ? next : sims;
}

function uniqueSimName(sims: Simulation[], label: (n: number) => string, start: number): string {
  const taken = new Set(sims.map((x) => x.name));
  let n = start;
  while (taken.has(label(n))) n++;
  return label(n);
}

/**
 * A `view` paired with a tab that can actually show it.
 *
 * On a phone the center pane backs two tabs and each owns a family: Sketch the
 * design views, Results the flight ones. Rocket and Simulate show no view at
 * all, so a caller sitting on either is left where it is.
 *
 * Every write of `view` goes through this. Writing the two apart is how you end
 * up on a Results tab with no result and an empty view switch, which is exactly
 * what opening a new design from that tab used to do.
 */
/**
 * One monotonic counter for "which workspace is open".
 *
 * It began as openDesign's own token, which defended that action against
 * ANOTHER openDesign and nothing else. Every other way of replacing the
 * workspace went unguarded: import a large .ork then a small one and the small
 * one lands first, the large one overwriting it; open a library design and then
 * import, and the import's `setActiveId(null)` lands before openDesign's
 * continuation, which then flushes the imported rocket out under a null id
 * (a stray entry) and hydrates the library design over the top of it.
 *
 * So every action that REPLACES the workspace bumps it, and every continuation
 * past an await re-checks before it touches the store.
 */
let workspaceGen = 0;
/** Sequence for design-list refreshes; see refreshDesigns. */
let designsGen = 0;
/** Claim the workspace; the returned predicate says whether someone else has. */
const claimWorkspace = (): (() => boolean) => {
  const mine = ++workspaceGen;
  return () => mine !== workspaceGen;
};
/**
 * OBSERVE the workspace without claiming it: the predicate reports whether
 * someone replaced it, but taking this token does not itself count as a
 * replacement.
 *
 * `saveDesign` and `saveDesignAs` do not replace the workspace - they only
 * need to notice if something else did - but they used `claimWorkspace`, which
 * bumps the generation and so invalidated every other continuation. Dropping a
 * large `.ork` on the app and hitting File > Save while it parsed made
 * `openOrkFile`'s `stale()` true, and BOTH its success and its error paths are
 * gated on that, so nothing loaded and nothing was reported.
 */
const observeWorkspace = (): (() => boolean) => {
  const mine = workspaceGen;
  return () => mine !== workspaceGen;
};

function showing(s: { tab: Tab; designPane: DesignPane }, view: ViewMode): Partial<WorkspaceState> {
  // The Simulate tab and the phone's Rocket pane show stats and the run, not a
  // view at all, so a caller sitting on either is left where it is.
  if (s.tab === 'sim' || (s.tab === 'design' && s.designPane === 'stats')) return { view };
  return isResultView(view)
    ? { view, tab: 'results' }
    : // Coming BACK from Results, the drawing is what shows a design view, so a
      // phone lands on the Sketch pane rather than the stats it was never asked for.
      { view, tab: 'design', designPane: 'sketch' };
}

/**
 * The batch in flight, if any, so `cancelRun` can stop it.
 *
 * Module scope rather than store state: it is a handle onto work, not something
 * anything renders, and an AbortController in the store would be a non-plain
 * value in a tree that is serialized and compared by identity.
 */
let batchAbort: AbortController | null = null;

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  /**
   * Patch every simulation the editor is pointed at: the TICKED rows, or the
   * active one when nothing is ticked (see {@link selectEditIds}).
   *
   * `patch` is built PER simulation rather than passed in whole, because a bulk
   * edit must merge into each target's own state -- `{...sim.launch, ...p}` off
   * the active sim would copy the active sim's entire launch block onto the
   * others and silently flatten every field the user never touched. Built per
   * target, only the key actually edited moves; everything else stays the
   * simulation's own.
   */
  const patchTargets = (make: (sim: Simulation) => Partial<Simulation>) => {
    const ids = new Set(selectEditIds(get()));
    // `outdated` is set HERE, once, rather than by each caller. Every edit that
    // reaches this helper changes a simulation's INPUTS, so every one of them
    // invalidates its cached flight - and having each of the seven call sites
    // remember to say so meant the next one to be added would not. A caller
    // can still override it in its patch if it ever genuinely must.
    set((s) => ({ sims: s.sims.map((x) => (ids.has(x.id) ? { ...x, outdated: true, ...make(x) } : x)) }));
  };

  /**
   * Patch ONLY the active simulation, whatever is ticked.
   *
   * For the two things a selection must not touch. A NAME pushed across three
   * rows leaves three rows called the same thing. A MOTOR is worse: the whole
   * reason to keep several simulations is to fly the same airframe on different
   * motors, so a bulk motor change collapses exactly the comparison the rows
   * exist to make -- and it is the one edit you cannot undo by eye afterwards,
   * because every row now looks deliberately identical.
   */
  const patchActive = (make: (sim: Simulation) => Partial<Simulation>) => {
    const id = selectActive(get()).id;
    // Same as patchTargets: an input edit, so the flight is stale by definition.
    set((s) => ({ sims: s.sims.map((x) => (x.id === id ? { ...x, outdated: true, ...make(x) } : x)) }));
  };

  // --- undo/redo plumbing ---
  // A user interaction = one history entry. Continuous edits (slider drag, text
  // entry) open a transaction on the first change (capturing the pre-edit
  // snapshot) and are finalized by commitEdit() when the interaction ends;
  // structural edits (add/remove/move) are atomic and record their own step.
  let txn: HistoryEntry | null = null;
  const snap = (): HistoryEntry => {
    const s = get();
    // Drop cached flight results — large per-timestep arrays and a recomputable
    // output, not an edit. Undo/redo restores inputs and leaves sims to re-run.
    return structuredClone({
      tree: s.tree,
      selectedId: s.selectedId,
      sims: s.sims.map((x) => ({ ...x, result: null })),
      activeId: s.activeId,
      selectedSimIds: s.selectedSimIds,
      lastRunIds: s.lastRunIds,
      resultSimId: s.resultSimId,
    });
  };
  /**
   * Put the recorded INPUTS back, and carry the live results across.
   *
   * History entries hold no results (see {@link snap}), so restoring one used to
   * blank every flight the user had — an undo of a typo threw away numbers that
   * were still perfectly readable. The design did change, so what comes back is
   * flagged outdated rather than presented as current.
   */
  const restore = (e: HistoryEntry) => {
    const live = new Map(get().sims.map((x) => [x.id, x]));
    return {
      tree: e.tree,
      selectedId: e.selectedId,
      sims: e.sims.map((x) => {
        const held = live.get(x.id)?.result;
        return held ? { ...x, result: held, outdated: true } : x;
      }),
      activeId: e.activeId,
      selectedSimIds: e.selectedSimIds,
      lastRunIds: e.lastRunIds,
      resultSimId: e.resultSimId,
    };
  };
  const pushPast = (entry: HistoryEntry) =>
    set((s) => ({ past: [...s.past, entry].slice(-HISTORY_LIMIT), future: [] }));
  const beginEdit = () => {
    if (!txn) txn = snap();
  }; // idempotent: open a txn
  const commitEdit = () => {
    if (txn) {
      pushPast(txn);
      txn = null;
    }
  }; // finalize the open txn
  const recordStep = () => {
    commitEdit();
    pushPast(snap());
  }; // flush pending, then log this step
  /**
   * The persistable shape of the current design (what autosave writes).
   *
   * Results included. They do not go in the design blob — `workspaceStore.save`
   * splits them out to their own key and writes them only when a run has changed
   * them, so the per-keystroke autosave still only serializes the inputs.
   */
  const snapshotOf = (s: {
    tree: Workspace['tree'];
    sims: Workspace['sims'];
    activeId: string;
    loadedMeta: Workspace['loadedMeta'];
  }): Workspace => ({
    version: 1,
    tree: s.tree,
    sims: s.sims,
    activeId: s.activeId,
    loadedMeta: s.loadedMeta,
  });

  /**
   * Write the open design out now, ahead of switching away from it. False if
   * storage refused the write.
   *
   * The refusal used to be swallowed here on the theory that "the banner
   * already says so". It did not: only the debounced autosave's catch raises
   * the banner, and File > Save calls this directly, so a Save within the
   * 500 ms debounce on a full store reported success with nothing written.
   * Callers decide what a refusal means for them (a switch still proceeds; a
   * Save must say it failed).
   */
  const flushActive = async (): Promise<boolean> => {
    try {
      await getWorkspaceStore().save(snapshotOf(useWorkspaceStore.getState()));
      return true;
    } catch {
      return false;
    }
  };

  const clearHistory = () => {
    txn = null;
    set({ past: [], future: [] });
  }; // on load / new design

  /**
   * Swap the whole workspace in ONE `set`, always resetting the transient block.
   *
   * `hydrate`, `openOrkFile` and `resetWorkspace` each replaced the design and
   * each reset a different subset of what goes with it: none cleared `simRuns`,
   * `lastRunIds` or `resultSimId`, so the Results tab could point at a run id
   * from the previous design, and a batch still in flight kept `simBusy` on the
   * new one; `resetWorkspace` left `err` standing and wrote in two `set` calls,
   * so a subscriber saw the blank design with the old design's error under it.
   * A batch still running belongs to the old design, so it is canceled here
   * (its answers would be dropped by the `ranOn` guard anyway).
   */
  const replaceWorkspace = (patch: Partial<WorkspaceState> | ((s: WorkspaceState) => Partial<WorkspaceState>)) => {
    batchAbort?.abort();
    batchAbort = null;
    set((s) => ({
      simRuns: {},
      lastRunIds: [],
      resultSimId: null,
      selectedSimIds: [],
      simBusy: false,
      err: null,
      ...(typeof patch === 'function' ? patch(s) : patch),
    }));
  };

  return {
    tree: specToTree(DEFAULT_SPEC).tree,
    info: null,
    err: null,
    storageWarning: null,
    storageWarningKind: null,
    simRuns: {},
    resultSimId: null,
    lastRunIds: [],
    selectedId: null,
    loadedMeta: null,
    rocket: null,
    past: [],
    future: [],
    sims: [newSimulation('Simulation 1', C6, loadSettings().launchDefaults)],
    activeId: '',
    selectedSimIds: [],
    simBusy: false,
    tab: 'design',
    designPane: 'stats',
    view: '2d',
    twoD: 'side',
    roll: 0,
    resetKey: 0,
    designs: [],
    activeDesignId: null,
    hydrationGen: 0,

    setErr: (err) => set({ err }),
    setStorageWarning: (storageWarning, kind) =>
      set({ storageWarning, storageWarningKind: storageWarning ? (kind ?? null) : null }),
    clearSaveWarning: () =>
      set((s) => (s.storageWarningKind === 'full' ? { storageWarning: null, storageWarningKind: null } : {})),
    applyBuild: (info, rocket) => set({ info, rocket }),
    // A design edit does not destroy the numbers, it ages them. See
    // `Simulation.outdated`.
    markOutdated: () =>
      set((s) =>
        s.sims.some((x) => x.result && !x.outdated)
          ? { sims: s.sims.map((x) => (x.result ? { ...x, outdated: true } : x)) }
          : {},
      ),
    hydrate: (w) => {
      // A workspace written before the loadout moved onto each simulation has
      // ONE shared map. It applied to every sim, so folding it into every sim
      // reproduces exactly what that workspace flew. Sims carrying their own map
      // (anything written since) keep it.
      const legacy = w.extraMotors;
      const migrated =
        legacy && Object.keys(legacy).length
          ? w.sims.map((x) => (x.extraMotors ? x : { ...x, extraMotors: legacy }))
          : w.sims;
      const sims = reconcileAll(w.tree, sanitizeSims(migrated));
      const activeId = sims.some((s) => s.id === w.activeId) ? w.activeId : sims[0]!.id;
      replaceWorkspace((s) => ({
        tree: w.tree,
        sims,
        activeId,
        loadedMeta: w.loadedMeta ?? null,
        hydrationGen: s.hydrationGen + 1,
      }));
    },

    // Each structural/field edit reconciles the extra-mount motors to the new
    // tree (drop gone mounts, seed a default for new ones) so no loadout can
    // drift from the mounts. See {@link reconcileAll}: EVERY simulation, because
    // the mounts belong to the shared design even though the motors seated in
    // them belong to each simulation.
    scaleDesign: (factor) => {
      const { tree, sims } = get();
      const next = scaleRocket(tree, factor);
      if (next === tree) return; // 1×, or a non-positive/non-finite factor — nothing to do
      recordStep(); // one undo step for the whole scale
      set({ tree: next, selectedId: null, sims: reconcileAll(next, sims) });
    },
    setSelectedId: (selectedId) => set({ selectedId }),
    patchSelected: (patch) => {
      const { selectedId, tree, sims } = get();
      if (!selectedId) return;
      beginEdit();
      const next = updateNode(tree, selectedId, patch);
      // Only a change to the motor-mount flag can alter mount topology; a
      // name/length/color/slider patch can't, so skip the full tree walk on the
      // hot per-keystroke edit path.
      const touchesMounts = 'motorMount' in patch;
      set({ tree: next, sims: touchesMounts ? reconcileAll(next, sims) : sims });
    },
    removeSelected: () => {
      const { selectedId, tree, sims } = get();
      if (!selectedId) return;
      recordStep();
      const next = removeNode(tree, selectedId);
      set({ tree: next, selectedId: null, sims: reconcileAll(next, sims) });
    },
    addPartToTree: (type) => {
      recordStep();
      const { tree, selectedId, sims } = get();
      const { tree: next, id } = addPart(tree, type, selectedId);
      set({ tree: next, selectedId: id, sims: reconcileAll(next, sims) });
    },
    addStageToTree: () => {
      recordStep();
      const { tree, sims } = get();
      const { tree: next, id } = addStage(tree);
      set({ tree: next, selectedId: id, sims: reconcileAll(next, sims) });
    },
    moveSelected: (dir) => {
      const { selectedId, tree, sims } = get();
      if (!selectedId) return;
      recordStep();
      const next = moveNode(tree, selectedId, dir);
      set({ tree: next, sims: reconcileAll(next, sims) });
    },
    updateDesignMeta: (patch) => {
      // Applied in one shot from the Rocket-configuration dialog → one undo step.
      beginEdit();
      set((s) => ({ tree: { ...s.tree, ...patch } }));
      commitEdit();
    },
    commitEdit,
    undo: () => {
      commitEdit(); // fold any in-flight edit into history so it undoes in one step
      const { past, future } = get();
      if (!past.length) return;
      const prev = past[past.length - 1]!;
      set({ past: past.slice(0, -1), future: [...future, snap()], ...restore(prev) });
    },
    redo: () => {
      const { past, future } = get();
      if (!future.length) return;
      const next = future[future.length - 1]!;
      set({ future: future.slice(0, -1), past: [...past, snap()], ...restore(next) });
    },

    setActiveId: (activeId) => set({ activeId }), // switching the active sim isn't an edit — no history
    setActiveMotor: (m) => {
      recordStep();
      patchActive(() => ({ motor: m }));
    },
    setActiveIgnition: (event, delay) => {
      beginEdit();
      patchActive(() => ({ ignitionEvent: event, ignitionDelay: delay }));
    },
    setExtraMotor: (mountId, m) => {
      recordStep();
      // ONE simulation's loadout. This map used to be workspace-level, so
      // seating an upper-stage motor changed it for every simulation at once
      // and aged all of their results -- two sims could never differ below the
      // primary mount, which is exactly what comparing staged motors needs.
      // Editing a selection does not bring that back: the motor stays the one
      // thing a tick cannot reach (see patchActive).
      patchActive((sim) => ({
        extraMotors: { ...sim.extraMotors, [mountId]: { ...sim.extraMotors[mountId], spec: m } },
      }));
    },
    setExtraIgnition: (mountId, event, delay) => {
      beginEdit();
      patchActive((sim) => ({
        extraMotors: {
          ...sim.extraMotors,
          [mountId]: { ...sim.extraMotors[mountId]!, ignitionEvent: event, ignitionDelay: delay },
        },
      }));
    },
    patchLaunch: (p) => {
      beginEdit();
      patchTargets((sim) => ({ launch: { ...sim.launch, ...p } }));
    },
    addSim: () => {
      // A fresh simulation starts from the app default motor + the user's global
      // launch defaults (duplicateSim carries an existing setup forward instead).
      recordStep();
      const s = get();
      const name = uniqueSimName(s.sims, (n) => i18n.t('sims.untitled', { n }), s.sims.length + 1);
      const s0 = newSimulation(name, C6, loadSettings().launchDefaults);
      set({ sims: [...s.sims, s0], activeId: s0.id });
    },
    duplicateSim: (id) => {
      const s = get();
      const src = s.sims.find((x) => x.id === id);
      if (!src) return;
      recordStep();
      const copy = i18n.t('sims.copyName', { name: src.name });
      const name = uniqueSimName(s.sims, (n) => (n === 1 ? copy : `${copy} ${n}`), 1);
      // Carry the whole configuration forward: the primary mount's ignition, the
      // rest of the loadout, and any per-simulation option overrides. Duplicate
      // exists to vary ONE thing against an otherwise identical setup, so
      // anything it silently reset would be a trap.
      const s0 = {
        ...newSimulation(name, src.motor, src.launch),
        ignitionEvent: src.ignitionEvent,
        ignitionDelay: src.ignitionDelay,
        extraMotors: src.extraMotors,
        prefs: src.prefs,
      };
      const next = [...s.sims];
      next.splice(s.sims.findIndex((x) => x.id === id) + 1, 0, s0);
      set({ sims: next, activeId: s0.id });
    },
    deleteSim: (id) => {
      const s = get();
      const rest = s.sims.filter((x) => x.id !== id);
      if (!rest.length) return;
      recordStep();
      set({
        sims: rest,
        activeId: id === selectActive(s).id ? rest[0]!.id : s.activeId,
        // A tick on a simulation that no longer exists would silently pad the
        // Run button's count and then be skipped.
        selectedSimIds: s.selectedSimIds.filter((x) => x !== id),
        // Same for the Results picker: a deleted row must not stay in its list,
        // and dropping to one leaves a plain name behind.
        lastRunIds: s.lastRunIds.filter((x) => x !== id),
        resultSimId: s.resultSimId === id ? null : s.resultSimId,
      });
    },
    renameSim: (id, name) => {
      beginEdit();
      set((s) => ({ sims: s.sims.map((x) => (x.id === id ? { ...x, name } : x)) }));
    },
    setSimPref: (key, value) => {
      beginEdit();
      patchTargets((sim) => {
        // A cleared override is REMOVED, not stored as undefined: `prefs` is
        // spread over the globals at run time, and an explicit
        // `timeStep: undefined` would shadow the global with nothing.
        const next = { ...(sim.prefs ?? {}) };
        if (value === null) delete next[key];
        else next[key] = value;
        return { prefs: Object.keys(next).length ? next : undefined };
      });
    },
    clearSimPrefs: () => {
      // Nothing to clear anywhere in the selection is not an edit: opening an
      // empty history entry would make Undo do nothing visible.
      const ids = new Set(selectEditIds(get()));
      if (!get().sims.some((x) => ids.has(x.id) && x.prefs)) return;
      beginEdit();
      // `undefined`, not `{}`: `prefs` is spread over the globals at run time and
      // the SimEditor reads "is anything overridden" from its key count, so an
      // empty object would read as overridden-with-nothing.
      patchTargets(() => ({ prefs: undefined }));
    },
    setResultSimId: (id) => set({ resultSimId: id }),
    toggleSimSelected: (id) =>
      set((st) => ({
        selectedSimIds: st.selectedSimIds.includes(id)
          ? st.selectedSimIds.filter((x) => x !== id)
          : [...st.selectedSimIds, id],
      })),
    setSimsSelected: (ids) => set({ selectedSimIds: ids }),

    runSim: (prefs) => get().runSims([selectActive(get()).id], prefs),

    /**
     * Fly each of these simulations.
     *
     * Runs them CONCURRENTLY: the sim worker pool holds several independent
     * engine instances, so a batch is bounded by the pool rather than by one
     * flight after another (`simClient.ts`). Every request is submitted at once
     * and the pool decides how many are in the air; the rows say which of them
     * are queued and which are running.
     *
     * Order is therefore not guaranteed, and nothing here depends on it. Each
     * result installs itself by id, and the batch-level reporting waits for the
     * whole thing to settle.
     */
    runSims: async (ids, prefs) => {
      const s = get();
      // A fault in the DESIGN stops the whole batch: no motor mount (nowhere to
      // seat a motor) or a part whose required dimension is zero. The Run button
      // is disabled for these too; this is the belt-and-suspenders guard so a
      // programmatic run cannot get past it, and so a zero-volume body tube can
      // never hand back an apogee.
      const blocker = designBlocker(s.tree);
      if (blocker) {
        set({ err: designBlockerText(blocker, i18n.t) });
        return;
      }
      const targets = ids.filter((id) => s.sims.some((x) => x.id === id));
      if (!targets.length) return;

      // What we are about to fly. The awaits below can outlast the design: if the
      // user edits while the pool is busy, the answers coming back describe a
      // rocket that no longer exists, and installing them would show numbers for
      // geometry that is no longer on screen.
      const ranOn = s.tree;
      // Collected, not reported as they happen. Each skip used to `set({err})`
      // on its own, so in a batch every message overwrote the one before it and
      // the user was left holding whichever row failed last -- with no name on
      // it. They are reported together once the batch drains.
      const skipped: Unflyable[] = [];
      // Failures are collected for the same reason skips are, and it is the
      // same bug one step later: each row's catch did `set({ err })`, so in a
      // batch every message overwrote the one before it and carried no row
      // name -- and then the skip line below overwrote whatever survived. Six
      // rows with two timeouts and one missing motor reported only the missing
      // motor, with no sign that two flights had failed at all.
      const failed: { name: string; msg: string }[] = [];
      /** Patch one row's transient run state, leaving every other row alone. */
      const setRun = (simId: string, run: SimRun | null) =>
        set((st) => {
          const next = { ...st.simRuns };
          if (run) next[simId] = run;
          else delete next[simId];
          return { simRuns: next };
        });

      // Decide what actually flies BEFORE anything is dispatched, so the queued
      // rows all light up together rather than one at a time.
      const flying: { sim: Simulation; launch: CompleteLaunch }[] = [];
      for (const simId of targets) {
        const sim = s.sims.find((x) => x.id === simId);
        if (!sim) continue;
        // Why a row cannot fly is decided in ONE place, shared with the Run
        // button (services/runnability). A row with no usable motor, or with
        // launch conditions outside the NAR/Tripoli codes, is skipped: those
        // are simulation settings rather than design, so there is nothing to
        // preserve by flying them, and a number this app will not stand
        // behind is worse than no number. One bad row never abandons the rest.
        const reason = unflyable(sim);
        if (reason) {
          skipped.push({ id: simId, name: sim.name, reason });
          setRun(simId, { phase: 'failed', tree: ranOn });
          continue;
        }
        // `unflyable` already established that every required launch field is
        // present; this restates it for the type system, which cannot see
        // that through the reason object. simConditions takes a CompleteLaunch
        // precisely so a blank can never be quietly turned into a number on
        // its way to the engine.
        if (!isComplete(sim.launch)) continue;
        flying.push({ sim, launch: sim.launch });
      }
      if (!flying.length) {
        if (skipped.length) set({ err: skipped.map((u) => unflyableText(u, i18n.t)).join(' ') });
        return;
      }

      // One controller for the whole batch: Cancel is "stop what I started",
      // not "stop this row". Replaced per batch rather than reused, since an
      // AbortController cannot be un-aborted.
      const abort = new AbortController();
      batchAbort = abort;
      set({ simBusy: true, err: null });
      for (const { sim } of flying) setRun(sim.id, { phase: 'queued' });
      try {
        await Promise.all(
          flying.map(async ({ sim, launch }) => {
            // What this row is being flown FROM. The design has `ranOn`; this is
            // the same guard per simulation, for the motor, ignition, launch
            // conditions and run overrides that only this row carries.
            const flownFrom = simInputs(sim);
            try {
              // The sim runs in a Web Worker (its own engine instance), off the main
              // thread, so a ~500 ms flight never freezes the UI. The worker rebuilds
              // the rocket from the posted tree/motors — identical to the main-thread
              // build (buildConfiguredRocket) — so the result matches what's on screen.
              const result = await simulateInWorker(
                {
                  tree: ranOn,
                  motor: sim.motor,
                  extraMotors: sim.extraMotors,
                  primaryIgnition: { event: sim.ignitionEvent, delay: sim.ignitionDelay },
                  // The sim's own overrides win over the global preferences; unset keys
                  // fall through, so a workspace that never touches them runs as before.
                  options: simConditions(launch, { ...prefs, ...sim.prefs }),
                },
                // Queued and running are different states once there is a pool:
                // the client says when this one actually reached a worker.
                { onStart: () => setRun(sim.id, { phase: 'running' }), signal: abort.signal },
              );
              // The design moved on mid-batch: this answer describes the old
              // rocket, so drop it rather than install numbers for geometry that
              // is no longer on screen. The others in flight do the same.
              if (get().tree !== ranOn) return;
              // Same test for THIS row's own inputs. Editing a simulation's
              // launch conditions while it flies used to be prevented by locking
              // the editor for the duration; dropping the answer is the same
              // answer the design already gets, and it leaves the row where the
              // edit left it -- outdated, with its previous numbers -- instead of
              // marking it current against conditions it no longer has.
              const now = get().sims.find((x) => x.id === sim.id);
              if (!now || !sameSimInputs(flownFrom, simInputs(now))) {
                setRun(sim.id, null);
                return;
              }
              setRun(sim.id, null);
              set((st) => ({
                sims: st.sims.map((x) => (x.id === sim.id ? { ...x, result, outdated: false } : x)),
              }));
            } catch (e) {
              // Canceling is not a fault: the row goes back to what it was
              // (its old result, or nothing) rather than turning red, and the
              // error banner stays empty. Anything else IS a fault.
              if (e instanceof SimCanceledError) {
                setRun(sim.id, null);
                return;
              }
              // A timeout means the worker was killed mid-hang; show a friendly line
              // rather than the raw sentinel.
              const msg =
                e instanceof SimTimeoutError ? i18n.t('sim.timeout') : e instanceof Error ? e.message : String(e);
              setRun(sim.id, { phase: 'failed', tree: ranOn });
              failed.push({ name: sim.name, msg });
            }
          }),
        );
        // A canceled batch says nothing further: the user stopped it, so
        // neither the skip list nor a jump to the Results tab is wanted.
        if (abort.signal.aborted) return;
        // ONE line for everything that did not produce a flight, refusals and
        // failures together, each naming its row.
        const problems = [
          ...skipped.map((u) => unflyableText(u, i18n.t)),
          ...failed.map((f) => i18n.t('sim.failedNamed', { name: f.name, message: f.msg })),
        ];
        if (problems.length) set({ err: problems.join(' ') });
        // Show the run. Every run, one or twelve: running IS asking to see the
        // answer, and having to click over to Results afterwards was a step with
        // nothing behind it.
        //
        // `lastRunIds` is what the Results tab reads to decide between a name and
        // a picker, and `resultSimId` points it at this run rather than at
        // whatever was being read before.
        if (get().tree !== ranOn) return;
        const landed = flying.map((f) => f.sim.id).filter((id) => get().sims.find((x) => x.id === id)?.result);
        if (landed.length) {
          // Show the row you were working on when it is one of the ones that
          // flew, else the first of the batch. Landing on some other row's
          // flight after running is disorienting: you asked for these, and the
          // active one is the one you were just looking at.
          const active = selectActive(get()).id;
          const show = landed.includes(active) ? active : landed[0]!;
          set({ lastRunIds: landed, resultSimId: show, view: 'flight', tab: 'results' });
        }
      } finally {
        // Only if no LATER batch has started: a run kicked off while this one
        // was unwinding owns the flag and the controller now.
        if (batchAbort === abort) {
          batchAbort = null;
          set({ simBusy: false });
        }
      }
    },

    /**
     * Run everything whose numbers are not current: never flown, or flown
     * against a design that has since changed.
     *
     * Deliberately independent of the tick boxes. "Bring this workspace up to
     * date" is a different question from "fly these rows", and making it reuse
     * the selection would mean clearing and restoring whatever the user had
     * ticked.
     */
    runOutdated: async (prefs) => {
      const stale = get()
        .sims.filter((x) => !x.result || x.outdated)
        .map((x) => x.id);
      if (!stale.length) return;
      await get().runSims(stale, prefs);
    },

    /**
     * Stop the batch in flight.
     *
     * Rows that already landed keep their results — canceling is "stop
     * starting new ones and drop what is still going", not an undo. A row still
     * waiting for a worker is simply dropped; one already inside a worker costs
     * that worker, since a synchronous engine call cannot be interrupted any
     * other way (the pool spawns a replacement on the next run).
     */
    cancelRun: () => {
      batchAbort?.abort();
    },

    // The two below keep the mobile tab and the center-pane view in step -- see
    // {@link showing}. Harmless at desktop widths, where the tab bar is hidden
    // and `tab` only decides what a later resize lands on.
    setTab: (tab) =>
      set((s) => {
        if (tab === 'results') return { tab, view: isResultView(s.view) ? s.view : 'flight' };
        if (tab === 'design') return { tab, view: isResultView(s.view) ? '2d' : s.view };
        return { tab };
      }),
    setDesignPane: (designPane) =>
      set((s) => ({ tab: 'design', designPane, view: isResultView(s.view) ? '2d' : s.view })),
    setView: (view) => set((s) => showing(s, view)),
    setTwoD: (twoD) => set({ twoD }),
    setRoll: (roll) => set({ roll }),
    rollBy: (d) =>
      set((s) => {
        const x = (s.roll + d) % (2 * Math.PI);
        return { roll: x < 0 ? x + 2 * Math.PI : x };
      }),
    resetView: () => set((s) => ({ roll: 0, resetKey: s.resetKey + 1 })),

    openOrkFile: async (file) => {
      // Three awaits before anything is written, and the file input has no busy
      // gate — so a second import (or a library open) can land in between.
      const stale = claimWorkspace();
      try {
        // The .ork parser (fflate + XML importer) is a lazily-imported chunk —
        // it isn't part of first paint, only of opening a file.
        const bytes = await file.arrayBuffer();
        if (stale()) return;
        const { loadOrk } = await import('../services/loadOrk');
        const res = await loadOrk(bytes);
        if (stale()) return;
        const { tree, extraMotors, sim0, loadedMeta } = wireLoadedOrk(res, loadSettings().launchDefaults);
        clearHistory(); // a loaded design is a fresh document — nothing to undo across the load
        // An imported rocket becomes its OWN library entry rather than
        // replacing whatever was open.
        getWorkspaceStore().setActiveId?.(null);
        // Launch conditions are simulation settings, so a file carrying them
        // outside the safety codes is flagged on the way in rather than
        // silently flown. The run refuses too (see runSims).
        const outside = launchLimitViolations(sim0.launch);
        const notes = outside.length
          ? [...loadedMeta.notes, ...outside.map((v) => limitText(v, i18n.t))]
          : loadedMeta.notes;
        replaceWorkspace({
          tree,
          loadedMeta: { ...loadedMeta, notes },
          // The import's non-primary-mount motors ARE this simulation's loadout.
          sims: [{ ...sim0, extraMotors }],
          activeId: sim0.id,
          selectedId: null,
          tab: 'design',
          designPane: 'stats',
          view: '2d',
          activeDesignId: null,
        });
      } catch (e) {
        if (stale()) return; // a superseded import must not post its error either
        set({ err: i18n.t('errors.openOrk', { reason: e instanceof Error ? e.message : String(e) }) });
      }
    },
    openExample: async (file) => {
      // Fetched, then handed to the ordinary import path — an example is an
      // import that happens to ship with the app, so it gets the same notes
      // banner, the same safety-limit check and the same unsaved-copy
      // semantics, with no second code path to keep in step.
      try {
        const bytes = await fetchExample(file);
        await get().openOrkFile(new Blob([bytes]));
      } catch (e) {
        set({ err: i18n.t('errors.openExample', { reason: e instanceof Error ? e.message : String(e) }) });
      }
    },
    refreshDesigns: async () => {
      // The only async action without a guard. It is called from four places
      // that can overlap (openDesign's tail, deleteDesign's tail, saveDesignAs
      // and the library dialog), so a slower earlier call landing last put a
      // just-deleted design back in the list, where clicking it takes the
      // `library.missing` path.
      const mine = ++designsGen;
      const lib = getDesignLibrary();
      const [designs, activeDesignId] = [await lib.list(), await lib.activeId()];
      if (mine !== designsGen) return;
      set({ designs, activeDesignId });
    },

    openDesign: async (id) => {
      // Four sequential awaits, and the user can click a second design during
      // any of them. If B's read resolved first, A's continuation then ran
      // flushActive() — writing B's tree out under the store's current active
      // id — and finished with setActive(A) + hydrate(A). The user clicked B
      // last and was looking at A. A monotonic token makes every continuation
      // check it is still the most recent request before it touches anything.
      const stale = claimWorkspace();

      const lib = getDesignLibrary();
      // The boot path runs every stored design through the same shape check
      // before it hydrates; this path read the raw blob and handed it straight
      // to hydrate(), where a non-array `tree.components` reaches reconcileAll
      // and then the kernel. Same check, same `library.missing` outcome.
      const w = validateWorkspace(await lib.read(id));
      if (stale()) return;
      if (!w) {
        set({ err: i18n.t('library.missing') });
        await get().refreshDesigns();
        return;
      }
      // Persist whatever is open BEFORE switching, or the edits since the last
      // debounced autosave would be lost to the swap. A refused write does not
      // block the switch (the user asked to open something else), but it is
      // not silent either.
      if (!(await flushActive()) && !stale()) get().setStorageWarning(i18n.t('storage.full'), 'full');
      if (stale()) return;
      // A refused pointer write means this session would edit B while the
      // library still names A, and the next launch reopens A. Stop before the
      // store is touched, so what the user sees and what is active agree.
      if (!(await lib.setActive(id))) {
        if (!stale()) get().setStorageWarning(i18n.t('storage.full'), 'full');
        return;
      }
      if (stale()) return;
      getWorkspaceStore().setActiveId?.(id);
      clearHistory(); // a different design is a different document
      get().hydrate(w);
      set((s) => ({ selectedId: null, ...showing(s, '2d') }));
      await get().refreshDesigns();
    },

    saveDesign: async () => {
      // Autosave already runs on a 500 ms debounce, so this is not the only
      // thing standing between the user and data loss — it is the explicit
      // "commit it now" they expect from a Save menu item, and it also names
      // a design that has never been saved (New / freshly imported).
      //
      // Ask the LIBRARY, not the cached `activeDesignId`. That field is written
      // only by refreshDesigns(), which nothing calls on boot — it fires from
      // the File menu and the library dialog — so on a fresh load it is null
      // while the first autosave has already created a real entry
      // (workspaceStore.ts:150-157 calls lib.create when it has no active id).
      // Reading the stale null sent File→Save to Save As, whose create() made a
      // SECOND entry with the same rocket, leaving every autosave so far in the
      // orphan the user never named.
      //
      // Three outcomes, not two: `true` saved, `'unnamed'` needs Save As, and
      // `false` the write was refused (the banner is raised here; the caller
      // must NOT fall through to Save As, whose create() would be refused too).
      const stale = observeWorkspace();
      if (!(await getDesignLibrary().activeId())) return 'unnamed';
      if (stale()) return false;
      const ok = await flushActive();
      if (stale()) return false; // the design moved on; this write is not its save
      if (!ok) {
        get().setStorageWarning(i18n.t('storage.full'), 'full');
        return false;
      }
      await get().refreshDesigns();
      return true;
    },

    saveDesignAs: async (name) => {
      const s = get();
      // `create` now THROWS when storage refuses the write, rather than handing
      // back a fabricated meta for a design that was never stored. AppHeader
      // fires this with `void`, so surface it here or it becomes an unhandled
      // rejection and the user sees a Save As that appeared to work.
      // `s` is snapshotted NOW; if the workspace is replaced while create() is
      // in flight, pointing the library at the new entry would leave the user
      // looking at one design with another one active.
      const stale = observeWorkspace();
      let meta;
      try {
        meta = await getDesignLibrary().create(name.trim() || i18n.t('library.untitled'), snapshotOf(s));
      } catch {
        if (stale()) return;
        get().setStorageWarning(i18n.t('storage.full'), 'full');
        return;
      }
      if (stale()) return;
      getWorkspaceStore().setActiveId?.(meta.id);
      await get().refreshDesigns();
    },

    renameDesign: async (id, name) => {
      // `rename` reports a refused index write; ignoring it showed the new name
      // from memory and the old one next session.
      if (!(await getDesignLibrary().rename(id, name.trim() || i18n.t('library.untitled')))) {
        get().setStorageWarning(i18n.t('storage.full'), 'full');
      }
      await get().refreshDesigns();
    },

    deleteDesign: async (id) => {
      const lib = getDesignLibrary();
      const wasActive = get().activeDesignId === id;
      // A refused index write means the design is still in the library; resetting
      // the open workspace anyway would leave it listed and unopenable-looking.
      if (!(await lib.remove(id))) {
        get().setStorageWarning(i18n.t('storage.full'), 'full');
        await get().refreshDesigns();
        return;
      }
      // Deleting the open design leaves nothing to autosave into; start fresh so
      // the next edit creates a new library entry rather than resurrecting it.
      // Read BEFORE the await: opening another design during remove() would
      // otherwise leave activeDesignId pointing at the new one and skip the
      // reset — or, worse, reset the design the user had just switched to.
      if (wasActive && get().activeDesignId === id) {
        getWorkspaceStore().setActiveId?.(null);
        get().resetWorkspace();
      }
      await get().refreshDesigns();
    },

    resetWorkspace: () => {
      claimWorkspace(); // New: any import or library open still in flight is void
      const s0 = newSimulation('Simulation 1', C6, loadSettings().launchDefaults);
      clearHistory(); // starting a new design drops the previous design's undo stack
      // Detach from the open library entry, or the first autosave would write
      // this blank design straight over the rocket the user just had open.
      getWorkspaceStore().setActiveId?.(null);
      replaceWorkspace((s) => ({
        activeDesignId: null,
        tree: specToTree(DEFAULT_SPEC).tree,
        loadedMeta: null,
        sims: [s0],
        activeId: s0.id,
        selectedId: null,
        ...showing(s, '2d'),
      }));
    },
    newWorkspace: async () => {
      const ok = await confirm({
        title: i18n.t('file.new'),
        message: i18n.t('file.newConfirm'),
        confirmLabel: i18n.t('common.discard'),
        danger: true,
      });
      if (ok) get().resetWorkspace();
    },
    saveOrk: async () => {
      try {
        const { tree, loadedMeta } = get();
        const active = selectActive(get());
        const extraMotors = active.extraMotors;
        const motors = buildExportMotorMap(
          tree,
          { motor: active.motor, ignitionEvent: active.ignitionEvent, ignitionDelay: active.ignitionDelay },
          extraMotors,
          loadedMeta?.exportMotors ?? {},
        );
        // Derived-statistics block — only when the user opted in (off by default,
        // so a normal save stays byte-identical). Built from the same report model
        // the PDF export uses; both are lazily imported (also avoids a static
        // store → reportModel → store import cycle).
        let designInfo: DesignInfo | undefined;
        if (loadSettings().saveDesignInfo) {
          const [{ assembleReport }, { buildDesignInfo }] = await Promise.all([
            import('../services/reportModel'),
            import('../services/designInfo'),
          ]);
          const report = assembleReport();
          if (report) designInfo = buildDesignInfo(report);
        }
        // The .ork writer is a lazily-imported chunk — only needed on save.
        const { downloadOrk } = await import('../services/saveOrk');
        downloadOrk({
          name: tree.name || loadedMeta?.name || defaultDesignName(),
          tree,
          motors,
          launch: selectActive(get()).launch,
          designInfo,
        });
      } catch (e) {
        set({ err: i18n.t('errors.saveOrk', { reason: e instanceof Error ? e.message : String(e) }) });
      }
    },
    saveRasaero: async () => {
      try {
        const { tree, loadedMeta, info } = get();
        const active = selectActive(get());
        const extraMotors = active.extraMotors;
        // Same motor map the .ork exporter builds — OrkExportMotor satisfies the
        // CDX1 engine-string writer's Cdx1ExportEngine verbatim.
        const motors = buildExportMotorMap(
          tree,
          { motor: active.motor, ignitionEvent: active.ignitionEvent, ignitionDelay: active.ignitionDelay },
          extraMotors,
          loadedMeta?.exportMotors ?? {},
        );
        // The RASAero writer is a lazily-imported chunk — only needed on export.
        const { downloadCdx1 } = await import('../services/rasaeroExport');
        downloadCdx1({
          name: tree.name || loadedMeta?.name || defaultDesignName(),
          tree,
          motors,
          launch: active.launch,
          // Whole-rocket loaded mass/CG feed RASAero's mandatory simulation block.
          launchMassKg: info?.mass,
          launchCgM: info?.cg,
        });
      } catch (e) {
        set({ err: i18n.t('errors.exportRasaero', { reason: e instanceof Error ? e.message : String(e) }) });
      }
    },
    exportComponent: async (nodeId, format) => {
      try {
        const { exportComponent } = await import('../services/componentExport');
        const ok = await exportComponent(get().tree, nodeId, format);
        if (!ok) set({ err: i18n.t('errors.exportUnsupported', { format: format.toUpperCase() }) });
      } catch (e) {
        set({
          err: i18n.t('errors.exportFailed', {
            format: format.toUpperCase(),
            reason: e instanceof Error ? e.message : String(e),
          }),
        });
      }
    },
  };
});
