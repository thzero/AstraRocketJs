// Persistence for the working session — the design tree plus its simulations —
// so a reload restores your work. Swap the backend at the library, which is what
// actually owns storage:
//
//   import { setDesignLibrary, DesignLibrary } from './designLibrary';
//   setDesignLibrary(new DesignLibrary(myKeyValueStore));   // a REST sync, …
//
// The default persists the ACTIVE design through the design library
// (designLibrary.ts), which holds many designs in IndexedDB. This interface
// stays narrow on purpose — it is only "the design being edited"; listing,
// opening, renaming and deleting designs are the library's job.
import { getDesignLibrary, type DesignLibrary, type DesignMeta, type StoredResults } from './designLibrary';
import type { FlightResult, RocketTree } from '../../engine/openRocketEngine';
import type { Simulation } from '../flight/simulations';
import type { FlightConfig } from '../flight/flightConfigs';
import { migrateWorkspace } from './workspaceMigrate';
import type { OrkExportMotor } from '../files/orkFile';
import { nsKey } from './storageKeys';
import { designNameOf } from '../app/appInfo';

export interface Workspace {
  version: 2;
  tree: RocketTree;
  sims: Simulation[];
  /**
   * The flight configurations this design holds (services/flight/flightConfigs.ts).
   *
   * At least one, always: every simulation names the configuration it flies, so
   * a design with none has nothing to fly. A configuration no simulation points
   * at is kept rather than pruned - it is a setup the user built, not a byproduct
   * of a row.
   */
  configs: FlightConfig[];
  activeId: string;
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
  /**
   * The name to create under while DETACHED (`setActiveId(null)`), instead of
   * the one the workspace implies.
   *
   * Import resolves a name clash with the library before it hands the rocket
   * over (see store.ts `homeForImport`), and the answer has to survive until
   * the debounced autosave actually creates the entry. Passing it through here
   * keeps that single create in the store, rather than having the caller race
   * the autosave with a `create` of its own. Cleared by `setActiveId`.
   */
  setPendingName?(name: string | null): void;
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
const UNLOAD_KEY = nsKey('designs:unload');

interface Journal {
  id: string | null;
  w: Workspace;
  /**
   * When `saveSync` wrote it (epoch ms). Absent on a journal from an older
   * build, which is replayed as before.
   *
   * The unload write is a last resort, and it can LOSE the race with the
   * store: the debounced async save that was already in flight at pagehide
   * can commit after the journal was written, or the same design can be saved
   * from another tab of this PWA after this one closed. Replaying the journal
   * over that newer save rolled the design back. The next `load()` compares
   * this stamp with the index entry's `updatedAt` and skips a journal the
   * library has already moved past.
   */
  t?: number;
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

/** Name a brand-new design the way every download names it. */
const nameFor = (w: Workspace) => designNameOf(w.tree, w.loadedMeta);

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
  /**
   * The `lib.create()` of a first save that is still in flight.
   *
   * Two saves can overlap while the store is detached. Without this, both see a
   * null `activeId` and create an entry of their own, leaving the library with
   * several identical designs from one rocket and every one but the last
   * orphaned: nothing is active in it, so nothing ever writes to it again.
   *
   * The window is not narrow. The autosave debounce is 500 ms and the first
   * IndexedDB create is the slowest write the app makes (open the database,
   * write the blob, mutate the index, set the pointer), so a second keystroke
   * lands inside it easily, and the `visibilitychange` flush saves outside the
   * debounce entirely, so tabbing away right after an import hits it every time.
   */
  private creating: Promise<DesignMeta> | null = null;
  /** See `setPendingName`. */
  private pendingName: string | null = null;
  /**
   * Bumped by every `setActiveId`. A create that resolves after the workspace
   * has moved on (New, or a second import, during that first slow write) must
   * NOT adopt its id: the entry it made belongs to the design that has just
   * been replaced, and claiming it would send the new design's autosaves
   * straight over the old one.
   */
  private gen = 0;
  /**
   * The library's `updatedAt` for the active design as this tab last saw it.
   *
   * THE AUTOSAVE SLOT IS SHARED. Two tabs of an installed PWA open the same
   * design, because both open whatever was active, and each one autosaves its
   * own copy on a 500 ms debounce. Writing unconditionally made that last
   * writer wins: a single edit in a tab left open yesterday overwrote a day's
   * work in the other, and once that tab closed there was nothing left to
   * recover from. Nothing ever said so.
   *
   * Null means this tab has no claim on the entry yet (it has not read or
   * written it), and the first write establishes one.
   */
  private lastSeenAt: number | null = null;

