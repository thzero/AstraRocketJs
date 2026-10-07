// Swappable client-side store for MATERIAL data — the user's custom materials.
// This is a typed DOMAIN store (list/add/remove Materials); the default
// implementation persists through a KeyValueStore, but you can replace the whole
// thing with any MaterialStore on the client (setMaterialStore(...)),
// independently of the motor store.
import type { Material, MaterialType } from './materialTypes';
import type { KeyValueStore } from '../storage/keyValueStore';
import { IndexedDbKeyValueStore } from '../storage/idbKeyValueStore';
import { JsonListStore } from '../storage/jsonListStore';
import { nsKey } from '../storage/storageKeys';

export interface MaterialStore {
  /** All stored custom materials (implementation decides ordering). */
  list(): Promise<Material[]>;
  /** Add or replace (by name+type) a custom material. */
  add(material: Material): Promise<void>;
  /** Remove a custom material by name+type. */
  remove(name: string, type: MaterialType): Promise<void>;
}

const CUSTOM_KEY = nsKey('materials:custom');

/**
 * A stored entry that is a usable material.
 *
 * `density > 0`, not merely finite. Every reader of a density divides or
 * multiplies by it: a zero gives a part with no mass at all and a negative one
 * gives a part that lightens the rocket and drags the CG off the airframe. The
 * `.ork` and `.rkt` readers both already require `> 0` of a density off a file
 * (`matDensity`, `readSoftMaterial`), and the kernel only calls `setMaterial`
 * when the node carries a positive one. This is the same rule for the entry that
 * comes back out of the user's own custom list.
 */
function isMaterial(v: unknown): v is Material {
  const m = v as Material;
  return (
    !!m &&
    typeof m.name === 'string' &&
    typeof m.density === 'number' &&
    Number.isFinite(m.density) &&
    m.density > 0 &&
    (m.type === 'bulk' || m.type === 'surface' || m.type === 'line')
  );
}

/** A material's identity in the list: its name and type together. */
const materialId = (name: string, type: MaterialType): string => JSON.stringify([type, name]);

/**
 * Default MaterialStore: serializes the custom-material list to a single
 * key-value entry through a KeyValueStore (IndexedDB by default). Pass a
 * different KeyValueStore to persist custom materials elsewhere, or replace the
 * whole MaterialStore via setMaterialStore for a bespoke backend.
 */
export class KeyValueMaterialStore implements MaterialStore {
  private readonly items: JsonListStore<Material>;

  /**
   * Newest save first, one entry per name+type (a "Balsa" bulk and a "Balsa"
   * surface are two materials). Every entry read back is marked `custom`.
   */
  constructor(key: string = CUSTOM_KEY, kv: KeyValueStore = new IndexedDbKeyValueStore()) {
    this.items = new JsonListStore(
      key,
      isMaterial,
      (m) => materialId(m.name, m.type),
      kv,
      (m) => ({
        ...m,
        custom: true,
      }),
    );
  }

  list(): Promise<Material[]> {
    return this.items.list();
  }

  add(material: Material): Promise<void> {
    return this.items.upsert([{ ...material, custom: true }]);
  }

  remove(name: string, type: MaterialType): Promise<void> {
    return this.items.remove(materialId(name, type));
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
