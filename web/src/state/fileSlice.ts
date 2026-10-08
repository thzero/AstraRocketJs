import type { StateCreator } from 'zustand';
import i18n from '../i18n';
import { confirm } from './confirmStore';
import { prompt } from './promptStore';
import { defaultRocketTree } from '../services/design/defaultRocket';
import { launcherKind, withLauncher } from '../services/design/launcher';
import type { DesignInfo } from '../services/files/orkTypes';
import { buildExportMotorMap, fillMotorDigests } from '../services/motors/exportMotors';
import { repairValues } from '../services/design/repairValues';
import { wireLoadedOrk } from '../services/files/wireLoadedOrk';
// Static, not the lazy import the neighboring .ork paths use: this is a fetch
// wrapper with no heavy dependencies, and the library dialog imports it
// statically anyway, so a dynamic import here only produces rolldown's
// INEFFECTIVE_DYNAMIC_IMPORT warning without moving a byte.
import { fetchExample } from '../services/storage/exampleLibrary';
import { isOutdated, newSimulation } from '../services/flight/simulations';
import { loadSettings } from '../services/storage/settings';
import { importNotes } from '../services/files/importBanner';
import { defaultDesignName, designNameOf } from '../services/app/appInfo';
import { getDesignLibrary, type DesignMeta } from '../services/storage/designLibrary';
import { getWorkspaceStore } from '../services/storage/workspaceStore';
import { migrateWorkspace } from '../services/storage/workspaceMigrate';
import { errorMessage } from '../services/app/errorMessage';
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
  type WorkspaceState,
} from './store';
import { showing } from './viewSlice';

/**
 * Opening, saving and exporting designs, and the design library.
 *
 * The values imported from './store' are read only inside actions, never at
 * module load: store.ts imports this file, so at load time they do not exist yet.
 */
export interface FileSlice {
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
  saveDesignAs: (name: string) => Promise<void>;
  renameDesign: (id: string, name: string) => Promise<void>;
  deleteDesign: (id: string) => Promise<void>;
  // These four are implemented `async`. Declaring them `() => void` was a
  // lie the type system then enforced: no caller and no test could await
  // them, which is part of why none of the four had a test. The `void`-calling
  // sites in AppHeader keep their `void`.
  newWorkspace: () => Promise<void>;
  saveOrk: () => Promise<void>;
  /** Write the design as a RockSim `.rkt`. */
  saveRkt: () => Promise<void>;
  /** Write the design's printable parts as 3MF (one file, or a zip of files). */
  exportPrint: (opts: import('../services/exports/rocketPrintExport').PrintExportOptions) => Promise<void>;
  saveRasaero: () => Promise<void>;
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
 * So every action that REPLACES the workspace bumps this, and every
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
 * OBSERVE the workspace without claiming it: the predicate reports whether
 * someone replaced it, but taking this token does not itself count as a
 * replacement.
 *
 * `saveDesignAs` does not replace the workspace - it only needs to notice if
 * something else did - but it used `claimWorkspace`, which bumps the
 * generation and so invalidated every other continuation. Dropping a large
 * `.ork` on the app and hitting Save As while it parsed made `openOrkFile`'s
 * `stale()` true, and BOTH its success and its error paths are gated on that,
 * so nothing loaded and nothing was reported.
 */
const observeWorkspace = (): (() => boolean) => {
  const mine = workspaceGen;
  return () => mine !== workspaceGen;
};

export const createFileSlice =
  ({ replaceWorkspace, clearHistory }: FileSliceShared): StateCreator<WorkspaceState, [], [], FileSlice> =>
  (set, get) => {
    /**
     * Write the open design out now, ahead of switching away from it. False if
     * storage refused the write.
     *
     * The refusal is reported rather than swallowed: only the debounced
     * autosave's catch raises the storage banner, and File > Save calls this
     * directly, so a Save within the 500 ms debounce on a full store would
     * otherwise report success with nothing written. Callers decide what a refusal
     * means for them (a switch still proceeds; a Save must say it failed).
     */
    const flushActive = async (): Promise<boolean> => {
      try {
        await getWorkspaceStore().save(workspaceSnapshot(get()));
        return true;
      } catch (e) {
        // Recorded rather than returned, so a caller that only cares WHETHER the
        // write landed still reports the right reason it did not.
        lastFlushFailure = e;
        return false;
      }
    };
    /** Why the last `flushActive` returned false, for the caller that reports it. */
    let lastFlushFailure: unknown = null;

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
     * Decide which library entry an imported rocket belongs in, and do it BEFORE
     * the rocket replaces what is open.
     *
     * An import detaches the workspace store, so the next debounced autosave
     * CREATES an entry. That is deliberate — an imported rocket is its own design,
     * not an edit to whatever was on screen — but nothing checked the name, so
     * re-importing the same .ork (edit in OpenRocket, import, edit, import…) or
     * reopening the same example stacked up identical rows in File > Open, each
     * one a real design the user then had to tell apart by nothing at all.
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
      // Canceling the NAME dialog does not cancel the import: the file is parsed
      // and about to be on screen, and the one outcome this flow exists to rule
      // out is a second row with the same name. Fall back to the suggestion.
      return { id: null, name: chosen?.trim() || suggested };
    };

