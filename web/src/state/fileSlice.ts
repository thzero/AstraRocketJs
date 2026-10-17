import type { StateCreator } from 'zustand';
import i18n from '../i18n';
import { confirm } from './confirmStore';
import { prompt } from './promptStore';
import { defaultRocketTree } from '../services/design/defaultRocket';
import { launcherKind } from '../services/design/launcher';
import { mergePalette } from '../services/design/partColors';
import type { DesignInfo } from '../services/files/orkTypes';
import type { buildRocketTree } from '../engine/api';
import type { ComponentInfo, RocketTree } from '../engine/openRocketEngine';
import type { StageLaunch } from '../services/files/rasaero/stageLaunch';
import { buildDesignInfo } from '../services/report/designInfo';
import { buildExportMotorMap, fillMotorDigests } from '../services/motors/exportMotors';
import { repairValues } from '../services/design/repairValues';
import { builtFrom, computeStaticInfo } from '../services/design/buildRocket';
import { walkNodes } from '../tree/treeWalk';
import { wireLoadedOrk } from '../services/files/wireLoadedOrk';
import { assertImportSize } from '../services/files/decodeText';
// Static, not the lazy import the neighboring .ork paths use: this is a fetch
// wrapper with no heavy dependencies, and the library dialog imports it
// statically anyway, so a dynamic import here only produces rolldown's
// ineffective-dynamic-import warning without moving a byte.
import { fetchExample } from '../services/storage/exampleLibrary';
import { effectivePrefs, isOutdated, newSimulation } from '../services/flight/simulations';
import { loadSettings } from '../services/storage/settings';
import { importNotes } from '../services/files/importBanner';
import { configPowerClass } from '../services/flight/powerClass';
import { configFor, configuredTree } from '../services/flight/flightConfigs';
import { defaultDesignName, designNameOf } from '../services/app/appInfo';
import { getDesignLibrary, type DesignMeta } from '../services/storage/designLibrary';
import { getWorkspaceStore, lean, resultsOf } from '../services/storage/workspaceStore';
import { migrateWorkspace } from '../services/storage/workspaceMigrate';
import { errorText, keyedText, type Keyed } from '../i18n/keyedError';
import { fmtList } from '../i18n/format';
import {
  configOf,
  defaultConfig,
  displayUnits,
  repairNotes,
  saveFailure,
  selectActive,
  selectConfig,
  selectDesignName,
  workspaceSnapshot,
} from './workspaceSelectors';
import type { WorkspaceState } from './store';
import { showing } from './viewSlice';
import { holdSaves, markWritten, savesHeld, unchangedSinceWrite, voidPendingAutosave } from './writtenWorkspace';

/**
 * Opening, saving and exporting designs, and the design library.
 *
 * Nothing is imported from './store' at run time, only its types: store.ts
 * imports this file and calls `createFileSlice` while it is still loading, so a
 * value read from it here would not exist yet. The helpers it needs live in
 * './workspaceSelectors'.
 */
export interface FileSlice {
  /** Open a `.ork`. A `Blob` rather than a `File` so a bundled example, which
   *  arrives as bytes from a fetch, takes the identical path a picked file does;
   *  `.size` and `.arrayBuffer()` are all this needs from a File. */
  openOrkFile: (file: Blob) => Promise<void>;
  /** Open one of the bundled OpenRocket examples by its file name. */
  openExample: (file: string) => Promise<void>;
  resetWorkspace: () => void;
  /** Saved designs, newest first (designLibrary.ts). Refreshed on demand. */
  designs: DesignMeta[];
  /** Id of the design currently being edited, or null before the first save. */
  activeDesignId: string | null;
  /**
   * Counts the files opened this session (`openOrkFile`). Not saved, so
   * reopening the app on the same design does not count as an import; the import
   * notes open for each new import that has some (LoadedBanner).
   */
  importSeq: number;
  /**
   * Bumped when an import that reset the engine did not replace the design (it
   * failed, or the user abandoned it). The reset voided the open design's live
   * handle, so the rebuild effect (useWorkspaceEffects) builds it again.
   */
  rebuildSeq: number;
  refreshDesigns: () => Promise<void>;
  openDesign: (id: string) => Promise<void>;
  saveDesignAs: (name: string) => Promise<void>;
  renameDesign: (id: string, name: string) => Promise<void>;
  deleteDesign: (id: string) => Promise<void>;
  // These are implemented `async` and typed to return the promise, so callers
  // and tests can await them. AppHeader calls them through `fireAction`, which
  // reports a rejection rather than dropping it.
  newWorkspace: () => Promise<void>;
  /**
   * Store the open design's last edits, then start a fresh one. No prompt: the
   * caller has asked. `resetWorkspace` alone voids the pending autosave, so an
   * edit inside its debounce would be lost.
   */
  leaveForNew: () => Promise<void>;
  saveOrk: () => Promise<void>;
  /** Write the design as a RockSim `.rkt`. */
  saveRkt: () => Promise<void>;
  /** Write the design's printable parts as 3MF (one file, or a zip of files). */
  exportPrint: (opts: import('../services/exports/rocketPrintExport').PrintExportOptions) => Promise<void>;
  saveRasaero: () => Promise<void>;
  /** Write the design as JSON, the payload the AstraRocketOnshapeImport feature builds a Part Studio from. */
  exportJson: () => Promise<void>;
  /** Export a single component as a 3D mesh (stl/obj/glb) or a 2D cut sheet (dxf). */
  exportComponent: (nodeId: string, format: import('../services/files/componentFormats').ExportFormat) => Promise<void>;
}

