import type { KeyValueStore } from './keyValueStore';
import { IndexedDbKeyValueStore } from './idbKeyValueStore';
import { JsonListStore } from './jsonListStore';
import { uuid } from '../app/uuid';
import { nsKey } from './storageKeys';

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
const LOCATIONS_KEY = nsKey('pads:custom');

/**
 * The ranges a launch site's numbers must fall in. The launch fields clamp to
 * them and a stored location is validated against them, so a location saved from
 * the fields always reads back.
 *
 * Latitude past +/-90 is rejected outright by Google Earth in the KML export, and
 * all three reach the kernel (gravity, Coriolis, the atmosphere model). Altitude
 * runs from the Dead Sea shore to above any launch site.
 */
export const LAUNCH_SITE_LIMITS = {
  latitudeDeg: { min: -90, max: 90 },
  longitudeDeg: { min: -180, max: 180 },
  launchAltitudeM: { min: -500, max: 10000 },
  /** Air temperature at the site, °C: the launch panel's and the tools' bounds. */
  temperatureC: { min: -90, max: 70 },
} as const;

/** A location whose numbers are inside {@link LAUNCH_SITE_LIMITS}. */
function isLocation(v: unknown): v is LaunchLocation {
  const p = v as LaunchLocation;
  const num = (x: unknown, { min, max }: { min: number; max: number }): boolean =>
    typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;
  return (
    !!p &&
    typeof p.id === 'string' &&
    p.id !== '' &&
    typeof p.name === 'string' &&
    num(p.latitudeDeg, LAUNCH_SITE_LIMITS.latitudeDeg) &&
    num(p.longitudeDeg, LAUNCH_SITE_LIMITS.longitudeDeg) &&
    num(p.launchAltitudeM, LAUNCH_SITE_LIMITS.launchAltitudeM)
  );
}

/**
 * Default store: the location list as one JSON array under one key-value entry
 * (see JsonListStore for the read and write rules), newest save first, one
 * entry per id. A location outside {@link LAUNCH_SITE_LIMITS} is refused on
 * save, not stored to be dropped on the next read.
 */
export class KeyValueLaunchLocationStore implements LaunchLocationStore {
  private readonly items: JsonListStore<LaunchLocation>;

  constructor(key: string = LOCATIONS_KEY, kv: KeyValueStore = new IndexedDbKeyValueStore()) {
    this.items = new JsonListStore(key, isLocation, (p) => p.id, kv);
  }

  list(): Promise<LaunchLocation[]> {
    return this.items.list();
  }

  async save(location: LaunchLocation): Promise<void> {
    if (!isLocation(location)) throw new Error('invalid-location');
    await this.items.upsert([location]);
  }

  remove(id: string): Promise<void> {
    return this.items.remove(id);
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
