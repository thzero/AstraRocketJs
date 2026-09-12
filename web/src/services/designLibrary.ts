// The saved-designs library.
//
// Before this, the app held exactly ONE design: a single blob under
// `astrarrocketjs:workspace`, replaced whenever you opened another. That was a
// localStorage-era shape — with IndexedDB there is no reason a design has to be
// the only one. Designs are now addressable:
//
//   astrarrocketjs:designs:index    → DesignMeta[]  (small: id, name, updatedAt)
//   astrarrocketjs:designs:<id>     → one Workspace blob
//   astrarrocketjs:designs:active   → the id currently open
//
// The index is deliberately separate from the designs. Autosave runs on a 500 ms
// debounce while you edit, so it must rewrite ONE design — not a single document
// containing every design, which would grow with the library and get rewritten
// on every keystroke.
import type { KeyValueStore } from './keyValueStore';
import { IndexedDbKeyValueStore } from './idbKeyValueStore';
import type { Workspace } from './workspaceStore';

const INDEX_KEY = 'astrarrocketjs:designs:index';
const ACTIVE_KEY = 'astrarrocketjs:designs:active';
const designKey = (id: string) => `astrarrocketjs:designs:${id}`;
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
    // Index write failing is survivable — the design itself is stored — so the
    // caller's success hinges on the design write above, not this.
    await this.writeIndex([{ id, name, updatedAt: Date.now() }, ...rest]);
    return true;
  }

  /** Register a new design and make it active. Returns its meta. */
  async create(name: string, w: Workspace): Promise<DesignMeta> {
    const id = freshId();
    await this.write(id, name, w);
    await this.setActive(id);
    const meta = (await this.readIndex()).find((m) => m.id === id);
    return meta ?? { id, name, updatedAt: Date.now() };
  }

  async rename(id: string, name: string): Promise<void> {
    const list = await this.readIndex();
    await this.writeIndex(list.map((m) => (m.id === id ? { ...m, name } : m)));
  }

  async remove(id: string): Promise<void> {
    await this.kv.remove(designKey(id));
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
          await this.writeIndex([]); // mark the library as initialised
          return;
        }
        const id = freshId();
        if (!(await this.kv.set(designKey(id), raw))) return; // retry next session
        await this.writeIndex([{ id, name: legacyName(raw), updatedAt: Date.now() }]);
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