/** What the file actions share with the editing core in store.ts. */
interface FileSliceShared {
  /** Swap in a whole new workspace, resetting the per-design transient state. */
  replaceWorkspace: (patch: Partial<WorkspaceState> | ((s: WorkspaceState) => Partial<WorkspaceState>)) => void;
  /** Drop undo history: a loaded or new design is a fresh document. */
  clearHistory: () => void;
}

/**
 * One monotonic counter for "which workspace is open".
 *
 * Every action that replaces the workspace races with every other, not just
 * with itself: import a large .ork then a small one and the small one lands
 * first, with the large one overwriting it; open a library design and then
 * import, and the import's `setActiveId(null)` lands before openDesign's
 * continuation, which flushes the imported rocket out under a null id (a stray
 * entry) and hydrates the library design over the top of it.
 *
 * So every action that replaces the workspace bumps this, and every
 * continuation past an await re-checks before it touches the store.
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
 * Observe the workspace without claiming it: the predicate reports whether
 * someone replaced it, but taking this token does not itself count as a
 * replacement.
 *
 * `saveDesignAs` and `saveOrk` do not replace the workspace; they only need to
 * notice if something else did. `claimWorkspace` would bump the generation and
 * invalidate every other continuation: hitting Save As while a large `.ork`
 * parsed would make `openOrkFile`'s `stale()` true, and both its success and its
 * error paths are gated on that, so nothing would load and nothing be reported.
 */
const observeWorkspace = (): (() => boolean) => {
  const mine = workspaceGen;
  return () => mine !== workspaceGen;
};

/** Each part's kernel figures by id; undefined for a part the build does not hold. */
type KernelFigures = (id: string) => ComponentInfo | undefined;

/**
 * A build's figures for every part of `tree`, for the writers' values the
 * kernel works out itself; a part the build does not hold has none, and the
 * writers say what that leaves out.
 *
 * Read now rather than on demand: the next build frees this handle
 * (`buildRocketTree`), and a save awaits before it writes.
 */
function figuresOf(rocket: ReturnType<typeof buildRocketTree>, tree: RocketTree): KernelFigures {
  const figures = new Map<string, ComponentInfo>();
  for (const node of walkNodes(tree.components)) {
    if (typeof node.id !== 'string') continue;
    try {
      figures.set(node.id, rocket.componentInfo(node.id));
    } catch {
      // not in this build
    }
  }
  return (id: string) => figures.get(id);
}

