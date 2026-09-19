// The saved-designs library.
//
// Before this, the app held exactly ONE design: a single blob under
// `astrarrocketjs:workspace`, replaced whenever you opened another. That was a
// localStorage-era shape — with IndexedDB there is no reason a design has to be
// the only one. Designs are now addressable:
//
//   astrarrocketjs:designs:index        → DesignMeta[]  (small: id, name, updatedAt)
//   astrarrocketjs:designs:<id>         → one Workspace blob (the INPUTS)
//   astrarrocketjs:designs:<id>:results → that design's flight results
//   astrarrocketjs:designs:active       → the id currently open
//
// The index is deliberately separate from the designs. Autosave runs on a 500 ms
// debounce while you edit, so it must rewrite ONE design — not a single document
// containing every design, which would grow with the library and get rewritten
// on every keystroke.
//
// Flight RESULTS are separate for the same reason, one level down. A result is
// tens of thousands of per-timestep samples; the inputs are a few kilobytes. Held
// in the one blob, every keystroke's autosave would re-serialize every flight the
// design has ever run. Split, the inputs stay cheap to write and the results are
// written only when a run actually produces one (see workspaceStore.save).
import type { KeyValueStore } from './keyValueStore';
import { IndexedDbKeyValueStore } from './idbKeyValueStore';
import type { Workspace } from './workspaceStore';
import type { FlightResult } from '../engine/openRocketEngine';

/** A design's cached flights, by simulation id. */
export type StoredResults = Record<string, FlightResult>;

const INDEX_KEY = 'astrarrocketjs:designs:index';
const ACTIVE_KEY = 'astrarrocketjs:designs:active';
const designKey = (id: string) => `astrarrocketjs:designs:${id}`;
const resultsKey = (id: string) => `astrarrocketjs:designs:${id}:results`;
/** The pre-library single-workspace key, migrated on first use. */
const LEGACY_KEY = 'astrarrocketjs:workspace';

export interface DesignMeta {
  id: string;
  name: string;
  /** Epoch ms of the last save; the library lists most-recent first. */
  updatedAt: number;
}

const isMeta = (v: unknown): v is DesignMeta => {
  const m = v as DesignMeta | null;
  return !!m && typeof m.id === 'string' && typeof m.name === 'string' && typeof m.updatedAt === 'number';
};

