import type { KeyValueStore } from './keyValueStore';
import { IndexedDbKeyValueStore } from './idbKeyValueStore';
import { uuid } from './uuid';

/**
 * Swappable client-side store for the user's saved LAUNCH PADS.
 *
 * A location is the place you fly from: a name, and the three site fields the
 * launch panel otherwise makes you retype every time — latitude, longitude and
 * elevation. Those three drive the atmosphere model, gravity, Coriolis and the
 * origin of every KML/GPX export, so getting them right matters and typing them
 * from memory at a field is how they go wrong.
 *
 * Deliberately the same shape as `materialStore.ts` and `templateStore.ts`: a
 * typed DOMAIN store over a `KeyValueStore` (IndexedDB by default), with the
 * seam left in place (`setLaunchLocationStore`) for a bespoke backend. No server is
 * needed or wanted — this is local data like your custom motors and materials.
 *
 * What it deliberately does NOT hold: the rod, the wind, the atmosphere. Those
 * are conditions on the DAY, not properties of the field, and a location that
 * restored last month's wind would be actively misleading.
 */

export interface LaunchLocation {
  /** Stable id, minted on save. Names can be edited and repeated; ids cannot. */
  id: string;
  name: string;
  latitudeDeg: number;
  longitudeDeg: number;
  /** Site elevation above sea level, in meters (SI, like everything stored). */
  launchAltitudeM: number;
}

export interface LaunchLocationStore {
  /** Saved locations, most recently saved first. */
  list(): Promise<LaunchLocation[]>;
  /** Add, or replace the location with the same id. */
  save(location: LaunchLocation): Promise<void>;
  remove(id: string): Promise<void>;
}

/**
 * The stored key still says `pads`, and has to.
 *
 * The feature was renamed from "launch pads" to "launch locations"; the KEY is
 * what somebody's browser already has their fields saved under, and renaming it
 * would leave that entry behind with nothing reading it - a list that silently
 * came back empty, which is exactly the failure this store exists to prevent.
 */
const LOCATIONS_KEY = 'astrarrocketjs:pads:custom';

/** A location whose numbers are inside the ranges the launch fields themselves enforce. */
function isLocation(v: unknown): v is LaunchLocation {
  const p = v as LaunchLocation;
  const num = (x: unknown, lo: number, hi: number): boolean =>
    typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
  return (
    !!p &&
    typeof p.id === 'string' &&
    p.id !== '' &&
    typeof p.name === 'string' &&
    num(p.latitudeDeg, -90, 90) &&
    num(p.longitudeDeg, -180, 180) &&
    // The same floor and ceiling `LaunchPanel` clamps the altitude field to:
    // the Dead Sea shore to above any launch site.
    num(p.launchAltitudeM, -500, 10000)
  );
}

/** Default store: the location list as one key-value entry, through a KeyValueStore. */
export class KeyValueLaunchLocationStore implements LaunchLocationStore {
  constructor(
    private readonly key: string = LOCATIONS_KEY,
    private readonly kv: KeyValueStore = new IndexedDbKeyValueStore(),
  ) {}

  /** The stored list, tolerating an absent, corrupt or partly invalid blob. */
  private static parse(raw: string | null): LaunchLocation[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter(isLocation) : [];
    } catch {
      return []; // corrupt entry
    }
  }

  /**
   * Read, transform and write in ONE store transaction, and propagate a refused
   * write rather than resolving cleanly over it — the same reasoning as
   * `KeyValueMaterialStore.mutate`: this is an installable PWA with IndexedDB
   * shared across tabs, and a caller told nothing cannot retry.
   */
  private async mutate(fn: (list: LaunchLocation[]) => LaunchLocation[]): Promise<void> {
    const ok = await this.kv.update(this.key, (raw) => JSON.stringify(fn(KeyValueLaunchLocationStore.parse(raw))));
    if (!ok) throw new Error('storage-full');
  }

  async list(): Promise<LaunchLocation[]> {
    return KeyValueLaunchLocationStore.parse(await this.kv.get(this.key));
  }

  async save(location: LaunchLocation): Promise<void> {
    if (!isLocation(location)) throw new Error('invalid-location');
    await this.mutate((list) => [location, ...list.filter((p) => p.id !== location.id)]);
  }

  async remove(id: string): Promise<void> {
    await this.mutate((list) => list.filter((p) => p.id !== id));
  }
}

let store: LaunchLocationStore = new KeyValueLaunchLocationStore();

export function getLaunchLocationStore(): LaunchLocationStore {
  return store;
}

export function setLaunchLocationStore(next: LaunchLocationStore): void {
  store = next;
}

/** A new location from the launch fields currently on screen. */
export function locationFrom(
  name: string,
  site: { latitudeDeg: number | null; longitudeDeg: number | null; launchAltitudeM: number | null },
): LaunchLocation {
  return {
    id: uuid(),
    name: name.trim(),
    // The zeroes are a last resort, not a default: both coordinates are
    // required launch fields and the save button is disabled while either is
    // blank, so a location at 0,0 is not reachable from the panel. A `LaunchLocation` has to
    // be a complete place, hence a number rather than a hole.
    latitudeDeg: site.latitudeDeg ?? 0,
    longitudeDeg: site.longitudeDeg ?? 0,
    launchAltitudeM: site.launchAltitudeM ?? 0,
  };
}
