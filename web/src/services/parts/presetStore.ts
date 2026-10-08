// Swappable client-side store for the user's saved parts: a component they
// built in the editor and want back in the "Select part…" picker on every
// other design. The browser equivalent of OpenRocket's desktop user preset
// files, and the same shape as the motor, material and template
// stores: a typed domain store (list/add/remove) whose default implementation
// persists through a KeyValueStore (IndexedDB by default). Swap
// setPresetStore(...) for a bespoke backend (a shared team library, say),
// independently of the others.
//
// A saved part holds the whole node, not the handful of dimensions a catalog
// row publishes, so a nose cone's shoulder, a parachute's lines, a tube's
// motor-mount flag and the part's color all come back when it is applied.
// customParts.ts projects one down to a picker row; treeEdit.catalogPatch
// applies it.
import type { ComponentNode } from '../../engine/openRocketEngine';
import type { KeyValueStore } from '../storage/keyValueStore';
import { IndexedDbKeyValueStore } from '../storage/idbKeyValueStore';
import { JsonListStore } from '../storage/jsonListStore';
import { nsKey } from '../storage/storageKeys';

/** A component the user saved for reuse. */
export interface CustomPart {
  /** Stable, opaque local id that survives a rename (see customParts.saveCustomPart). */
  id: string;
  /**
   * The catalog type it is listed under, which is not always the node's own:
   * an inner tube saves as a body tube, the same way the picker serves it from
   * the body tube rows (componentDb.catalogTypeFor).
   */
  type: string;
  /** Who made it. The user's own name for their parts, usually. */
  mfr: string;
  /** What they call it. Doubles as the identity: saving it again replaces it. */
  partNo: string;
  /** Free text, shown in the picker's Notes column. */
  desc: string;
  /** Everything the part is: the saved node bar its identity and placement. */
  node: Partial<ComponentNode>;
}

export interface PresetStore {
  /** All saved parts (implementation decides ordering). */
  list(): Promise<CustomPart[]>;
  /** Add or replace (by id) a saved part. */
  add(part: CustomPart): Promise<void>;
  /** Remove a saved part by id. */
  remove(id: string): Promise<void>;
}

const CUSTOM_KEY = nsKey('parts:custom');

/**
 * One stored row this build can use.
 *
 * `node` is checked only for being a plain object: what it has to contain is a
 * question about the part's type, and customParts.customPartToRow asks it (per
 * type, the way componentDb.isComponentRow does for a catalog row) before the
 * row reaches the picker. A part that fails there costs that part, not the
 * picker, so it is dropped at projection rather than refused here.
 */
function isCustomPart(v: unknown): v is CustomPart {
  const p = v as CustomPart;
  return (
    !!p &&
    typeof p.id === 'string' &&
    typeof p.type === 'string' &&
    typeof p.mfr === 'string' &&
    typeof p.partNo === 'string' &&
    typeof p.desc === 'string' &&
    !!p.node &&
    typeof p.node === 'object' &&
    !Array.isArray(p.node)
  );
}

/**
 * Default PresetStore: the saved-part list as one JSON array under one
 * key-value entry (see JsonListStore for the read and write rules), newest
 * save first, one entry per id.
 */
export class KeyValuePresetStore implements PresetStore {
  private readonly items: JsonListStore<CustomPart>;

  constructor(key: string = CUSTOM_KEY, kv: KeyValueStore = new IndexedDbKeyValueStore()) {
    this.items = new JsonListStore(key, isCustomPart, (p) => p.id, kv);
  }

  list(): Promise<CustomPart[]> {
    return this.items.list();
  }

  add(part: CustomPart): Promise<void> {
    return this.items.upsert([part]);
  }

  remove(id: string): Promise<void> {
    return this.items.remove(id);
  }
}

// The active preset store. Usually you don't swap this: swap the underlying
// KeyValueStore instead. The seam is the one the other stores have.
let store: PresetStore = new KeyValuePresetStore();

export function getPresetStore(): PresetStore {
  return store;
}

export function setPresetStore(next: PresetStore): void {
  store = next;
}
