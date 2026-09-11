// Persistence for the working session — the design tree plus its simulations —
// so a reload restores your work. Swappable like the motor/material stores:
//
//   import { setWorkspaceStore } from './services/workspaceStore';
//   setWorkspaceStore(new MyWorkspaceStore());   // IndexedDB, a REST sync, …
//
// The default persists a single JSON blob through a KeyValueStore (localStorage).
import { type KeyValueStore, LocalStorageKeyValueStore } from './keyValueStore';
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
}

const KEY = 'astrarrocketjs:workspace';

/** Default store: one JSON blob via a KeyValueStore (localStorage by default). */
export class KeyValueWorkspaceStore implements WorkspaceStore {
  constructor(private readonly kv: KeyValueStore = new LocalStorageKeyValueStore()) {}

  async load(): Promise<Workspace | null> {
    const raw = await this.kv.get(KEY);
    if (!raw) return null;
    try {
      const w = JSON.parse(raw) as Workspace;
      // Validate the shape before handing the tree to the engine: a truncated or
      // hand-edited blob whose `tree.components` isn't an array would crash
      // buildTree deep in the kernel rather than fail cleanly here.
      return w &&
        w.version === 1 &&
        w.tree &&
        Array.isArray((w.tree as { components?: unknown }).components) &&
        Array.isArray(w.sims) &&
        w.sims.length > 0
        ? w
        : null;
    } catch {
      return null;
    }
  }

  async save(w: Workspace): Promise<void> {
    // Drop cached flight results — they're recomputable and the time-series can
    // be large. The design + each sim's motor / launch / name are what persist.
    const lean: Workspace = { ...w, sims: w.sims.map((s) => ({ ...s, result: null })) };
    // The design is the ONE thing here that can't be recomputed, so surface a
    // failed write (storage full) instead of silently dropping the user's work.
    if (!(await this.kv.set(KEY, JSON.stringify(lean)))) {
      throw new Error('storage-full');
    }
  }

  async clear(): Promise<void> {
    await this.kv.remove(KEY);
  }
}

const store: WorkspaceStore = new KeyValueWorkspaceStore();
export function getWorkspaceStore(): WorkspaceStore {
  return store;
}