export const createFileSlice =
  ({ replaceWorkspace, clearHistory }: FileSliceShared): StateCreator<WorkspaceState, [], [], FileSlice> =>
  (set, get) => {
    /**
     * Write the open design out now, ahead of switching away from it. False if
     * storage refused the write.
     *
     * The refusal is reported rather than swallowed: only the debounced
     * autosave's catch raises the storage banner, and a switch or a delete
     * calls this directly, inside the 500 ms debounce, so on a full store the
     * edits since the last autosave would be lost with nothing said. Callers
     * decide what a refusal means for them (a switch still proceeds).
     */
    const flushActive = async (): Promise<boolean> => {
      // Storage already holds it: a write would only re-stamp the design, or
      // after New create an entry for one nobody touched.
      const fields = get();
      if (unchangedSinceWrite(fields)) return true;
      // The open design is being deleted (see `holdSaves`).
      if (savesHeld()) return true;
      try {
        await getWorkspaceStore().save(workspaceSnapshot(fields));
        markWritten(fields);
        // A landed write disproves a standing "full" or conflict warning.
        get().clearSaveWarning();
        return true;
      } catch (e) {
        // Recorded rather than returned, so a caller that only cares whether the
        // write landed still reports the right reason it did not.
        lastFlushFailure = e;
        return false;
      }
    };

    /**
     * Write the open design before something replaces it. A refused write does
     * not block the replace (the user asked for the other design), but it is
     * not silent either.
     */
    const flushOutgoing = async (stale: () => boolean): Promise<void> => {
      // The flush writes what the pending autosave would have, and that timer
      // can fire after the workspace store has moved to the incoming design.
      voidPendingAutosave();
      if (!(await flushActive()) && !stale()) {
        const { msg, kind } = saveFailure(lastFlushFailure);
        get().setStorageWarning(msg, kind);
      }
    };
    /** Why the last `flushActive` returned false, for the caller that reports it. */
    let lastFlushFailure: unknown = null;

    /**
     * Point the library back at the design on screen, for an open or import
     * that ends without replacing it.
     *
     * An open names its design active before it reads it, and an open it
     * superseded may have done the same, so a failed one can leave the
     * library naming a design nobody is looking at. The next boot would open
     * that design, and the edits made meanwhile live in the other one. Called
     * only by the action that holds the workspace (not stale), so it never
     * moves a pointer a later action set.
     */
    const pointAtShown = async (): Promise<void> => {
      const shown = get().activeDesignId;
      if (!shown) return;
      const lib = getDesignLibrary();
      if ((await lib.activeId()) !== shown) await lib.setActive(shown);
    };

    /**
     * The kernel's figures for `tree`, the open design, for a file about to be
     * written. The store's build counts only when it was made from this tree: one
     * still inside the rebuild debounce describes an earlier design, so the
     * design is built now instead. Undefined when it does not build.
     */
    const figuresFor = (tree: RocketTree): KernelFigures | undefined => {
      const { rocket } = get();
      if (rocket && builtFrom(rocket) === tree.components) return figuresOf(rocket, tree);
      const built = computeStaticInfo(tree, selectConfig(get()));
      if ('error' in built) return undefined;
      // The new build freed the store's handle, so it takes this one.
      get().applyBuild(built.info, built.rocket);
      return figuresOf(built.rocket, tree);
    };

    /** "Rocket" → "Rocket (2)", "Rocket (3)", … against the names already taken. */
    const uniqueName = (base: string, taken: string[]): string => {
      const used = new Set(taken.map((n) => n.trim().toLowerCase()));
      if (!used.has(base.toLowerCase())) return base;
      for (let n = 2; n < 1000; n++) {
        const candidate = `${base} (${n})`;
        if (!used.has(candidate.toLowerCase())) return candidate;
      }
      return `${base} (${Date.now()})`;
    };

    /**
     * Decide which library entry an imported rocket belongs in, and do it before
     * the rocket replaces what is open.
     *
     * An import detaches the workspace store, so the next debounced autosave
     * creates an entry. That is deliberate (an imported rocket is its own design,
     * not an edit to whatever was on screen), but without a name check,
     * re-importing the same .ork (edit in OpenRocket, import, edit, import…) or
     * reopening the same example would stack up identically named rows in
     * File > Open with nothing to tell them apart.
     *
     * So on a name clash, ask: overwrite that design, or name this one something
     * else. The answer has to be settled here, ahead of `replaceWorkspace`,
     * because the 500 ms autosave debounce would otherwise fire while the dialog
     * is still open and create the very entry being asked about.
     *
     * Returns the entry to write into (`id`, or null to create one under `name`),
     * or null to abandon the import.
     */
    const homeForImport = async (
      importedName: string,
      stale: () => boolean,
    ): Promise<{ id: string | null; name: string } | null> => {
      const lib = getDesignLibrary();
      const wanted = importedName.trim() || defaultDesignName();
      const list = await lib.list();
      if (stale()) return null;
      const clash = list.find((m) => m.name.trim().toLowerCase() === wanted.toLowerCase());
      if (!clash) return { id: null, name: wanted };

      const overwrite = await confirm({
        title: i18n.t('library.importClashTitle'),
        message: i18n.t('library.importClash', { name: clash.name }),
        confirmLabel: i18n.t('library.overwrite'),
        cancelLabel: i18n.t('library.renameInstead'),
      });
      if (stale()) return null;
      if (overwrite) {
        // Same rule as openDesign: a refused pointer write would leave this
        // session editing one design while the library names another, so stop
        // before anything is replaced and the user keeps what they had.
        if (!(await lib.setActive(clash.id))) {
          if (!stale()) get().warnStorageFull();
          return null;
        }
        return stale() ? null : { id: clash.id, name: clash.name };
      }

      const taken = list.map((m) => m.name);
      const suggested = uniqueName(wanted, taken);
      const chosen = await prompt({
        title: i18n.t('library.importNameTitle'),
        confirmLabel: i18n.t('common.save'),
        initialName: suggested,
        takenNames: taken,
      });
      if (stale()) return null;
      // Canceling the name dialog does not cancel the import: the file is parsed
      // and about to be on screen, and the one outcome this flow exists to rule
      // out is a second row with the same name. Fall back to the suggestion.
      return { id: null, name: chosen?.trim() || suggested };
    };

    return {
      designs: [],
      activeDesignId: null,
      importSeq: 0,
      rebuildSeq: 0,

      openOrkFile: async (file) => {
        // Several awaits before anything is written, and the file input has no busy
        // gate, so a second import (or a library open) can land in between.
        const stale = claimWorkspace();
        // Whether `loadOrk` has run (which can reset the engine) without the
        // workspace being replaced by its result.
        let engineTouched = false;
        try {
          // The .ork parser (fflate + XML importer) is a lazily-imported chunk:
          // it isn't part of first paint, only of opening a file. The size is
          // checked first: arrayBuffer() holds every byte of the file in memory.
          assertImportSize(file.size);
          const bytes = await file.arrayBuffer();
          if (stale()) return;
          const { loadOrk } = await import('../services/files/loadOrk');
          engineTouched = true;
          const res = await loadOrk(bytes);
          if (stale()) return;
          const { tree, configs, sims, activeId, loadedMeta } = wireLoadedOrk(
            res,
            loadSettings().launchDefaults,
            get().simPrefs,
          );
          // Where this rocket is going to live, settled while the previous design
          // is still the open one (see homeForImport).
          const home = await homeForImport(loadedMeta.name, stale);
          if (stale()) return;
          if (!home) {
            await pointAtShown();
            return;
          }
          // Persist whatever is open before the import replaces it, as
          // openDesign does: the replace cancels the pending debounced
          // autosave, so an edit inside its window would be lost.
          await flushOutgoing(stale);
          if (stale()) return;
          clearHistory(); // a loaded design is a fresh document; nothing to undo across the load
          // An imported rocket becomes its own library entry rather than
          // replacing whatever was open, unless the user chose to overwrite a
          // design of the same name, in which case that entry is its home.
          getWorkspaceStore().setActiveId?.(home.id);
          if (!home.id) getWorkspaceStore().setPendingName?.(home.name);
          // A file is the likeliest source of a value no material has, and the
          // one place the app can still say where it came from.
          const fixed = repairValues(tree);
          // Worded for the imported design's launcher, not the one still open:
          // the store's tree is the previous design until replaceWorkspace below.
          const launcher = launcherKind(fixed.tree);
          // Before the engine has built the imported rocket, so the motors
          // alone decide each configuration's class here; the run gate judges
          // again with the rocket's mass.
          const flights = sims.map((sim) => ({
            launch: sim.launch,
            powerClass: configPowerClass(fixed.tree, configFor(configs, sim.configId), null),
          }));
          const notes = importNotes(loadedMeta.notes, flights, launcher, displayUnits());
          replaceWorkspace({
            repairNotes: repairNotes(fixed.repaired),
            tree: fixed.tree,
            loadedMeta: { ...loadedMeta, notes },
            // Every configuration the file declared, and a simulation per
            // configuration to fly it.
            sims,
            configs,
            activeId,
            selectedId: null,
            tab: 'design',
            designPane: 'stats',
            view: '2d',
            // Null while the entry is still to be created; the overwrite path
            // already has one, and the library marks it as the open design.
            activeDesignId: home.id,
            importSeq: get().importSeq + 1,
          });
          engineTouched = false;
        } catch (e) {
          if (stale()) return; // a superseded import must not post its error either
          set({ err: i18n.t('errors.openOrk', { reason: errorText(e, i18n.t) }) });
          await pointAtShown().catch(() => {});
        } finally {
          // Failed or abandoned after the engine may have been reset: the design
          // still on screen holds a voided handle until it is built again.
          if (engineTouched) set({ rebuildSeq: get().rebuildSeq + 1 });
        }
      },
      openExample: async (file) => {
        // Fetched, then handed to the ordinary import path: an example is an
        // import that happens to ship with the app, so it gets the same notes
        // banner, the same safety-limit check and the same library
        // semantics, with no second code path to keep in step.
        try {
          const bytes = await fetchExample(file);
          await get().openOrkFile(new Blob([bytes]));
        } catch (e) {
          set({ err: i18n.t('errors.openExample', { reason: errorText(e, i18n.t) }) });
        }
      },
      refreshDesigns: async () => {
        // Called from places that can overlap (openDesign's tail, deleteDesign's
        // tail, saveDesignAs, renameDesign and the library dialog). Without the
        // sequence check, a slower earlier call landing last would put a
        // just-deleted design back in the list, where clicking it takes the
        // `library.missing` path.
        const mine = ++designsGen;
        const lib = getDesignLibrary();
        const [designs, activeDesignId] = [await lib.list(), await lib.activeId()];
        if (mine !== designsGen) return;
        set({ designs, activeDesignId });
      },

      openDesign: async (id) => {
        // Several sequential awaits, and the user can click a second design during
        // any of them. Unguarded, if B's read resolved first, A's continuation would
        // run flushActive() (writing B's tree out under the store's current active
        // id) and finish with setActive(A) + hydrate(A), leaving the user looking at
        // A after clicking B. A monotonic token makes every continuation check it
        // is still the most recent request before it touches anything.
        const stale = claimWorkspace();

        const lib = getDesignLibrary();
        // The same shape check the boot path runs: a raw blob handed straight to
        // hydrate() with a non-array `tree.components` would reach reconcileConfigs
        // and then the kernel. Same check, same `library.missing` outcome.
        const w = migrateWorkspace(await lib.read(id));
        if (stale()) return;
        if (!w) {
          set({ err: i18n.t('library.missing') });
          await pointAtShown();
          await get().refreshDesigns();
          return;
        }
        // Persist whatever is open before switching, or the edits since the last
        // debounced autosave would be lost to the swap.
        await flushOutgoing(stale);
        if (stale()) return;
        // A refused pointer write means this session would edit B while the
        // library still names A, and the next launch reopens A. Stop before the
        // store is touched, so what the user sees and what is active agree.
        if (!(await lib.setActive(id))) {
          if (!stale()) get().warnStorageFull();
          return;
        }
        if (stale()) return;
        // Through the store's own read, as boot opens the active design: the
        // flights stored beside the design come back with it, and the store
        // holds the claim the next autosave is checked against.
        const store = getWorkspaceStore();
        let opened: typeof w | null = w;
        if (store.openActive) {
          try {
            opened = await store.openActive(id, stale);
          } catch {
            opened = null;
          }
        } else store.setActiveId?.(id);
        if (stale()) return;
        if (!opened) {
          set({ err: i18n.t('library.missing') });
          await pointAtShown();
          await get().refreshDesigns();
          return;
        }
        clearHistory(); // a different design is a different document
        get().hydrate(opened);
        set((s) => ({ selectedId: null, ...showing(s, '2d') }));
        await get().refreshDesigns();
      },

      saveDesignAs: async (name) => {
        const s = get();
        // `create` throws when storage refuses the write. Caught here so the
        // refusal reads as storage being full rather than as a generic error,
        // and so a Save As that failed does not look as though it worked.
        // `s` is snapshotted now. `create` names the new entry active in the
        // library; if the workspace is replaced while it is in flight, the
        // workspace store is left on the design now open, or its autosaves
        // would write that design into the entry just made.
        const stale = observeWorkspace();
        const lib = getDesignLibrary();
        const snapshot = workspaceSnapshot(s);
        let meta;
        try {
          // Without the flights, which live under their own key: in the design
          // blob they would be rewritten by every autosave, and on the 5 MB
          // localStorage fallback they can refuse the whole write.
          meta = await lib.create(name.trim() || i18n.t('library.untitled'), lean(snapshot));
        } catch {
          if (stale()) return;
          get().warnStorageFull();
          return;
        }
        // Best-effort, like every results write: a flight can be flown again,
        // so a refusal here does not fail the save.
        await lib.writeResults(meta.id, resultsOf(snapshot)).catch(() => false);
        if (stale()) return;
        getWorkspaceStore().setActiveId?.(meta.id);
        await get().refreshDesigns();
      },

      renameDesign: async (id, name) => {
        // `rename` reports a refused index write. Ignoring it would show the new
        // name from memory and the stored one next session.
        if (!(await getDesignLibrary().rename(id, name.trim() || i18n.t('library.untitled')))) {
          get().warnStorageFull();
        }
        await get().refreshDesigns();
      },

      deleteDesign: async (id) => {
        const lib = getDesignLibrary();
        const wasActive = get().activeDesignId === id;
        // An autosave of the open design that lands during the remove writes the
        // entry back, because a write that cannot find its entry adds one. That
        // covers the one already pending and any an edit arms meanwhile.
        if (wasActive) voidPendingAutosave();
        const release = wasActive ? holdSaves() : () => {};
        let removed: boolean;
        try {
          removed = await lib.remove(id);
        } catch (e) {
          release();
          throw e;
        }
        // A refused index write means the design is still in the library; resetting
        // the open workspace anyway would leave it listed and unopenable-looking.
        if (!removed) {
          release();
          // It is still the open design, and its saves were held.
          if (wasActive && get().activeDesignId === id) await flushActive();
          get().warnStorageFull();
          await get().refreshDesigns();
          return;
        }
        // Deleting the open design leaves nothing to autosave into; start fresh so
        // the next edit creates a new library entry rather than resurrecting it.
        // `wasActive` is read before the await, and activeDesignId is checked again
        // after it: opening another design during remove() moves activeDesignId,
        // and resetting then would discard the design the user had just switched to.
        if (wasActive && get().activeDesignId === id) {
          getWorkspaceStore().setActiveId?.(null);
          get().resetWorkspace();
        }
        release();
        await get().refreshDesigns();
      },

      resetWorkspace: () => {
        claimWorkspace(); // New: any import or library open still in flight is void
        const tree = defaultRocketTree();
        const config = defaultConfig(tree);
        const s0 = newSimulation(i18n.t('sims.untitled', { n: 1 }), config.id, loadSettings().launchDefaults);
        clearHistory(); // starting a new design drops the previous design's undo stack
        // Detach from the open library entry, or the first autosave would write
        // this blank design straight over the rocket the user just had open.
        getWorkspaceStore().setActiveId?.(null);
        replaceWorkspace((s) => ({
          quietReplace: s.quietReplace + 1,
          activeDesignId: null,
          tree,
          loadedMeta: null,
          sims: [s0],
          configs: [config],
          activeId: s0.id,
          selectedId: null,
          ...showing(s, '2d'),
        }));
        // Not worth storing until it is edited (see `writtenWorkspace`).
        markWritten(get());
      },
      newWorkspace: async () => {
        const ok = await confirm({
          title: i18n.t('file.new'),
          message: i18n.t('file.newConfirm'),
          confirmLabel: i18n.t('file.new'),
        });
        if (!ok) return;
        await get().leaveForNew();
      },
      leaveForNew: async () => {
        // The design being left keeps its last edits: the reset voids its
        // pending autosave.
        const stale = observeWorkspace();
        await flushOutgoing(stale);
        if (!stale()) get().resetWorkspace();
      },
      saveOrk: async () => {
        try {
          // `replaced` covers the case where the workspace is no longer the
          // design the user asked to save at all.
          const replaced = observeWorkspace();
          // The derived-statistics block, only when the user opted in (off by
          // default, so a normal save stays byte-identical). Built from the same
          // report model the PDF export uses, which is imported lazily: a static
          // edge would close a store → reportModel → store import cycle. Loaded
          // ahead of the snapshot below, so the report is assembled in the same
          // synchronous stretch as the snapshot: it reads the live store, and
          // read after an await it could describe a design edited since.
          const reportMods = loadSettings().saveDesignInfo ? await import('../services/report/reportModel') : null;
          // One vintage of the design, captured before the next await.
          //
          // Reading any part of it after the catalog fetch would mix vintages:
          // saving while the motor catalog was still loading and then editing would
          // write pre-edit geometry with a post-edit launch block, a file internally
          // inconsistent in a way neither surface shows.
          //
          // The whole snapshot, not a `stale()` bail, because a save should write
          // the design as it was when the user asked for it.
          const { tree, loadedMeta } = get();
          const activeConfigId = selectConfig(get()).id;
          const launch = selectActive(get()).launch;
          const configSnapshot = get().configs;
          // Ahead of the design-info build below, which this can make for it.
          const componentInfo = figuresFor(tree);
          // Every simulation, each with its result summary and the status the
          // desktop reads: a result (or a file's summary) that is current is
          // uptodate, one the design has moved past is outdated, and a simulation
          // with neither is not simulated.
          const { sims: simSnapshot, simPrefs: prefsSnapshot } = get();
          let designInfo: DesignInfo | undefined;
          if (reportMods) {
            const { assembleReport } = reportMods;
            // Not built yet (a design just loaded, or the engine still arriving):
            // build it now rather than leave out a block the user asked for.
            if (!get().info) {
              const built = computeStaticInfo(tree, selectConfig(get()));
              if (!('error' in built)) get().applyBuild(built.info, built.rocket);
            }
            const report = assembleReport();
            if (report) designInfo = buildDesignInfo(report);
          }
          // Asked for and still not there: the design does not build (or the
          // engine has not arrived), so there are no statistics to write. The
          // file is still worth having, but it lacks what the user asked for.
          const infoLeftOut = reportMods !== null && !designInfo;
          const simulations = simSnapshot.map((sim) => {
            const summary = sim.result?.summary ?? sim.fileSummary?.summary;
            const stale = isOutdated(sim, tree, configOf(configSnapshot, sim), prefsSnapshot);
            return {
              name: sim.name,
              configId: sim.configId,
              launch: sim.launch,
              ...(summary ? { summary } : {}),
              status: !summary ? ('notsimulated' as const) : stale ? ('outdated' as const) : ('uptodate' as const),
              ...(sim.xmlExtra?.length ? { xmlExtra: sim.xmlExtra } : {}),
              // What it flies with: its own overrides over the globals, the
              // same settings the run and its outdated check read.
              ...(prefsSnapshot ? { prefs: effectivePrefs(prefsSnapshot, sim.prefs) } : {}),
            };
          });
          // Every configuration, each with its own motors: the file carries the
          // whole set, so opening one setup and saving cannot discard the others.
          const base = loadedMeta?.exportMotors ?? {};
          // The digests come from the motor catalog here rather than from the
          // seated spec: a spec is persisted with the design, so a motor seated
          // before the catalog carried digests would never gain one.
          const configs = await Promise.all(
            configSnapshot.map(async (c) => ({
              id: c.id,
              name: c.name,
              motors: await fillMotorDigests(buildExportMotorMap(tree, c, base)),
              deployments: c.deployments,
              separations: c.separations,
              grounded: c.grounded,
            })),
          );
          // The .ork writer is a lazily-imported chunk, only needed on save.
          const { downloadOrk } = await import('../services/files/saveOrk');
          // A different design is open now: writing this one would hand the user a
          // file for something they are no longer looking at.
          if (replaced()) return;
          downloadOrk({
            name: designNameOf(tree, loadedMeta),
            tree,
            componentInfo,
            configs,
            activeConfigId,
            launch,
            simulations,
            designInfo,
          });
          if (infoLeftOut) set({ err: i18n.t('errors.saveOrkNoDesignInfo') });
        } catch (e) {
          set({ err: i18n.t('errors.saveOrk', { reason: errorText(e, i18n.t) }) });
        }
      },
      saveRkt: async () => {
        try {
          const { tree, loadedMeta } = get();
          const figures = figuresFor(tree);
          const { downloadRkt } = await import('../services/files/saveOrk');
          const name = designNameOf(tree, loadedMeta);
          const skipped = await downloadRkt(name, tree, figures);
          // RockSim has no element for some of what this app can build (rail
          // buttons, the fairing extension). The file is still
          // worth having, but the user is about to hand it to somebody who will
          // not see those parts, so say so rather than let them find out.
          if (skipped.length) {
            set({
              err: i18n.t('errors.exportRktPartial', { parts: fmtList(skipped.map((k) => keyedText(k, i18n.t))) }),
            });
          }
        } catch (e) {
          set({ err: i18n.t('errors.exportRkt', { reason: errorText(e, i18n.t) }) });
        }
      },
      exportPrint: async (opts) => {
        try {
          const { tree, loadedMeta } = get();
          const { downloadRocket3mf } = await import('../services/exports/rocketPrintExport');
          const name = designNameOf(tree, loadedMeta);
          const { skipped } = await downloadRocket3mf(name, tree, opts);
          // A part whose geometry fails the manifold check is left out rather
          // than written as a file no slicer would accept, but silently leaving
          // it out is how somebody discovers a missing fin at the printer.
          if (skipped.length) set({ err: i18n.t('errors.exportPrintPartial', { parts: fmtList(skipped) }) });
        } catch (e) {
          set({ err: i18n.t('errors.exportPrint', { reason: errorText(e, i18n.t) }) });
        }
      },
      saveRasaero: async () => {
        try {
          const { tree, loadedMeta, info } = get();
          const active = selectActive(get());
          // Same motor map the .ork exporter builds; OrkExportMotor satisfies the
          // CDX1 engine-string writer's Cdx1ExportEngine verbatim.
          const motors = buildExportMotorMap(tree, selectConfig(get()), loadedMeta?.exportMotors ?? {});
          // The RASAero writer is a lazily-imported chunk, only needed on export.
          const { downloadCdx1 } = await import('../services/files/rasaeroExport');
          const config = selectConfig(get());
          // The selected configuration's deployments, as desktop's exporter
          // reads them.
          const flown = configuredTree(tree, config);
          // RASAero's simulation block holds a cumulative launch mass and CG per
          // stage, which desktop fills from the mass calculator with only those
          // stages active. A single stage's cell is the whole rocket's figure;
          // more stages need a scratch build per stage. Building resets the
          // shared engine, so the live handle is rebuilt afterward, as the
          // design report does.
          let stageLaunch: StageLaunch[] | undefined;
          if (info && tree.components.filter((n) => n.type === 'stage').length > 1) {
            const { cumulativeStageLaunch } = await import('../services/files/rasaero/stageLaunch');
            const { buildConfiguredRocket } = await import('../services/design/buildRocket');
            stageLaunch = cumulativeStageLaunch(flown, buildConfiguredRocket(flown, config));
            const built = computeStaticInfo(tree, config);
            if (!('error' in built)) get().applyBuild(built.info, built.rocket);
          }
          // A finish RASAero has no surface for is written as smooth, as on
          // desktop, which warns about it; the user is told the same here.
          const warnings: Keyed[] = [];
          downloadCdx1({
            name: designNameOf(tree, loadedMeta),
            tree: flown,
            motors,
            launch: active.launch,
            // Whole-rocket loaded mass/CG feed RASAero's mandatory simulation block.
            launchMassKg: info?.mass,
            launchCgM: info?.cg,
            stageLaunch,
            warnings,
          });
          if (warnings.length) set({ err: warnings.map((k) => keyedText(k, i18n.t)).join(' ') });
        } catch (e) {
          set({ err: i18n.t('errors.exportRasaero', { reason: errorText(e, i18n.t) }) });
        }
      },
      exportJson: async () => {
        try {
          const { tree, loadedMeta } = get();
          const config = selectConfig(get());
          // The build the figures come from is the one `info` describes, so the
          // center of pressure is read only after it.
          const figures = figuresFor(tree);
          const cp = figures ? get().info?.cp : undefined;
          const motors = await fillMotorDigests(buildExportMotorMap(tree, config, loadedMeta?.exportMotors ?? {}));
          // The writer is a lazily-imported chunk, only needed on export.
          const { downloadOnshapeJson } = await import('../services/files/onshapeExport');
          const { skipped } = await downloadOnshapeJson({
            name: designNameOf(tree, loadedMeta),
            tree,
            figures,
            cp,
            motors,
            configId: config.id,
            palette: mergePalette(loadSettings().partColors),
          });
          if (skipped.length) {
            const parts = fmtList(skipped.map((p) => p.name || i18n.t(`part.${p.type}`)));
            set({ err: i18n.t('errors.exportJsonPartial', { parts }) });
          }
        } catch (e) {
          set({ err: i18n.t('errors.exportJson', { reason: errorText(e, i18n.t) }) });
        }
      },
      exportComponent: async (nodeId, format) => {
        try {
          const { exportComponent } = await import('../services/files/componentExport');
          const ok = await exportComponent(get().tree, nodeId, format, selectDesignName(get()), i18n.t);
          if (!ok) set({ err: i18n.t('errors.exportUnsupported', { format: format.toUpperCase() }) });
        } catch (e) {
          set({
            err: i18n.t('errors.exportFailed', {
              format: format.toUpperCase(),
              reason: errorText(e, i18n.t),
            }),
          });
        }
      },
    };
  };