/** Short, collision-free enough for a per-browser library. */
const freshId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export class DesignLibrary {
  constructor(private readonly kv: KeyValueStore = new IndexedDbKeyValueStore()) {}

  // --- index -------------------------------------------------------------

  /** Saved designs, most recently updated first. */
  async list(): Promise<DesignMeta[]> {
    await this.migrateLegacy();
    return (await this.readIndex()).slice().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private async readIndex(): Promise<DesignMeta[]> {
    const raw = await this.kv.get(INDEX_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter(isMeta) : [];
    } catch {
      return []; // corrupt index — the designs themselves are still addressable
    }
  }

  private async writeIndex(list: DesignMeta[]): Promise<boolean> {
    return await this.kv.set(INDEX_KEY, JSON.stringify(list));
  }

  // --- active design -----------------------------------------------------

  async activeId(): Promise<string | null> {
    await this.migrateLegacy();
    const id = await this.kv.get(ACTIVE_KEY);
    if (!id) return null;
    // An id pointing at a deleted design would strand the app on an empty
    // workspace it cannot save to.
    return (await this.readIndex()).some((m) => m.id === id) ? id : null;
  }

  async setActive(id: string): Promise<void> {
    await this.kv.set(ACTIVE_KEY, id);
  }

  // --- designs -----------------------------------------------------------

  async read(id: string): Promise<Workspace | null> {
    const raw = await this.kv.get(designKey(id));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Workspace;
    } catch {
      return null;
    }
  }

  /** Write a design and stamp its index entry. Returns false if storage refused. */
  async write(id: string, name: string, w: Workspace): Promise<boolean> {
    if (!(await this.kv.set(designKey(id), JSON.stringify(w)))) return false;
    const list = await this.readIndex();
    const rest = list.filter((m) => m.id !== id);
    // The index write counts too. It was treated as survivable on the grounds
    // that the design itself is stored — but `activeId()` filters against this
    // index, so a design missing from it is unreachable: a newly created one
    // vanishes and the next session opens empty over orphaned bytes, and an
    // existing one stops advancing its `updatedAt` so the library list silently
    // goes stale. Reporting the failure lets `workspaceStore.save()` raise
    // "storage full" instead of the user finding out later.
    return await this.writeIndex([{ id, name, updatedAt: Date.now() }, ...rest]);
  }

  /**
   * Register a new design and make it active. Returns its meta.
   *
   * Throws `storage-full` if the write is refused. It used to discard `write`'s
   * boolean and fall back to a FABRICATED meta, so the caller got a clean
   * resolve for a design that was never stored — and this is the path taken by
   * the first save of a session, i.e. exactly when there is no other copy yet.
   */
  async create(name: string, w: Workspace): Promise<DesignMeta> {
    const id = freshId();
    if (!(await this.write(id, name, w))) throw new Error('storage-full');
    await this.setActive(id);
    const meta = (await this.readIndex()).find((m) => m.id === id);
    return meta ?? { id, name, updatedAt: Date.now() };
  }

  async rename(id: string, name: string): Promise<void> {
    const list = await this.readIndex();
    await this.writeIndex(list.map((m) => (m.id === id ? { ...m, name } : m)));
  }

  // --- flight results ----------------------------------------------------

  /** A design's cached flights. Missing or unreadable reads as "none". */
  async readResults(id: string): Promise<StoredResults> {
    const raw = await this.kv.get(resultsKey(id));
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as StoredResults;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {}; // a truncated blob costs a re-run, not the design
    }
  }

  /**
   * Replace a design's cached flights. An empty map REMOVES the key rather than
   * storing `{}`, so a design whose results were all invalidated stops occupying
   * space for them.
   *
   * Best-effort by design: unlike the inputs, a result that will not fit is
   * recomputable, so a refused write is not worth failing a save over.
   */
  async writeResults(id: string, results: StoredResults): Promise<boolean> {
    if (!Object.keys(results).length) {
      await this.kv.remove(resultsKey(id));
      return true;
    }
    return await this.kv.set(resultsKey(id), JSON.stringify(results));
  }

  async remove(id: string): Promise<void> {
    await this.kv.remove(designKey(id));
    await this.kv.remove(resultsKey(id)); // or the flights outlive their design
    await this.writeIndex((await this.readIndex()).filter((m) => m.id !== id));
    if ((await this.kv.get(ACTIVE_KEY)) === id) await this.kv.remove(ACTIVE_KEY);
  }

  // --- migration ---------------------------------------------------------

  private migrated: Promise<void> | null = null;

  /**
   * Fold a pre-library single workspace into the library as its first design.
   *
   * Runs at most once per session and only when there is no index yet, so an
   * empty library created by the user deleting everything is not re-seeded from
   * a stale legacy blob. The legacy key is removed only after the design is
   * safely written.
   */
  private migrateLegacy(): Promise<void> {
    return (this.migrated ??= (async () => {
      try {
        if (await this.kv.get(INDEX_KEY)) return; // library already exists
        const raw = await this.kv.get(LEGACY_KEY);
        if (!raw) {
          await this.writeIndex([]); // mark the library as initialized
          return;
        }
        const id = freshId();
        if (!(await this.kv.set(designKey(id), raw))) return; // retry next session
        // The INDEX write gates the delete too, for the same reason the blob
        // write does. `activeId()` filters against this index, so a design
        // missing from it is unreachable — and the line below removes the only
        // other copy. Blob stored + index refused (quota, degraded fallback)
        // used to leave the user opening an empty workspace with their
        // pre-library design gone for good.
        if (!(await this.writeIndex([{ id, name: legacyName(raw), updatedAt: Date.now() }]))) return;
        await this.setActive(id);
        await this.kv.remove(LEGACY_KEY);
      } catch {
        // Never let a migration problem stop the app from starting.
      }
    })());
  }
}

/** Name the migrated design after its imported .ork, else a sensible default. */
function legacyName(raw: string): string {
  try {
    const w = JSON.parse(raw) as Workspace;
    const name = w.loadedMeta?.name?.trim();
    if (name) return name;
  } catch {
    /* fall through */
  }
  return 'My Rocket';
}

let library = new DesignLibrary();
export function getDesignLibrary(): DesignLibrary {
  return library;
}
/** Swap the library (tests, or a different backend). */
export function setDesignLibrary(next: DesignLibrary): void {
  library = next;
}