  async load(): Promise<Workspace | null> {
    const lib = getDesignLibrary();
    this.activeId = await lib.activeId();

    // A journal is newer than anything stored, but only for ITS design.
    const journal = readJournal();
    if (journal && journal.id && journal.id === this.activeId) {
      // A journal the library has already moved past (see `Journal.t`) is
      // dropped rather than replayed over the newer save. Strictly newer: a
      // tie within the same millisecond keeps the journal, the safe direction.
      const meta = await this.metaOf(journal.id);
      if (typeof journal.t === 'number' && meta && meta.updatedAt > journal.t) {
        clearJournal();
        return await this.readActive(lib);
      }
      // Validate BEFORE writing. `readJournal` only checks that the blob parses
      // and has a `w`; a journal written by a DIFFERENT app build (this is an
      // installed PWA, so an older cached build is a live possibility) can parse
      // cleanly and still not be a workspace this build can open. Writing it
      // first would overwrite the real stored design with it and clear the
      // journal, losing the design permanently — every later load would re-read
      // the same bad blob.
      const w = migrateWorkspace(journal.w);
      if (!w) {
        clearJournal();
        return await this.readActive(lib);
      }
      if (await lib.write(journal.id, (await this.nameOf(journal.id)) ?? nameFor(w), w)) {
        clearJournal();
      }
      // This tab has just written the entry, so the claim it holds on it is the
      // one it leaves behind; without this the first autosave reads its own
      // journal replay as another tab's work.
      this.lastSeenAt = (await this.metaOf(journal.id))?.updatedAt ?? null;
      // The journal carries no results (see `lean`), so they come from their own
      // key — a reload after a run still opens on the numbers it produced.
      return this.trackResults(withResults(w, await lib.readResults(journal.id)));
    }
    // A journal written BEFORE the first save carries a null id, because that
    // is what `saveSync` had to record. Both the replay test above and the
    // staleness test below compared it to `this.activeId`, and `null !== null`
    // is false, so such a journal was never replayed and never cleared: the
    // work done before the first debounced autosave was lost on reload even
    // though `saveSync` had successfully written it, and the dead blob (a
    // whole lean workspace) squatted in the ~5 MB localStorage budget forever.
    //
    // It belongs to "no design yet", so replay it by CREATING one.
    if (journal && journal.id === null && this.activeId === null) {
      const w = migrateWorkspace(journal.w);
      clearJournal();
      if (w) {
        try {
          const meta = await lib.create(nameFor(w), w);
          this.activeId = meta.id;
          return this.trackResults(w);
        } catch {
          // Storage refused it; fall through to whatever is stored.
        }
      }
    }
    // A journal from a design that no longer exists is stale; drop it rather
    // than replaying it over whatever happens to be open now.
    if (journal && journal.id !== this.activeId) clearJournal();

    return await this.readActive(lib);
  }

