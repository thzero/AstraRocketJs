// Swappable client-side store for motor data: the user's imported (custom)
// motors and the per-motor thrustcurve caches (thrustcurve.ts). Like
// MaterialStore this is a typed domain store: it owns the persistence policy
// (per-entry TTL / freshness), so an implementer of `MotorStore` can use a
// completely different caching strategy (a backend that does its own
// expiry, IndexedDB, etc.). The default persists through a KeyValueStore.
//
// Replace it on the client, independently of the material store:
//   setMotorStore(new MyMotorStore())
import type { KeyValueStore } from '../storage/keyValueStore';
import { IndexedDbKeyValueStore } from '../storage/idbKeyValueStore';
import { JsonListStore } from '../storage/jsonListStore';
import { MIN_CURVE_SAMPLES } from './motorCurve';
import { nsKey } from '../storage/storageKeys';

/** A cached value plus whether it is past its freshness window. */
export interface CachedEntry<T> {
  value: T;
  stale: boolean;
}

/**
 * A user-imported motor (from a `.eng` or `.rse` file). Unlike a catalog motor
 * (specs only, curve fetched from thrustcurve on demand), a custom motor
 * carries its own thrust curve, so it resolves to a MotorSpec entirely from
 * local data with no network. It is user content: created by import, listed in
 * the picker, and removable.
 *
 * The `type`, `massesG` and `cgMm` fields are what `.rse` carries and RASP
 * `.eng` cannot. They are optional, so an `.eng` motor without them still
 * validates and resolves.
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
  samples: { time: number; thrust: number }[];
  /**
   * The delays the file lists, as the catalog spells them ("4,6,10,P").
   *
   * A string, because it is the only form that can say "plugged" and it is what
   * `motorPicker.parseDelays` and `offersPlugged` read, and what `customToRow`
   * puts in the row's delay column. Both importers fill it through
   * `motorPicker.delayList`; there is no second, numeric form, because a
   * number array has nowhere to put plugged and nothing ever read one.
   */
  delayList?: string;
  /** What the file says the motor is. A hybrid is why `.rse` import exists. */
  type?: 'SU' | 'reload' | 'hybrid';
  /**
   * Mass at each sample, in grams, parallel to `samples`.
   *
   * The real reason `.rse` is the richer format: with this the kernel flies the
   * measured mass curve, instead of one reconstructed from total impulse and a
   * single header number (`thrustcurve.samplesToMotorSpec`, which is the path
   * for every motor without it).
   */
  massesG?: number[];
  /** Launch CG, mm from the motor's forward end. Absent → half the length. */
  cgMm?: number;
  source: 'eng' | 'rse';
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
  /**
   * Add or replace a whole batch in one write.
   *
   * A `.rse` engine database holds a manufacturer's entire range. Importing one
   * motor at a time would mean one read-modify-write per motor, each parsing and
   * re-serializing the whole stored array: quadratic in the import, and a failure
   * part way through would leave some motors stored, some not, and an error that
   * could not say which. One write is linear and all-or-nothing.
   */
  addCustomMotors(motors: readonly CustomMotor[]): Promise<void>;
  /** Remove an imported motor by id. */
  removeCustomMotor(id: string): Promise<void>;
}

const CUSTOM_MOTORS_KEY = nsKey('motors:custom');
const DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

/** An entry stamped with its fetch time, for TTL freshness. */
interface Envelope<T> {
  t: number;
  v: T;
}

/**
 * A thrust curve of at least {@link MIN_CURVE_SAMPLES} samples, every one a
 * finite `{time, thrust}`.
 *
 * Shared with thrustcurve.ts. Custom motors are the one store whose payload
 * reaches `simulate()` without a second gate, so each element's shape is checked:
 * `samples: [{}]` out of a corrupted IndexedDB blob would become
 * `times: [undefined]` and NaN masses inside the kernel. `Number.isFinite`, not
 * `typeof === 'number'`: NaN and Infinity are both numbers and neither survives
 * the TeaVM boundary. The sample count is the builder's threshold
 * (motorCurve.ts), so a single sample, which the kernel refuses as "too short",
 * is rejected here.
 */
