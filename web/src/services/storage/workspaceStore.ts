// Persistence for the working session (the design tree plus its simulations),
// so a reload restores your work. Swap the backend at the library, which is what
// actually owns storage:
//
//   import { setDesignLibrary, DesignLibrary } from './designLibrary';
//   setDesignLibrary(new DesignLibrary(myKeyValueStore));   // a REST sync, …
//
// The default persists the active design through the design library
// (designLibrary.ts), which holds many designs in IndexedDB. This interface
// stays narrow on purpose: it is only "the design being edited"; listing,
// opening, renaming and deleting designs are the library's job.
import { freshId, getDesignLibrary, type DesignLibrary, type DesignMeta, type StoredResults } from './designLibrary';
import type { FlightResult, RocketTree } from '../../engine/openRocketEngine';
import { withoutResults, type Simulation } from '../flight/simulations';
import type { FlightConfig } from '../flight/flightConfigs';
import { migrateWorkspace } from './workspaceMigrate';
import type { OrkExportMotor } from '../files/orkFile';
import type { ImportNote } from '../files/importNote';
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
  loadedMeta: { name: string; notes: ImportNote[]; exportMotors: Record<string, OrkExportMotor> } | null;
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
   * Point the store at a design and read it the way boot does: the stamp
   * before the blob, the stored flights put back on their simulations, and the
   * claim taken only once the whole read succeeds. Optional, like setActiveId.
   */
  openActive?(id: string): Promise<Workspace | null>;
  /**
   * The name to create under while detached (`setActiveId(null)`), instead of
   * the one the workspace implies.
   *
   * Import resolves a name clash with the library before it hands the rocket
   * over (see fileSlice.ts `homeForImport`), and the answer has to survive until
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
 * It records which design it belongs to: with a library the active design can
 * change between sessions, and replaying a journal into the wrong one would
 * overwrite an unrelated rocket.
 */
const UNLOAD_KEY = nsKey('designs:unload');

/**
 * The journal is replayed only over the version its edits derive from.
 *
 * The unload write is a last resort, and the entry can move on without it:
 * another tab of this PWA saves the same design, before this tab unloads or
 * after. The journal's write time says nothing about that, because a stale tab
 * that never tried to save still writes its journal at unload, later than the
 * other tab's save. So the journal records `base`, the entry's `updatedAt` as
 * this tab last saw it, and `tab`, the tab that wrote it. The next `load()`
 * replays it when the entry has not moved past `base`, or when the entry's last
 * writer is the journal's own tab (its debounced save, in flight at pagehide,
 * can commit after the journal and is not newer work).
 *
 * A journal with no `base` (written before this tab had read or written the
 * entry, or by an older build) falls back to `t`: dropped when the entry was
 * saved after the journal was written. That is the same claim this tab's next
 * save would make, which writes unconditionally until it holds a stamp. A
 * journal with neither is replayed, as the build that wrote it intended.
 */
interface Journal {
  id: string | null;
  w: Workspace;
  /** The entry's `updatedAt` as the writing tab last saw it, or null. */
  base?: number | null;
  /** The writing tab (see `DesignMeta.writer`). */
  tab?: string;
  /** When `saveSync` wrote it (epoch ms). */
  t?: number;
  /**
   * The writing tab's mark when it wrote the journal (see `LibraryWorkspaceStore.mark`):
   * ordered against that tab's saves, as a wall clock that can step backward is not.
   */
  mark?: number;
  /**
   * With a null `id`: the entry the writing tab's first create makes. The
   * create can land after the journal or not at all, and only this tells the
   * two apart on the next load.
   */
  createId?: string;
  /** With a null `id`: the name that create uses (see `setPendingName`). */
  name?: string;
}

/** True when replaying `j` cannot roll back a save made by another tab. */
function journalIsCurrent(j: Journal, meta: DesignMeta | null): boolean {
  if (!meta) return true;
  if (j.tab && meta.writer === j.tab) return true;
  // Strictly newer drops it: a tie means the entry is the one the tab saw.
  if (typeof j.base === 'number') return meta.updatedAt <= j.base;
  if (typeof j.t === 'number') return meta.updatedAt <= j.t;
  return true;
}

