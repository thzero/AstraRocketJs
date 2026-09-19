// Persistence for the working session — the design tree plus its simulations —
// so a reload restores your work. Swap the backend at the library, which is what
// actually owns storage:
//
//   import { setDesignLibrary, DesignLibrary } from './services/designLibrary';
//   setDesignLibrary(new DesignLibrary(myKeyValueStore));   // a REST sync, …
//
// The default persists the ACTIVE design through the design library
// (designLibrary.ts), which holds many designs in IndexedDB. This interface
// stays narrow on purpose — it is only "the design being edited"; listing,
// opening, renaming and deleting designs are the library's job.
import { getDesignLibrary, type DesignLibrary, type StoredResults } from './designLibrary';
import type { FlightResult, RocketTree } from '../engine/openRocketEngine';
import type { Simulation } from './simulations';
import type { MountMotor } from './loadOrk';
import type { OrkExportMotor } from './orkFile';

export interface Workspace {
  version: 1;
  tree: RocketTree;
  sims: Simulation[];
  activeId: string;
  /**
   * LEGACY: one shared map of non-primary-mount motors for the whole workspace.
   *
   * Read, never written. The motor loadout now rides on each simulation
   * (`Simulation.extraMotors`) so two simulations can fly the same airframe with
   * different upper-stage motors. `hydrate` folds a blob written before that
   * into every simulation, which reproduces exactly what the shared map meant.
   */
  extraMotors?: Record<string, MountMotor>;
  /** Imported-.ork source metadata (banner + round-trip export), or null. */
  loadedMeta: { name: string; notes: string[]; exportMotors: Record<string, OrkExportMotor> } | null;
}

export interface WorkspaceStore {
  load(): Promise<Workspace | null>;
  save(w: Workspace): Promise<void>;
  /** Last-resort synchronous write for page unload, where an async store
   *  cannot finish. Optional: a store with no synchronous path omits it. */
  saveSync?(w: Workspace): void;
  /** Point the store at a different design. Optional: a single-design store
   *  has nothing to switch. */
  setActiveId?(id: string | null): void;
}

/**
 * Unload journal. IndexedDB writes cannot complete while the page is tearing
 * down, so `saveSync` drops the workspace into localStorage synchronously on
 * pagehide/beforeunload and the next `load()` folds it back in.
 *
 * It records WHICH design it belongs to: with a library the active design can
 * change between sessions, and replaying a journal into the wrong one would
 * overwrite an unrelated rocket.
 */
const UNLOAD_KEY = 'astrarrocketjs:designs:unload';

interface Journal {
  id: string | null;
  w: Workspace;
}

/**
 * The workspace WITHOUT its flight results.
 *
 * Two callers, for two reasons. The design blob is rewritten on every keystroke's
 * debounced autosave, and a result is tens of thousands of samples — they live
 * under their own key instead (see DesignLibrary.writeResults). The unload
 * journal goes to localStorage, whose whole-origin budget is ~5 MB, so results
 * must never go near it; the async save that follows a run puts them in
 * IndexedDB within the debounce, so the journal loses nothing that matters.
 */
const lean = (w: Workspace): Workspace => ({ ...w, sims: w.sims.map((s) => ({ ...s, result: null })) });

/** Re-attach stored flights to the simulations that produced them. */
const withResults = (w: Workspace, results: StoredResults): Workspace => ({
  ...w,
  sims: w.sims.map((s) => (results[s.id] ? { ...s, result: results[s.id]! } : s)),
});

/** Just the flights, by simulation id — what gets stored under the results key. */
const resultsOf = (w: Workspace): StoredResults => {
  const out: StoredResults = {};
  for (const s of w.sims) if (s.result) out[s.id] = s.result;
  return out;
};