export const isThrustSampleArray = (v: unknown): boolean =>
  Array.isArray(v) &&
  v.length >= MIN_CURVE_SAMPLES &&
  v.every((s) => {
    const p = s as { time?: unknown; thrust?: unknown } | null;
    return !!p && Number.isFinite(p.time) && Number.isFinite(p.thrust);
  });

function isCustomMotor(v: unknown): v is CustomMotor {
  const m = v as CustomMotor;
  return (
    !!m &&
    typeof m.id === 'string' &&
    typeof m.designation === 'string' &&
    // motorDb.ts sorts on `class` and `manufacturer` with localeCompare, so a
    // row missing either takes down the whole motor picker, not just its own entry.
    typeof m.manufacturer === 'string' &&
    typeof m.class === 'string' &&
    Number.isFinite(m.diameter) &&
    Number.isFinite(m.length) &&
    Number.isFinite(m.totalWeightG) &&
    Number.isFinite(m.propWeightG) &&
    isThrustSampleArray(m.samples) &&
    isMassArray(m.massesG, m.samples.length) &&
    (m.cgMm === undefined || Number.isFinite(m.cgMm))
  );
}

/**
 * The per-sample mass column of a `.rse` motor: absent, or one finite
 * non-negative gram figure per sample.
 *
 * Checked as hard as `samples` is, and for the same reason: this array reaches
 * the kernel as the flown mass curve. A short one would leave `masses` and
 * `times` different lengths across the TeaVM boundary, and a NaN in it is the
 * blank-design failure `samplesToMotorSpec` already documents.
 */
const isMassArray = (v: unknown, samples: number): boolean =>
  v === undefined || (Array.isArray(v) && v.length === samples && v.every((x) => Number.isFinite(x) && x >= 0));

/**
 * Default MotorStore: persists through a KeyValueStore (IndexedDB by
 * default), applying a fixed-TTL freshness policy to per-motor entries. Pass a
 * different KeyValueStore to move the bytes elsewhere, or a different `ttlMs` to
 * tune revalidation.
 */
export class KeyValueMotorStore implements MotorStore {
  /** The imported motors: newest import first, one entry per id. */
  private readonly custom: JsonListStore<CustomMotor>;

  constructor(
    private readonly kv: KeyValueStore = new IndexedDbKeyValueStore(),
    private readonly ttlMs: number = DEFAULT_TTL_MS,
  ) {
    this.custom = new JsonListStore(CUSTOM_MOTORS_KEY, isCustomMotor, (m) => m.id, kv);
  }

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
      // cache writes are best-effort: a failure just means the next use refetches
    }
  }

  // add/remove propagate write failures (an import must be known to have saved),
  // unlike the best-effort cache writes above; see JsonListStore.
  listCustomMotors(): Promise<CustomMotor[]> {
    return this.custom.list();
  }

  addCustomMotor(motor: CustomMotor): Promise<void> {
    return this.addCustomMotors([motor]);
  }

  async addCustomMotors(motors: readonly CustomMotor[]): Promise<void> {
    if (motors.length === 0) return;
    // Last-id-wins within the batch, and the batch lands reversed, so the last
    // motor of an import heads the list the way it would after single adds.
    const byId = new Map(motors.map((m) => [m.id, m]));
    await this.custom.upsert([...byId.values()].reverse());
  }

  removeCustomMotor(id: string): Promise<void> {
    return this.custom.remove(id);
  }
}

// The active motor store, replaceable through `setMotorStore` the same way the
// material store is.
let store: MotorStore = new KeyValueMotorStore();

export function getMotorStore(): MotorStore {
  return store;
}

export function setMotorStore(next: MotorStore): void {
  store = next;
}
