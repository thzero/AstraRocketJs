// Swappable client-side store for MOTOR data — the catalog mirror (motorDb.ts)
// and the per-motor thrustcurve caches (thrustcurve.ts). Like MaterialStore this
// is a typed DOMAIN store: it owns the persistence POLICY (catalog signature
// check, per-entry TTL / freshness), so an implementer of `MotorStore` can use a
// completely different caching strategy — a backend that does its own
// expiry, IndexedDB, etc. The default persists through a KeyValueStore.
//
// Replace it on the client, independently of the material store:
//   setMotorStore(new MyMotorStore())
import type { KeyValueStore } from './keyValueStore';
import { IndexedDbKeyValueStore } from './idbKeyValueStore';

/** A cached value plus whether it is past its freshness window. */
export interface CachedEntry<T> {
  value: T;
  stale: boolean;
}

/**
 * A user-imported motor (from a `.eng` file). Unlike a catalog motor — specs
 * only, curve fetched from thrustcurve on demand — a custom motor carries its
 * OWN thrust curve, so it resolves to a MotorSpec entirely from local data with
 * no network. It is user content: created by import, listed in the picker, and
 * removable.
 */
export interface CustomMotor {
  /** Stable local id, e.g. "custom:<manufacturer>:<designation>". */
  id: string;
  designation: string;
  manufacturer: string;
  /** Impulse class letter (derived from total impulse). */
  class: string;
  /** mm */
  diameter: number;
  /** mm */
  length: number;
  totalWeightG: number;
  propWeightG: number;
  /** Ejection delays the file lists (informational; the picker sets the delay). */
  delays?: number[];
  samples: { time: number; thrust: number }[];
  source: 'eng';
}

export interface MotorStore {
  /** A per-motor cache entry (metadata / curve / spec), validated by `valid`. */
  readEntry<T>(key: string, valid: (v: unknown) => boolean): Promise<CachedEntry<T> | null>;
  /** Write a per-motor cache entry, stamped now for freshness (best-effort). */
  writeEntry<T>(key: string, value: T): Promise<void>;
  /** The user's imported (custom) motors. */
  listCustomMotors(): Promise<CustomMotor[]>;
  /** Add or replace (by id) an imported motor. */
  addCustomMotor(motor: CustomMotor): Promise<void>;
  /** Remove an imported motor by id. */
  removeCustomMotor(id: string): Promise<void>;
}

const CUSTOM_MOTORS_KEY = 'astrarrocketjs:motors:custom';
const DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

/** An entry stamped with its fetch time, for TTL freshness. */
interface Envelope<T> {
  t: number;
  v: T;
}

function isCustomMotor(v: unknown): v is CustomMotor {
  const m = v as CustomMotor;
  return (
    !!m &&
    typeof m.id === 'string' &&
    typeof m.designation === 'string' &&
    typeof m.diameter === 'number' &&
    typeof m.length === 'number' &&
    typeof m.totalWeightG === 'number' &&
    typeof m.propWeightG === 'number' &&
    Array.isArray(m.samples) &&
    m.samples.length > 0
  );
}

/**
 * Default MotorStore: persists through a KeyValueStore (IndexedDB by
 * default), applying a fixed-TTL freshness policy to per-motor entries and a
 * signature guard to the catalog mirror. Pass a different KeyValueStore to move
 * the bytes elsewhere, or a different `ttlMs` to tune revalidation.
 */
export class KeyValueMotorStore implements MotorStore {
  constructor(
    private readonly kv: KeyValueStore = new IndexedDbKeyValueStore(),
    private readonly ttlMs: number = DEFAULT_TTL_MS,
  ) {}

  async readEntry<T>(key: string, valid: (v: unknown) => boolean): Promise<CachedEntry<T> | null> {
    try {
      const raw = await this.kv.get(key);
      if (!raw) return null;
      const env = JSON.parse(raw) as Envelope<T>;
      if (typeof env?.t !== 'number' || !valid(env.v)) {
        await this.kv.remove(key);
        return null;
      }
      return { value: env.v, stale: Date.now() - env.t > this.ttlMs };
    } catch {
      return null; // storage unavailable / parse error
    }
  }

  async writeEntry<T>(key: string, value: T): Promise<void> {
    try {
      await this.kv.set(key, JSON.stringify({ t: Date.now(), v: value } satisfies Envelope<T>));
    } catch {
      // cache writes are best-effort — a failure just means the next use refetches
    }
  }

  private async readCustom(): Promise<CustomMotor[]> {
    try {
      const raw = await this.kv.get(CUSTOM_MOTORS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter(isCustomMotor) : [];
    } catch {
      return [];
    }
  }

  async listCustomMotors(): Promise<CustomMotor[]> {
    return this.readCustom();
  }

  // add/remove propagate write failures (an import must be known to have saved),
  // unlike the best-effort cache writes above. `kv.set` REPORTS failure by
  // returning false rather than throwing, so the boolean has to be checked —
  // discarding it meant MotorDialog awaited the import, got a clean resolve, and
  // re-rendered a catalog that simply did not contain the motor, with no error.
  async addCustomMotor(motor: CustomMotor): Promise<void> {
    const rest = (await this.readCustom()).filter((m) => m.id !== motor.id);
    if (!(await this.kv.set(CUSTOM_MOTORS_KEY, JSON.stringify([motor, ...rest])))) {
      throw new Error('storage-full');
    }
  }

  async removeCustomMotor(id: string): Promise<void> {
    const rest = (await this.readCustom()).filter((m) => m.id !== id);
    if (!(await this.kv.set(CUSTOM_MOTORS_KEY, JSON.stringify(rest)))) {
      throw new Error('storage-full');
    }
  }
}

const store: MotorStore = new KeyValueMotorStore();

export function getMotorStore(): MotorStore {
  return store;
}
