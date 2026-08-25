import type { MotorSpec } from '../engine/openRocketEngine';
import type { CatalogMotor } from './motorDb';
import { getMotorStore } from './motorStore';

/**
 * thrustcurve.org API v1 client (CORS-enabled; verified reflective
 * Access-Control-Allow-Origin). The VC catalog gives us only specs — no
 * motorId, length or propellant weight — so at pick time we resolve the full
 * motor via search.json, then pull its thrust CURVE via download.json. API
 * units are mm / grams; converted to the engine's SI at the boundary here.
 *
 * "Store both in local": the catalog lives in localStorage (motorDb.ts) and the
 * resolved MotorSpec (metadata + curve) is cached here, so a picked motor is
 * fully available offline after the first fetch.
 */
const API = 'https://www.thrustcurve.org/api/v1';

/** The thrustcurve fields we need beyond the VC catalog to build a MotorSpec. */
interface TcMotor {
  motorId: string;
  designation: string;
  commonName: string;
  manufacturerAbbrev: string;
  /** mm */
  diameter: number;
  /** mm */
  length: number;
  totalWeightG: number;
  propWeightG: number;
  availability: string;
}

interface TcSample {
  time: number;
  thrust: number;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`thrustcurve.org ${path} → HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * Pure transform: thrust samples + catalog metadata → engine MotorSpec.
 * Mass at each sample time interpolates from total weight down to burnout
 * weight proportionally to CUMULATIVE IMPULSE (trapezoidal), matching how
 * OpenRocket treats .eng files. CG is fixed at half the motor length (the
 * same approximation OpenRocket applies to RASP data without CG info).
 */
export function samplesToMotorSpec(
  motor: TcMotor,
  samples: TcSample[],
  ejectionDelay: number,
): MotorSpec {
  // Normalize: sorted, starting at t=0.
  const pts = [...samples].sort((a, b) => a.time - b.time);
  if (pts.length === 0) {
    throw new Error(`No thrust samples for ${motor.designation}`);
  }
  if (pts[0]!.time > 0) {
    pts.unshift({ time: 0, thrust: 0 });
  }

  // thrustcurve.org's catalog is not uniformly populated: some entries publish
  // no loaded/propellant weight, and a few list more propellant than loaded
  // mass. Without this guard those become NaN / negative masses that reach the
  // kernel, where TeaVM throws a raw "cannot be converted to a BigInt" and the
  // whole design blanks. Refuse with something a rocketeer can act on.
  if (!Number.isFinite(motor.totalWeightG) || !Number.isFinite(motor.propWeightG)) {
    throw new Error(
      `thrustcurve.org publishes no loaded/propellant weight for ${motor.designation}, ` +
        'so it cannot be simulated. Pick another motor.',
    );
  }
  if (motor.propWeightG > motor.totalWeightG) {
    throw new Error(
      `${motor.designation} is catalogued with more propellant (${motor.propWeightG} g) than ` +
        `loaded mass (${motor.totalWeightG} g), so its burn would end at a negative mass. ` +
        'Pick another motor.',
    );
  }

  const totalMass = motor.totalWeightG / 1000;
  const propMass = motor.propWeightG / 1000;

  // Cumulative impulse via trapezoid rule.
  const cumImpulse: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const dt = pts[i]!.time - pts[i - 1]!.time;
    const area = (dt * (pts[i]!.thrust + pts[i - 1]!.thrust)) / 2;
    cumImpulse.push(cumImpulse[i - 1]! + area);
  }
  const totImpulse = cumImpulse[cumImpulse.length - 1]!;

  const times = pts.map((p) => p.time);
  const thrusts = pts.map((p) => p.thrust);
  const masses = cumImpulse.map((impulse) =>
    totImpulse > 0 ? totalMass - propMass * (impulse / totImpulse) : totalMass,
  );

  return {
    designation: motor.designation,
    diameter: motor.diameter / 1000,
    length: motor.length / 1000,
    times,
    thrusts,
    masses,
    cgX: motor.length / 2000,
    ejectionDelay,
  };
}

/**
 * Resolves a VC catalog row to the full thrustcurve record (motorId, length,
 * propellant weight) — the fields the catalog omits. Searches by common name
 * first (the catalog stores commonName||designation), then designation, and
 * disambiguates by diameter and in-production status.
 */
async function resolveTcMotor(cat: CatalogMotor): Promise<TcMotor> {
  const pick = (list: TcMotor[]): TcMotor | undefined => {
    if (list.length === 0) return undefined;
    return [...list].sort((a, b) =>
      Math.abs(a.diameter - cat.diameter) - Math.abs(b.diameter - cat.diameter) ||
      Number(b.availability === 'regular') - Number(a.availability === 'regular'))[0];
  };

  for (const query of [{ commonName: cat.designation }, { designation: cat.designation }]) {
    const { results = [] } = await post<{ results?: TcMotor[] }>('search.json', {
      manufacturer: cat.manufacturer,
      ...query,
      maxResults: 25,
    });
    const hit = pick(results);
    if (hit) return hit;
  }
  throw new Error(`Could not find ${cat.manufacturer} ${cat.designation} on thrustcurve.org`);
}

// Per-motor entries (curve, metadata, resolved spec) revalidate on the
// MotorStore's TTL (see below). CACHE_VERSION is the separate GLOBAL reset:
// bump it to invalidate every per-motor entry at once (e.g. if this pipeline's
// math or shapes change), since it namespaces every key. Catalog updates are a
// separate, build-time concern (see motorDb.ts / scripts/sync-motors.mjs).
const CACHE_VERSION = 'v1';
const SPEC_PREFIX = `tc:${CACHE_VERSION}:motor:`;
const SAMPLE_PREFIX = `tc:${CACHE_VERSION}:samples:`;
const META_PREFIX = `tc:${CACHE_VERSION}:meta:`;

/** Stable localStorage key for a picked motor + delay. */
function specKey(cat: CatalogMotor, ejectionDelay: number): string {
  return `${SPEC_PREFIX}${cat.manufacturer}:${cat.designation}:${ejectionDelay}`;
}

/** Delay-independent key for a motor's resolved thrustcurve metadata. */
function metaKey(cat: CatalogMotor): string {
  return `${META_PREFIX}${cat.manufacturer}:${cat.designation}`;
}

// thrustcurve's sample FILES are not immutable — contributors revise/replace
// them over time — so the per-motor entries revalidate lazily: the MotorStore
// reports each entry's staleness (its TTL/freshness policy), and we re-fetch
// only for a motor the user picks AGAIN once its entry has aged out. Falling
// back to the stale value keeps a failed refresh (offline / API down) working.
const isSampleArray = (v: unknown): boolean =>
  Array.isArray(v) && v.length > 0
  && v.every((s) => typeof (s as TcSample)?.time === 'number'
    && typeof (s as TcSample)?.thrust === 'number');

const isSpec = (v: unknown): boolean => {
  const s = v as MotorSpec;
  return !!(s?.times?.length && s?.thrusts?.length && s?.masses?.length);
};

/**
 * The resolved thrustcurve record (motorId, dimensions, weights) for a catalog
 * motor. Cached by a delay-independent key; refreshed lazily once past the TTL,
 * and falling back to the stale copy if thrustcurve is unreachable.
 */
async function resolveTcMotorCached(cat: CatalogMotor): Promise<TcMotor> {
  const key = metaKey(cat);
  const cached = await getMotorStore().readEntry<TcMotor>(key, (m) => !!(m as TcMotor)?.motorId);
  if (cached && !cached.stale) return cached.value;
  try {
    const motor = await resolveTcMotor(cat);
    await getMotorStore().writeEntry(key, motor);
    return motor;
  } catch (e) {
    if (cached) return cached.value; // stale-but-usable beats failing
    throw e;
  }
}

/**
 * The thrust curve for a motor. TTL-cached; revalidates lazily the next time
 * the motor is picked past the TTL, and falls back to the stale curve if the
 * refresh fails (offline / API down).
 */
async function fetchSamplesCached(motor: TcMotor, cat: CatalogMotor): Promise<TcSample[]> {
  const key = SAMPLE_PREFIX + motor.motorId;
  const cached = await getMotorStore().readEntry<TcSample[]>(key, isSampleArray);
  if (cached && !cached.stale) return cached.value;
  try {
    const body = await post<{ results?: { format: string; samples?: TcSample[] }[] }>(
      'download.json',
      { motorIds: [motor.motorId], data: 'samples' },
    );
    const files = body.results ?? [];
    // Prefer RASP data, fall back to any file with samples.
    const file = files.find((f) => f.format === 'RASP' && f.samples?.length)
      ?? files.find((f) => f.samples?.length);
    if (!file?.samples) {
      if (cached) return cached.value;
      throw new Error(`No thrust-curve data available for ${cat.designation}`);
    }
    await getMotorStore().writeEntry(key, file.samples);
    return file.samples;
  } catch (e) {
    if (cached) return cached.value; // offline / API down — use the stale curve
    throw e;
  }
}

/**
 * Builds the full MotorSpec for a catalog motor: resolve metadata, fetch the
 * thrust curve, interpolate masses. Every layer is TTL-cached in localStorage
 * (spec by motor+delay, metadata and curve by motor) so a repeat pick is
 * offline and instant, while a stale curve refreshes on its next use.
 */
export async function fetchMotorSpec(cat: CatalogMotor, ejectionDelay: number): Promise<MotorSpec> {
  // Imported (.eng) motors carry their own curve — build the spec from local
  // data, no thrustcurve lookup.
  if (cat.custom && cat.id) {
    const id = cat.id;
    const cm = (await getMotorStore().listCustomMotors()).find((m) => m.id === id);
    if (!cm) {
      throw new Error(`Imported motor ${cat.designation} is no longer stored — re-import its .eng file.`);
    }
    return samplesToMotorSpec(
      {
        motorId: cm.id, designation: cm.designation, commonName: cm.designation,
        manufacturerAbbrev: cm.manufacturer, diameter: cm.diameter, length: cm.length,
        totalWeightG: cm.totalWeightG, propWeightG: cm.propWeightG, availability: 'custom',
      },
      cm.samples, ejectionDelay,
    );
  }

  const key = specKey(cat, ejectionDelay);
  const cached = await getMotorStore().readEntry<MotorSpec>(key, isSpec);
  if (cached && !cached.stale) return cached.value;
  try {
    const motor = await resolveTcMotorCached(cat);
    const samples = await fetchSamplesCached(motor, cat);
    const spec = samplesToMotorSpec(motor, samples, ejectionDelay);
    await getMotorStore().writeEntry(key, spec);
    return spec;
  } catch (e) {
    if (cached) return cached.value; // stale spec fallback
    throw e;
  }
}