/** Per-tab, per-page-load: a reload is a new writer, and its journal names the old one. */
const freshTabId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/**
 * The workspace without its flight results.
 *
 * Every write of a design blob goes through this, Save As included (fileSlice).
 * The design blob is rewritten on every keystroke's debounced autosave, and a
 * result is tens of thousands of samples, so they live under their own key
 * instead (see DesignLibrary.writeResults). The unload
 * journal goes to localStorage, whose whole-origin budget is ~5 MB, so results
 * must never go near it; the async save that follows a run puts them in
 * IndexedDB within the debounce, so the journal loses nothing that matters.
 */
export const lean = (w: Workspace): Workspace => ({ ...w, sims: withoutResults(w.sims) });

/** Re-attach stored flights to the simulations that produced them. */
const withResults = (w: Workspace, results: StoredResults): Workspace => ({
  ...w,
  sims: w.sims.map((s) => (results[s.id] ? { ...s, result: results[s.id]! } : s)),
});

/** Just the flights, by simulation id: what gets stored under the results key. */
export const resultsOf = (w: Workspace): StoredResults => {
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

/**
 * Drop this tab's journal for `id` once a save that began after it was written
 * has landed. Each hide writes the journal, and a same-tab journal is replayed
 * whatever the entry's stamp says (a save in flight at pagehide can commit after
 * it, holding older work), so one left behind would roll a later autosave back
 * the next time the session ends without a final pagehide (a crash, a killed
 * process, a journal too big for localStorage). A save that began after the
 * journal holds newer work than it.
 */
function dropSupersededJournal(tab: string, id: string, startedAt: number): void {
  const j = readJournal();
  if (!j || j.tab !== tab || typeof j.mark !== 'number' || j.mark >= startedAt) return;
  if (j.id === id || (j.id === null && j.createId === id)) clearJournal();
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
   * finishes and is never mutated, so `!==` is both correct and free, where
   * comparing the arrays would cost as much as writing them. Without this, every
   * keystroke's autosave would re-serialize every flight.
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
   * The id the next create uses while detached, chosen before the create so the
   * unload journal can name the entry the create is making (see `Journal`).
   * Cleared by `setActiveId`, so a new detached design gets an id of its own.
   */
  private createId: string | null = null;
  /**
   * Bumped by every `setActiveId`. A create that resolves after the workspace
   * has moved on (New, or a second import, during that first slow write) must
   * not adopt its id: the entry it made belongs to the design that has just
   * been replaced, and claiming it would send the new design's autosaves
   * straight over the old one.
   */
  private gen = 0;
  /**
   * The library's `updatedAt` for the active design as this tab last saw it.
   *
   * The autosave slot is shared. Two tabs of an installed PWA open the same
   * design, because both open whatever was active, and each one autosaves its
   * own copy on a 500 ms debounce. Writing unconditionally would make it last
   * writer wins: a single edit in a stale tab would silently overwrite the
   * other tab's work. `save` compares against this and refuses instead.
   *
   * Null means this tab has no claim on the entry yet (it has not read or
   * written it), and the first write establishes one.
   */
  private lastSeenAt: number | null = null;
  /**
   * True once a save has been refused because another tab moved the entry on.
   *
   * `saveSync` reads it and writes no journal: this tab's design is known to be
   * stale, and the next load would drop it anyway (see `Journal`), so writing it
   * only spends the localStorage budget. Cleared by `setActiveId`.
   */
  private conflicted = false;
  /**
   * The stamps this tab put on entries it has switched away from, by id, so a
   * second queued save to one of them claims from the first one's write rather
   * than reading that write as another tab's.
   */
  private detached = new Map<string, number>();
  /**
   * True while the unload journal found at boot is the only copy of its work:
   * storage could not be read, so it was opened rather than replayed. This
   * session's unload write would replace it, so it writes none until a save
   * has stored the work as a design.
   */
  private journalHeld = false;
  /** This tab's name on the saves it makes (see `DesignMeta.writer`). */
  private readonly tab = freshTabId();
  /**
   * Counts this tab's saves and journal writes, in the order they happen, so a
   * journal can be told from a save that began after it (`dropSupersededJournal`).
   */
  private mark = 0;

  async load(): Promise<Workspace | null> {
    const lib = getDesignLibrary();
    // A journal is newer than anything stored, but only for its own design.
    let journal = readJournal();
    try {
      this.activeId = await lib.activeIdChecked();
    } catch {
      // Storage could not be read, which is not the same as nothing stored:
      // every test below would read the journal as stale and drop the user's
      // last unsaved work. Keep it, held against this session's unload write,
      // and open its work detached so the next save stores it as a design.
      // With no journal there is nothing to keep, and the session opens as it
      // would on an empty library.
      this.activeId = null;
      const w = journal ? migrateWorkspace(journal.w) : null;
      if (!w) return null;
      this.journalHeld = true;
      if (journal!.id === null) this.adoptCreate(journal!);
      return this.trackResults(w);
    }

    // A detached tab's journal names the entry its first create makes. Once that
    // create has landed, the journal belongs to the entry like any other and
    // follows the same rules (another tab's later save still wins).
    if (journal && journal.id === null && journal.createId && (await this.metaOf(journal.createId))) {
      journal = { ...journal, id: journal.createId };
    }

    if (journal && journal.id && journal.id === this.activeId) {
      // A journal another tab's save has moved past (see `Journal`) is dropped
      // rather than replayed over the newer work.
      if (!journalIsCurrent(journal, await this.metaOf(journal.id))) {
        clearJournal();
        return await this.readActive(lib);
      }
      // Validate before writing. `readJournal` only checks that the blob parses
      // and has a `w`; a journal written by a different app build (this is an
      // installed PWA, so an older cached build is a live possibility) can parse
      // cleanly and still not be a workspace this build can open. Writing it
      // first would overwrite the real stored design with it and clear the
      // journal, losing the design permanently: every later load would re-read
      // the same bad blob.
      const w = migrateWorkspace(journal.w);
      if (!w) {
        clearJournal();
        return await this.readActive(lib);
      }
      if (await lib.write(journal.id, (await this.nameOf(journal.id)) ?? nameFor(w), w, this.tab)) {
        clearJournal();
      }
      // This tab has just written the entry, so the claim it holds on it is the
      // one it leaves behind; without this the first autosave reads its own
      // journal replay as another tab's work.
      this.lastSeenAt = (await this.metaOf(journal.id))?.updatedAt ?? null;
      // The journal carries no results (see `lean`), so they come from their own
      // key, so a reload after a run still opens on the numbers it produced.
      return this.trackResults(withResults(w, await lib.readResults(journal.id)));
    }
    // A journal written before the first save carries a null id, because that
    // is what `saveSync` had to record. The replay test above requires a set id
    // and the staleness test below sees `null === null` as a match, so neither
    // handles it. Without this branch the work done before the first debounced
    // autosave would be lost on reload, and the blob (a whole lean workspace)
    // would stay in the ~5 MB localStorage budget forever.
    //
    // It belongs to "no design yet", so replay it by creating one, whatever the
    // library's active pointer says. New and import detach this store without
    // moving the pointer, so a reload inside the autosave debounce finds the
    // previous design still active, and the journal is the only copy of the new
    // one. A journal with no `createId` (an older build) cannot tell whether its
    // create landed, so it replays only when nothing is active.
    if (journal && journal.id === null && (journal.createId || this.activeId === null)) {
      const w = migrateWorkspace(journal.w);
      if (!w) {
        clearJournal();
        return await this.readActive(lib);
      }
      this.adoptCreate(journal);
      try {
        const meta = await lib.create(journal.name || nameFor(w), w, this.tab, this.nextCreateId());
        clearJournal();
        this.createId = null;
        this.pendingName = null;
        this.activeId = meta.id;
        this.lastSeenAt = meta.updatedAt;
      } catch {
        // Storage refused it (full, the failure the journal exists for). The
        // journal is the only copy, so it stays, and its work is what opens
        // detached; the next save tries the same create again.
        this.activeId = null;
      }
      return this.trackResults(w);
    }
    // A journal from a design that no longer exists is stale; drop it rather
    // than replaying it over whatever happens to be open now.
    if (journal && journal.id !== this.activeId) clearJournal();

    return await this.readActive(lib);
  }

  /**
   * The active design, or null when there is genuinely nothing saved.
   *
   * Throws when a design is supposed to be there and cannot be read, so the
   * caller can tell that apart from "nothing saved". Returning null for both
   * would open the hydration gate with the default rocket, and 500 ms after the
   * user's first edit the autosave would write that default over the unreadable
   * design at the same id. Reachable from a truncated blob, or from a blob
   * written by a newer build while an older build is still cached in the PWA.
   *
   * `activeId()` has already filtered against the index, so a set `activeId`
   * means the library believes this design exists. Detach before throwing, so
   * the next autosave creates a design instead of overwriting the unreadable
   * one, and the user keeps whatever can still be recovered by hand.
   *
   * The claim (`lastSeenAt`) is taken only once the whole read has succeeded,
   * for the same reason: a claim on a design that then fails to open lets the
   * first autosave through `writeIfUnchanged` with a matching stamp. A caller
   * whose own step fails after this (`hydrate`) detaches the store itself.
   */
  private async readActive(lib: DesignLibrary): Promise<Workspace | null> {
    const id = this.activeId;
    if (!id) return null;
    try {
      // The stamp before the blob: a save in another tab claims the stamp before
      // it writes the blob and stamps again after, so a stamp read first is never
      // newer than the blob read after it (see `DesignLibrary.writeIfUnchanged`).
      const seenAt = (await this.metaOf(id))?.updatedAt ?? null;
      const w = migrateWorkspace(await lib.read(id));
      if (!w) throw new Error('unreadable-design');
      const full = withResults(w, await lib.readResults(id));
      this.lastSeenAt = seenAt;
      return this.trackResults(full);
    } catch (e) {
      this.activeId = null;
      throw e;
    }
  }

  /** Take over a detached journal's pending create, so a retry makes the same entry. */
  private adoptCreate(j: Journal): void {
    if (j.createId) this.createId = j.createId;
    if (j.name) this.pendingName = j.name;
  }

  private nextCreateId(): string {
    return (this.createId ??= freshId());
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

  /**
   * The write into the active entry that is in flight, which the next one
   * waits for. Two saves from this tab overlap easily (the debounced autosave
   * and the `visibilitychange` flush), and run together both would compare
   * against the same stamp: the first to commit moves it, and the second reads
   * this tab's own write as another tab's.
   */
  private writing: Promise<unknown> = Promise.resolve();

  async save(w: Workspace): Promise<void> {
    const lib = getDesignLibrary();
    // When the work this save holds was taken, against an unload journal's mark.
    const startedAt = ++this.mark;

    const gen = this.gen;
    const leanW = lean(w);
    // Wait out a create already in flight instead of starting a second one
    // (see `creating`). A failure is ignored here so this save can retry it
    // below; the retry reports the failure in its own right.
    if (!this.activeId && this.creating) await this.creating.catch(() => {});
    // First save of a session that started with no library entry (a fresh
    // browser, or everything deleted) creates the design rather than dropping it.
    if (!this.activeId) {
      const p = lib.create(this.pendingName || nameFor(w), leanW, this.tab, this.nextCreateId());
      this.creating = p;
      let meta: DesignMeta;
      try {
        meta = await p;
      } finally {
        if (this.creating === p) this.creating = null;
      }
      if (gen !== this.gen) return; // the workspace moved on; that entry is the old one's
      this.pendingName = null;
      this.createId = null;
      this.activeId = meta.id;
      this.lastSeenAt = meta.updatedAt;
      this.journalHeld = false;
      dropSupersededJournal(this.tab, meta.id, startedAt);
      await this.saveResults(lib, meta.id, w);
      return;
    }
    // The entry this workspace belongs to, as of the call: a switch while this
    // save waits its turn points the store at a design these bytes are not.
    // The claim on it is taken now for the same reason: `setActiveId` clears
    // `lastSeenAt` and `conflicted`, and read after a switch they would let a
    // queued save write over the old entry unconditionally.
    const id = this.activeId;
    const claim = { seenAt: this.lastSeenAt, conflicted: this.conflicted };
    const run = this.writing.then(() => this.writeEntry(lib, id, w, leanW, gen, claim, startedAt));
    this.writing = run.catch(() => {});
    await run;
  }

  private async writeEntry(
    lib: DesignLibrary,
    id: string,
    w: Workspace,
    leanW: Workspace,
    gen: number,
    claim: { seenAt: number | null; conflicted: boolean },
    startedAt: number,
  ) {
    // Another tab's work is not ours to throw away. Refuse rather than write
    // over an entry that has moved since this tab last saw it, and keep
    // refusing: this tab's design is still in front of the user, who can export
    // it or reopen the design to take the other tab's version. A warning after
    // the overwrite would name work that no longer exists to be rescued. The
    // compare is made inside the index write (`writeIfUnchanged`), so two tabs
    // cannot both pass it.
    //
    // A save queued before a switch runs against the claim it was made under,
    // carried forward by any earlier queued save to the same entry (`detached`);
    // a save the tab already knew was refused stays refused.
    const mine = gen === this.gen;
    if (!mine && claim.conflicted) return;
    const carried = this.detached.get(id);
    const seenAt = mine
      ? this.lastSeenAt
      : carried != null && (claim.seenAt == null || carried > claim.seenAt)
        ? carried
        : claim.seenAt;
    const res = await lib.writeIfUnchanged(id, nameFor(w), leanW, seenAt, this.tab);
    if (gen !== this.gen) {
      // The store has moved to another design, so nothing learned here is
      // about its entry. The flights still go with the design they belong to.
      if (res.updatedAt != null) this.detached.set(id, res.updatedAt);
      if (res.status === 'ok') await lib.writeResults(id, resultsOf(w)).catch(() => false);
      return;
    }
    if (res.updatedAt != null) this.lastSeenAt = res.updatedAt;
    if (res.status === 'conflict') {
      this.conflicted = true;
      throw new Error('conflict');
    }
    // The design is the one thing here that cannot be recomputed, so surface a
    // failed write (storage full) instead of silently dropping the user's work.
    if (res.status === 'refused') throw new Error('storage-full');
    dropSupersededJournal(this.tab, id, startedAt);
    await this.saveResults(lib, id, w);
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

  /**
   * Switch to a library design and read it as boot reads the active one
   * (`readActive`). Without the flights, a design that has flown would open
   * with every row not run, and the first edit's autosave would write an empty
   * results map over the stored ones; without the claim, that autosave would
   * skip the two-tab check and could overwrite another tab's save.
   */
  async openActive(id: string): Promise<Workspace | null> {
    this.setActiveId(id);
    return await this.readActive(getDesignLibrary());
  }

  /** Point the store at a different design (the library owns the switch). */
  setActiveId(id: string | null): void {
    this.gen++; // void any create still in flight for the workspace being replaced
    this.activeId = id;
    this.pendingName = null; // it named the design being switched away from
    this.createId = null;
    // A different design has different flights; what we know about the last
    // write no longer applies to the one we are about to make.
    this.savedResults = new Map();
    this.lastSeenAt = null;
    this.conflicted = false;
  }

  /** Name the next created design (see the interface). Call after
   *  `setActiveId(null)`, which clears it. */
  setPendingName(name: string | null): void {
    this.pendingName = name?.trim() || null;
  }

  /** Synchronous unload write. Best-effort: if it does not fit (the blob is
   *  bigger than localStorage allows) the debounced async save is all there is. */
  saveSync(w: Workspace): void {
    // Another tab owns the newer copy (see `conflicted`).
    if (this.conflicted) return;
    // The journal from boot is the only copy of earlier work (see `journalHeld`).
    if (this.journalHeld) return;
    const detached = this.activeId === null;
    try {
      localStorage.setItem(
        UNLOAD_KEY,
        JSON.stringify({
          id: this.activeId,
          w: lean(w),
          base: this.lastSeenAt,
          tab: this.tab,
          t: Date.now(),
          mark: ++this.mark,
          ...(detached ? { createId: this.nextCreateId() } : {}),
          ...(detached && this.pendingName ? { name: this.pendingName } : {}),
        } satisfies Journal),
      );
    } catch {
      /* quota or storage blocked; nothing further we can do while unloading */
    }
  }
}

const store: WorkspaceStore = new LibraryWorkspaceStore();
export function getWorkspaceStore(): WorkspaceStore {
  return store;
}
