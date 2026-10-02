// Swappable client-side store for the user's SAVED PARTS: a component they
// built in the editor and want back in the "Select part…" picker on every
// other design. The browser equivalent of OpenRocket's desktop user preset
// files, and the fourth of the same shape as the motor, material and template
// stores: a typed DOMAIN store (list/add/remove) whose default implementation
// persists through a KeyValueStore (IndexedDB by default). Swap
// setPresetStore(...) for a bespoke backend (a shared team library, say),
// independently of the others.
//
// A saved part holds the WHOLE node, not the handful of dimensions a catalog
// row publishes, so a nose cone's shoulder, a parachute's lines, a tube's
// motor-mount flag and the part's color all come back when it is applied.
// customParts.ts projects one down to a picker row; treeEdit.catalogPatch
// applies it.
import type { ComponentNode } from '../../engine/openRocketEngine';
import type { KeyValueStore } from '../storage/keyValueStore';
import { IndexedDbKeyValueStore } from '../storage/idbKeyValueStore';
import { nsKey } from '../storage/storageKeys';

/** A component the user saved for reuse. */
export interface CustomPart {
  /** Stable local id, `custom:<type>:<mfr>:<partNo>` (see customParts.save). */
  id: string;
  /**
   * The CATALOG type it is listed under, which is not always the node's own:
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
  /** Everything the part IS: the saved node bar its identity and placement. */
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
 * `node` is checked only for being a plain object: what it has to CONTAIN is a
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
 * Default PresetStore: serializes the saved-part list to a single key-value
 * entry through a KeyValueStore (IndexedDB by default).
 */
export class KeyValuePresetStore implements PresetStore {
  constructor(
    private readonly key: string = CUSTOM_KEY,
    private readonly kv: KeyValueStore = new IndexedDbKeyValueStore(),
  ) {}

  /** The stored list, tolerating an absent, corrupt or partly invalid blob. */
  private static parse(raw: string | null): CustomPart[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter(isCustomPart) : [];
    } catch {
      return []; // corrupt entry
    }
  }

  /**
   * Read, transform and write in ONE store transaction, and propagate a
   * refused write the way `motorStore.addCustomMotor` does.
   *
   * `kv.update` reports failure by RETURNING false rather than throwing, so
   * discarding it would mean the dialog awaits the save, gets a clean resolve,
   * and closes over a library that does not contain the part, with no error
   * anywhere.
   *
   * `update`, not read-then-set: IndexedDB is shared across the tabs of this
   * installable PWA, and a get/set with an await between them lets two tabs
   * each drop the other's part (see `DesignLibrary.mutateIndex`).
   */
  private async mutate(fn: (list: CustomPart[]) => CustomPart[]): Promise<void> {
    const ok = await this.kv.update(this.key, (raw) => JSON.stringify(fn(KeyValuePresetStore.parse(raw))));
    if (!ok) throw new Error('storage-full');
  }

  /**
   * Guarded, unlike the template store's: this list is read every time the
   * component picker opens, beside the catalog fetch, and a storage layer that
   * REJECTS (rather than returning null) would take the whole picker down over
   * a feature the user may never have used.
   */
  async list(): Promise<CustomPart[]> {
    try {
      return KeyValuePresetStore.parse(await this.kv.get(this.key));
    } catch {
      return [];
    }
  }

  async add(part: CustomPart): Promise<void> {
    await this.mutate((list) => [part, ...list.filter((p) => p.id !== part.id)]);
  }

  async remove(id: string): Promise<void> {
    await this.mutate((list) => list.filter((p) => p.id !== id));
  }
}

// The active preset store. Usually you don't swap THIS: swap the underlying
// KeyValueStore instead. The seam is the one the other three stores have.
let store: PresetStore = new KeyValuePresetStore();

export function getPresetStore(): PresetStore {
  return store;
}

export function setPresetStore(next: PresetStore): void {
  store = next;
}