function readJournal(): Journal | null {
  try {
    const raw = localStorage.getItem(UNLOAD_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as Journal;
    return j && j.w ? j : null;
  } catch {
    return null;
  }
}

function clearJournal(): void {
  try {
    localStorage.removeItem(UNLOAD_KEY);
  } catch {
    /* best-effort */
  }
}

/** Name a brand-new design; the .ork name wins when one was imported. */
const nameFor = (w: Workspace) => w.loadedMeta?.name?.trim() || 'My Rocket';

/** Default store: the active design, persisted through the design library. */
export class LibraryWorkspaceStore implements WorkspaceStore {
  /** Cached so autosave does not re-read the active id on every keystroke. */
  private activeId: string | null = null;
  /**
   * The flights as last written, by simulation id, so a save can tell whether
   * any of them actually changed.
   *
   * Identity, not contents: a result object is replaced wholesale when a run
   * finishes and is never mutated, so `!==` is both correct and free — where
   * comparing the arrays would cost as much as writing them. Without this, every
   * keystroke's autosave would re-serialize every flight, which is the whole
   * reason they were not being stored at all.
   */
  private savedResults = new Map<string, FlightResult | null>();

  async load(): Promise<Workspace | null> {
    const lib = getDesignLibrary();
    this.activeId = await lib.activeId();

    // A journal is newer than anything stored, but only for ITS design.
    const journal = readJournal();
    if (journal && journal.id && journal.id === this.activeId) {
      // Validate BEFORE writing. `readJournal` only checks that the blob parses
      // and has a `w`; a journal written by a DIFFERENT app build (this is an
      // installed PWA, so an older cached build is a live possibility) can parse
      // cleanly and still not be a workspace this build can open. Writing it
      // first would overwrite the real stored design with it and clear the
      // journal, losing the design permanently — every later load would re-read
      // the same bad blob.
      const w = validate(journal.w);
      if (!w) {
        clearJournal();
        return await this.readActive(lib);
      }
      if (await lib.write(journal.id, (await this.nameOf(journal.id)) ?? nameFor(w), w)) {
        clearJournal();
      }
      // The journal carries no results (see `lean`), so they come from their own
      // key — a reload after a run still opens on the numbers it produced.
      return this.trackResults(withResults(w, await lib.readResults(journal.id)));
    }
    // A journal from a design that no longer exists is stale; drop it rather
    // than replaying it over whatever happens to be open now.
    if (journal && journal.id !== this.activeId) clearJournal();

    return await this.readActive(lib);
  }

  /**
   * The active design, or null when there is genuinely nothing saved.
   *
   * THROWS when a design is supposed to be there and cannot be read. Returning
   * null for both used to mean the caller could not tell them apart: the
   * hydration gate opened with the DEFAULT rocket and, 500 ms after the user's
   * first edit, the autosave wrote that default over the unreadable design AT
   * THE SAME ID. Reachable today from a truncated blob, and by construction the
   * moment a future build stamps `version: 2` into a PWA whose older build is
   * still cached — the same hazard the SettingsProvider first-run guard exists
   * for, on the one thing here that cannot be recomputed.
   *
   * `activeId()` has already filtered against the index, so a set `activeId`
   * means the library believes this design exists. Detach before throwing, so
   * the next autosave CREATES a design instead of overwriting the unreadable
   * one, and the user keeps whatever can still be recovered by hand.
   */
  private async readActive(lib: DesignLibrary): Promise<Workspace | null> {
    if (!this.activeId) return null;
    const w = validate(await lib.read(this.activeId));
    if (!w) {
      this.activeId = null;
      throw new Error('unreadable-design');
    }
    return this.trackResults(withResults(w, await lib.readResults(this.activeId)));
  }

  /** Record what is on disk, so the next save knows whether to rewrite it. */
  private trackResults(w: Workspace): Workspace {
    this.savedResults = new Map(w.sims.map((s) => [s.id, s.result ?? null]));
    return w;
  }

  /** True when any simulation's flight differs from what was last written. */
  private resultsChanged(w: Workspace): boolean {
    if (w.sims.length !== this.savedResults.size) return true;
    return w.sims.some((s) => this.savedResults.get(s.id) !== (s.result ?? null));
  }

  private async nameOf(id: string): Promise<string | null> {
    return (await getDesignLibrary().list()).find((m) => m.id === id)?.name ?? null;
  }

  async save(w: Workspace): Promise<void> {
    const lib = getDesignLibrary();
    const leanW = lean(w);
    // First save of a session that started with no library entry (a fresh
    // browser, or everything deleted) creates the design rather than dropping it.
    if (!this.activeId) {
      const meta = await lib.create(nameFor(w), leanW);
      this.activeId = meta.id;
      await this.saveResults(lib, meta.id, w);
      return;
    }
    // The design is the ONE thing here that cannot be recomputed, so surface a
    // failed write (storage full) instead of silently dropping the user's work.
    const name = (await this.nameOf(this.activeId)) ?? nameFor(w);
    if (!(await lib.write(this.activeId, name, leanW))) throw new Error('storage-full');
    await this.saveResults(lib, this.activeId, w);
  }

  /**
   * Write the flights, but only when they have moved.
   *
   * Never throws: a result is recomputable by definition, so storage refusing it
   * is not worth failing the save that just stored the design.
   */
  private async saveResults(lib: DesignLibrary, id: string, w: Workspace): Promise<void> {
    if (!this.resultsChanged(w)) return;
    if (await lib.writeResults(id, resultsOf(w))) this.trackResults(w);
  }

  /** Point the store at a different design (the library owns the switch). */
  setActiveId(id: string | null): void {
    this.activeId = id;
    // A different design has different flights; what we know about the last
    // write no longer applies to the one we are about to make.
    this.savedResults = new Map();
  }

  /** Synchronous unload write. Best-effort: if it does not fit (the blob is
   *  bigger than localStorage allows) the debounced async save is all there is. */
  saveSync(w: Workspace): void {
    try {
      localStorage.setItem(UNLOAD_KEY, JSON.stringify({ id: this.activeId, w: lean(w) } satisfies Journal));
    } catch {
      /* quota or storage blocked — nothing further we can do while unloading */
    }
  }
}

/** Reject a truncated or hand-edited blob before the tree reaches the engine:
 *  a `tree.components` that isn't an array would crash buildTree deep in the
 *  kernel rather than fail cleanly here. */
function validate(w: Workspace | null): Workspace | null {
  return w &&
    w.version === 1 &&
    w.tree &&
    Array.isArray((w.tree as { components?: unknown }).components) &&
    Array.isArray(w.sims) &&
    w.sims.length > 0
    ? w
    : null;
}

const store: WorkspaceStore = new LibraryWorkspaceStore();
export function getWorkspaceStore(): WorkspaceStore {
  return store;
}
