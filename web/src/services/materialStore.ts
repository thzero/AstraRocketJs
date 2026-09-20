// Swappable client-side store for MATERIAL data — the user's custom materials.
// This is a typed DOMAIN store (list/add/remove Materials); the default
// implementation persists through a KeyValueStore, but you can replace the whole
// thing with any MaterialStore on the client (setMaterialStore(...)),
// independently of the motor store.
import type { Material, MaterialType } from '../data/materials';
import type { KeyValueStore } from './keyValueStore';
import { IndexedDbKeyValueStore } from './idbKeyValueStore';

export interface MaterialStore {
  /** All stored custom materials (implementation decides ordering). */
  list(): Promise<Material[]>;
  /** Add or replace (by name+type) a custom material. */
  add(material: Material): Promise<void>;
  /** Remove a custom material by name+type. */
  remove(name: string, type: MaterialType): Promise<void>;
}

const CUSTOM_KEY = 'astrarrocketjs:materials:custom';

function isMaterial(v: unknown): v is Material {
  const m = v as Material;
  return (
    !!m &&
    typeof m.name === 'string' &&
    typeof m.density === 'number' &&
    Number.isFinite(m.density) &&
    (m.type === 'bulk' || m.type === 'surface' || m.type === 'line')
  );
}

/**
 * Default MaterialStore: serializes the custom-material list to a single
 * key-value entry through a KeyValueStore (IndexedDB by default). Pass a
 * different KeyValueStore to persist custom materials elsewhere, or replace the
 * whole MaterialStore via setMaterialStore for a bespoke backend.
 */
export class KeyValueMaterialStore implements MaterialStore {
  constructor(
    private readonly key: string = CUSTOM_KEY,
    private readonly kv: KeyValueStore = new IndexedDbKeyValueStore(),
  ) {}

  /** The stored list, tolerating an absent, corrupt or partly invalid blob. */
  private static parse(raw: string | null): Material[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isMaterial).map((m) => ({ ...m, custom: true }));
    } catch {
      return []; // corrupt entry
    }
  }

  /**
   * Read, transform and write in ONE store transaction, and propagate a
   * refused write the way `motorStore.addCustomMotor` does.
   *
   * `kv.update` reports failure by RETURNING false rather than throwing, so
   * discarding it meant the dialog awaited the save, got a clean resolve, and
   * re-rendered a list that simply did not contain the thing the user had just
   * added - with no error anywhere. "Best-effort (re-addable)" was the excuse,
   * but re-adding is only possible if you are told it did not stick.
   *
   * `update`, not read-then-set: this is an installable PWA whose IndexedDB is
   * shared across tabs, and a get/set with an await between them let two tabs
   * each drop the other's material (the race `DesignLibrary.mutateIndex`
   * closes for the design index).
   */
  private async mutate(fn: (list: Material[]) => Material[]): Promise<void> {
    const ok = await this.kv.update(this.key, (raw) => JSON.stringify(fn(KeyValueMaterialStore.parse(raw))));
    if (!ok) throw new Error('storage-full');
  }

  async list(): Promise<Material[]> {
    return KeyValueMaterialStore.parse(await this.kv.get(this.key));
  }

  async add(material: Material): Promise<void> {
    await this.mutate((list) => [
      { ...material, custom: true },
      ...list.filter((m) => !(m.name === material.name && m.type === material.type)),
    ]);
  }

  async remove(name: string, type: MaterialType): Promise<void> {
    await this.mutate((list) => list.filter((m) => !(m.name === name && m.type === type)));
  }
}

// The active material store. Usually you don't swap THIS — swap the underlying
// KeyValueStore instead — but the seam remains if a bespoke material backend is
// ever wanted (e.g. a server-side shared material library).
let store: MaterialStore = new KeyValueMaterialStore();

export function getMaterialStore(): MaterialStore {
  return store;
}

export function setMaterialStore(next: MaterialStore): void {
  store = next;
}
