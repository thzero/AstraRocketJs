// Swappable client-side store for MATERIAL data — the user's custom materials.
// This is a typed DOMAIN store (list/add/remove Materials); the default
// implementation persists through a KeyValueStore, but you can replace the whole
// thing with any MaterialStore on the client (setMaterialStore(...)),
// independently of the motor store.
import type { Material, MaterialType } from '../data/materials';
import { type KeyValueStore, LocalStorageKeyValueStore } from './keyValueStore';

export interface MaterialStore {
  /** All stored custom materials (implementation decides ordering). */
  list(): Promise<Material[]>;
  /** Add or replace (by name+type) a custom material. */
  add(material: Material): Promise<void>;
  /** Remove a custom material by name+type. */
  remove(name: string, type: MaterialType): Promise<void>;
}

const CUSTOM_KEY = 'materials:custom';

function isMaterial(v: unknown): v is Material {
  const m = v as Material;
  return !!m && typeof m.name === 'string' && typeof m.density === 'number'
    && Number.isFinite(m.density) && (m.type === 'bulk' || m.type === 'surface' || m.type === 'line');
}

/**
 * Default MaterialStore: serializes the custom-material list to a single
 * key-value entry through a KeyValueStore (localStorage by default). Pass a
 * different KeyValueStore to persist custom materials elsewhere, or replace the
 * whole MaterialStore via setMaterialStore for a bespoke backend.
 */
export class KeyValueMaterialStore implements MaterialStore {
  constructor(
    private readonly key: string = CUSTOM_KEY,
    private readonly kv: KeyValueStore = new LocalStorageKeyValueStore(),
  ) {}

  private async read(): Promise<Material[]> {
    const raw = await this.kv.get(this.key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isMaterial).map((m) => ({ ...m, custom: true }));
    } catch {
      return []; // corrupt entry
    }
  }

  private write(list: Material[]): Promise<void> {
    return this.kv.set(this.key, JSON.stringify(list));
  }

  async list(): Promise<Material[]> {
    return this.read();
  }

  async add(material: Material): Promise<void> {
    const rest = (await this.read()).filter((m) => !(m.name === material.name && m.type === material.type));
    await this.write([{ ...material, custom: true }, ...rest]);
  }

  async remove(name: string, type: MaterialType): Promise<void> {
    await this.write((await this.read()).filter((m) => !(m.name === name && m.type === type)));
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