  /**
   * The active design, or null when there is genuinely nothing saved.
   *
   * THROWS when a design is supposed to be there and cannot be read, so the
   * caller can tell that apart from "nothing saved". Returning null for both
   * opens the hydration gate with the DEFAULT rocket, and 500 ms after the
   * user's first edit the autosave writes that default over the unreadable
   * design AT THE SAME ID. Reachable from a truncated blob, and by construction
   * the moment a build stamps `version: 2` into a PWA whose older build is still
   * cached.
   *
   * `activeId()` has already filtered against the index, so a set `activeId`
   * means the library believes this design exists. Detach before throwing, so
   * the next autosave CREATES a design instead of overwriting the unreadable
   * one, and the user keeps whatever can still be recovered by hand.
   */
  private async readActive(lib: DesignLibrary): Promise<Workspace | null> {
    if (!this.activeId) return null;
    const w = migrateWorkspace(await lib.read(this.activeId));
    if (!w) {
      this.activeId = null;
      throw new Error('unreadable-design');
    }
    this.lastSeenAt = (await this.metaOf(this.activeId))?.updatedAt ?? null;
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

  private async metaOf(id: string): Promise<DesignMeta | null> {
    return (await getDesignLibrary().list()).find((m) => m.id === id) ?? null;
  }

  private async nameOf(id: string): Promise<string | null> {
    return (await this.metaOf(id))?.name ?? null;
  }

  async save(w: Workspace): Promise<void> {
    const lib = getDesignLibrary();
    const leanW = lean(w);
    // Wait out a create already in flight instead of starting a second one
    // (see `creating`). A failure is ignored here so this save can retry it
    // below; the retry reports the failure in its own right.
    if (!this.activeId && this.creating) await this.creating.catch(() => {});
    // First save of a session that started with no library entry (a fresh
    // browser, or everything deleted) creates the design rather than dropping it.
    if (!this.activeId) {
      const gen = this.gen;
      const p = lib.create(this.pendingName || nameFor(w), leanW);
      this.creating = p;
      let meta: DesignMeta;
      try {
        meta = await p;
      } finally {
        if (this.creating === p) this.creating = null;
      }
      if (gen !== this.gen) return; // the workspace moved on; that entry is the old one's
      this.pendingName = null;
      this.activeId = meta.id;
      this.lastSeenAt = meta.updatedAt;
      await this.saveResults(lib, meta.id, w);
      return;
    }
    // Another tab's work is not ours to throw away. Refuse rather than write
    // over an entry that has moved since this tab last saw it, and keep
    // refusing: this tab's design is still in front of the user, who can export
    // it or reopen the design to take the other tab's version. A warning AFTER
    // the overwrite would name work that no longer exists to be rescued.
    const meta = await this.metaOf(this.activeId);
    if (this.lastSeenAt != null && meta && meta.updatedAt > this.lastSeenAt) {
      throw new Error('conflict');
    }
    // The design is the ONE thing here that cannot be recomputed, so surface a
    // failed write (storage full) instead of silently dropping the user's work.
    const name = meta?.name ?? nameFor(w);
    if (!(await lib.write(this.activeId, name, leanW))) throw new Error('storage-full');
    this.lastSeenAt = (await this.metaOf(this.activeId))?.updatedAt ?? Date.now();
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
    this.gen++; // void any create still in flight for the workspace being replaced
    this.activeId = id;
    this.pendingName = null; // it named the design being switched away from
    // A different design has different flights; what we know about the last
    // write no longer applies to the one we are about to make.
    this.savedResults = new Map();
    this.lastSeenAt = null;
  }

  /** Name the next created design (see the interface). Call AFTER
   *  `setActiveId(null)`, which clears it. */
  setPendingName(name: string | null): void {
    this.pendingName = name?.trim() || null;
  }

  /** Synchronous unload write. Best-effort: if it does not fit (the blob is
   *  bigger than localStorage allows) the debounced async save is all there is. */
  saveSync(w: Workspace): void {
    try {
      localStorage.setItem(
        UNLOAD_KEY,
        JSON.stringify({ id: this.activeId, w: lean(w), t: Date.now() } satisfies Journal),
      );
    } catch {
      /* quota or storage blocked — nothing further we can do while unloading */
    }
  }
}

const store: WorkspaceStore = new LibraryWorkspaceStore();
export function getWorkspaceStore(): WorkspaceStore {
  return store;
}