    return {
      designs: [],
      activeDesignId: null,

      openOrkFile: async (file) => {
        // Three awaits before anything is written, and the file input has no busy
        // gate — so a second import (or a library open) can land in between.
        const stale = claimWorkspace();
        try {
          // The .ork parser (fflate + XML importer) is a lazily-imported chunk —
          // it isn't part of first paint, only of opening a file.
          const bytes = await file.arrayBuffer();
          if (stale()) return;
          const { loadOrk } = await import('../services/files/loadOrk');
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
          if (!home || stale()) return;
          clearHistory(); // a loaded design is a fresh document — nothing to undo across the load
          // An imported rocket becomes its OWN library entry rather than
          // replacing whatever was open — unless the user chose to overwrite a
          // design of the same name, in which case that entry IS its home.
          getWorkspaceStore().setActiveId?.(home.id);
          if (!home.id) getWorkspaceStore().setPendingName?.(home.name);
          // A file is the likeliest source of a value no material has, and the
          // one place the app can still say where it came from.
          const fixed = repairValues(tree);
          // Worded for the IMPORTED design's launcher, not the one still open:
          // the store's tree is the previous design until replaceWorkspace below.
          const t = withLauncher(
            i18n.t as unknown as (key: string, options?: Record<string, unknown>) => string,
            launcherKind(fixed.tree),
          );
          const notes = importNotes(loadedMeta.notes, sims[0]!.launch, t, displayUnits());
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
          });
        } catch (e) {
          if (stale()) return; // a superseded import must not post its error either
          set({ err: i18n.t('errors.openOrk', { reason: errorMessage(e) }) });
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
          set({ err: i18n.t('errors.openExample', { reason: errorMessage(e) }) });
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
        // to hydrate(), where a non-array `tree.components` reaches reconcileConfigs
        // and then the kernel. Same check, same `library.missing` outcome.
        const w = migrateWorkspace(await lib.read(id));
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
        if (!(await flushActive()) && !stale()) {
          const { msg, kind } = saveFailure(lastFlushFailure);
          get().setStorageWarning(msg, kind);
        }
        if (stale()) return;
        // A refused pointer write means this session would edit B while the
        // library still names A, and the next launch reopens A. Stop before the
        // store is touched, so what the user sees and what is active agree.
        if (!(await lib.setActive(id))) {
          if (!stale()) get().warnStorageFull();
          return;
        }
        if (stale()) return;
        getWorkspaceStore().setActiveId?.(id);
        clearHistory(); // a different design is a different document
        get().hydrate(w);
        set((s) => ({ selectedId: null, ...showing(s, '2d') }));
        await get().refreshDesigns();
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
          meta = await getDesignLibrary().create(name.trim() || i18n.t('library.untitled'), workspaceSnapshot(s));
        } catch {
          if (stale()) return;
          get().warnStorageFull();
          return;
        }
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
        // A refused index write means the design is still in the library; resetting
        // the open workspace anyway would leave it listed and unopenable-looking.
        if (!(await lib.remove(id))) {
          get().warnStorageFull();
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
        const tree = defaultRocketTree();
        const config = defaultConfig(tree);
        const s0 = newSimulation('Simulation 1', config.id, loadSettings().launchDefaults);
        clearHistory(); // starting a new design drops the previous design's undo stack
        // Detach from the open library entry, or the first autosave would write
        // this blank design straight over the rocket the user just had open.
        getWorkspaceStore().setActiveId?.(null);
        replaceWorkspace((s) => ({
          activeDesignId: null,
          tree,
          loadedMeta: null,
          sims: [s0],
          configs: [config],
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
          // ONE vintage of the design, captured before the first await.
          //
          // `tree` and `loadedMeta` were snapshotted here and `activeConfigId` and
          // `launch` were read FRESH after the catalog fetch, which made this the
          // only async action in the store with no staleness handling of any kind.
          // Saving while the motor catalog was still loading and then editing wrote
          // pre-edit geometry with a post-edit launch block: a file internally
          // inconsistent in a way neither surface shows.
          //
          // The whole snapshot, not a `stale()` bail, because a save should write
          // the design as it was when the user asked for it. `replaced` covers the
          // other case, where the workspace is no longer this design at all.
          const replaced = observeWorkspace();
          const { tree, loadedMeta } = get();
          const activeConfigId = selectConfig(get()).id;
          const launch = selectActive(get()).launch;
          const configSnapshot = get().configs;
          // Every simulation, each with its result summary and the status the
          // desktop reads: a result (or a file's summary) that is current is
          // uptodate, one the design has moved past is outdated, and a simulation
          // with neither is not simulated.
          const { sims: simSnapshot, simPrefs: prefsSnapshot } = get();
          const simulations = simSnapshot.map((sim) => {
            const summary = sim.result?.summary ?? sim.fileSummary?.summary;
            const stale = isOutdated(sim, tree, configOf(configSnapshot, sim), prefsSnapshot);
            return {
              name: sim.name,
              configId: sim.configId,
              launch: sim.launch,
              ...(summary ? { summary } : {}),
              status: !summary ? ('notsimulated' as const) : stale ? ('outdated' as const) : ('uptodate' as const),
            };
          });
          // EVERY configuration, each with its own motors: the file carries the
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
          // Derived-statistics block — only when the user opted in (off by default,
          // so a normal save stays byte-identical). Built from the same report model
          // the PDF export uses; both are lazily imported (also avoids a static
          // store → reportModel → store import cycle).
          let designInfo: DesignInfo | undefined;
          if (loadSettings().saveDesignInfo) {
            const [{ assembleReport }, { buildDesignInfo }] = await Promise.all([
              import('../services/report/reportModel'),
              import('../services/report/designInfo'),
            ]);
            const report = assembleReport();
            if (report) designInfo = buildDesignInfo(report);
          }
          // The .ork writer is a lazily-imported chunk — only needed on save.
          const { downloadOrk } = await import('../services/files/saveOrk');
          // A different design is open now: writing this one would hand the user a
          // file for something they are no longer looking at.
          if (replaced()) return;
          downloadOrk({
            name: designNameOf(tree, loadedMeta),
            tree,
            configs,
            activeConfigId,
            launch,
            simulations,
            designInfo,
          });
        } catch (e) {
          set({ err: i18n.t('errors.saveOrk', { reason: errorMessage(e) }) });
        }
      },
      saveRkt: async () => {
        try {
          const { tree, loadedMeta } = get();
          const { downloadRkt } = await import('../services/files/saveOrk');
          const name = designNameOf(tree, loadedMeta);
          const skipped = await downloadRkt(name, tree);
          // RockSim has no element for some of what this app can build (rail
          // buttons, parallel stages, the fairing extension). The file is still
          // worth having, but the user is about to hand it to somebody who will
          // not see those parts, so say so rather than let them find out.
          if (skipped.length) {
            set({ err: i18n.t('errors.exportRktPartial', { parts: skipped.join(', ') }) });
          }
        } catch (e) {
          set({ err: i18n.t('errors.exportRkt', { reason: errorMessage(e) }) });
        }
      },
      exportPrint: async (opts) => {
        try {
          const { tree, loadedMeta } = get();
          const { downloadRocket3mf } = await import('../services/exports/rocketPrintExport');
          const name = designNameOf(tree, loadedMeta);
          const { skipped } = await downloadRocket3mf(name, tree, opts);
          // A part whose geometry fails the manifold check is left out rather
          // than written as a file no slicer would accept — but silently leaving
          // it out is how somebody discovers a missing fin at the printer.
          if (skipped.length) set({ err: i18n.t('errors.exportPrintPartial', { parts: skipped.join(', ') }) });
        } catch (e) {
          set({ err: i18n.t('errors.exportPrint', { reason: errorMessage(e) }) });
        }
      },
      saveRasaero: async () => {
        try {
          const { tree, loadedMeta, info } = get();
          const active = selectActive(get());
          // Same motor map the .ork exporter builds — OrkExportMotor satisfies the
          // CDX1 engine-string writer's Cdx1ExportEngine verbatim.
          const motors = buildExportMotorMap(tree, selectConfig(get()), loadedMeta?.exportMotors ?? {});
          // The RASAero writer is a lazily-imported chunk — only needed on export.
          const { downloadCdx1 } = await import('../services/files/rasaeroExport');
          downloadCdx1({
            name: designNameOf(tree, loadedMeta),
            tree,
            motors,
            launch: active.launch,
            // Whole-rocket loaded mass/CG feed RASAero's mandatory simulation block.
            launchMassKg: info?.mass,
            launchCgM: info?.cg,
          });
        } catch (e) {
          set({ err: i18n.t('errors.exportRasaero', { reason: errorMessage(e) }) });
        }
      },
      exportComponent: async (nodeId, format) => {
        try {
          const { exportComponent } = await import('../services/files/componentExport');
          const ok = await exportComponent(get().tree, nodeId, format, selectDesignName(get()));
          if (!ok) set({ err: i18n.t('errors.exportUnsupported', { format: format.toUpperCase() }) });
        } catch (e) {
          set({
            err: i18n.t('errors.exportFailed', {
              format: format.toUpperCase(),
              reason: errorMessage(e),
            }),
          });
        }
      },
    };
  };
