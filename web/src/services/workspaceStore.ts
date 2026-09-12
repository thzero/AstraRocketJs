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
import { getDesignLibrary } from './designLibrary';
import type { RocketTree } from '../engine/openRocketEngine';
import type { Simulation } from './simulations';
import type { MountMotor } from './loadOrk';
import type { OrkExportMotor } from './orkFile';

export interface Workspace {
  version: 1;
  tree: RocketTree;
  sims: Simulation[];
  activeId: string;
  /** Motors for non-primary mounts (multi-mount .ork imports). */
  extraMotors: Record<string, MountMotor>;
  /** Imported-.ork source metadata (banner + round-trip export), or null. */
  loadedMeta: { name: string; notes: string[]; exportMotors: Record<string, OrkExportMotor> } | null;
}

export interface WorkspaceStore {
  load(): Promise<Workspace | null>;
  save(w: Workspace): Promise<void>;
  clear(): Promise<void>;
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

/** Drop cached flight results — recomputable, and the time-series can be large.
 *  The design plus each sim's motor / launch / name are what persist. */
const lean = (w: Workspace): Workspace => ({ ...w, sims: w.sims.map((s) => ({ ...s, result: null })) });

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

  async load(): Promise<Workspace | null> {
    const lib = getDesignLibrary();
    this.activeId = await lib.activeId();

    // A journal is newer than anything stored, but only for ITS design.
    const journal = readJournal();
    if (journal && journal.id && journal.id === this.activeId) {
      if (await lib.write(journal.id, (await this.nameOf(journal.id)) ?? nameFor(journal.w), journal.w)) {
        clearJournal();
      }
      return validate(journal.w);
    }
    // A journal from a design that no longer exists is stale; drop it rather
    // than replaying it over whatever happens to be open now.
    if (journal && journal.id !== this.activeId) clearJournal();

    return this.activeId ? validate(await lib.read(this.activeId)) : null;
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
      return;
    }
    // The design is the ONE thing here that cannot be recomputed, so surface a
    // failed write (storage full) instead of silently dropping the user's work.
    const name = (await this.nameOf(this.activeId)) ?? nameFor(w);
    if (!(await lib.write(this.activeId, name, leanW))) throw new Error('storage-full');
  }

  async clear(): Promise<void> {
    clearJournal();
    if (this.activeId) await getDesignLibrary().remove(this.activeId);
    this.activeId = null;
  }

  /** Point the store at a different design (the library owns the switch). */
  setActiveId(id: string | null): void {
    this.activeId = id;
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
