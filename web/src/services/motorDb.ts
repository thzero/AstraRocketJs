// The motor CATALOG — brought in by the VC-style build-time sync utility
// (scripts/sync-motors.mjs), which sweeps thrustcurve.org for every available,
// license-clean motor and ships the factual specs plus, where one is
// published, the bundled thrust curve (`curves`). A motor without one has its
// curve fetched on demand at pick time (see thrustcurve.ts).
//
// The catalog is a runtime file fetched through remoteData.ts and memoized for
// the session. There is NO localStorage mirror of it: a catalog-with-curves is
// too large for that budget, and the bundle is always available offline.
import { getMotorStore, type CustomMotor } from './motorStore';
import { MIN_CURVE_SAMPLES } from './motorCurve';
import { parseEng, totalImpulse } from './engParser';
import { motorFitsMount, offersPlugged, type MountFit } from './motorPicker';
import { fetchCatalog } from './remoteData';

/** One catalog row — the VC sync utility's schema, plus optional custom-motor tags. */
export interface CatalogMotor {
  /** commonName || designation (thrustcurve). */
  designation: string;
  /** manufacturerAbbrev || manufacturer. */
  manufacturer: string;
  /** Impulse class letter (A, B, … O). */
  class: string;
  /** mm (rounded). */
  diameter: number;
  /** Total impulse, Ns. */
  impulse: number;
  /** Burn time, s. */
  burn: number;
  /** Loaded mass, g. */
  mass: number;
  /** Set for user-imported motors; carries the CustomMotor id so it resolves locally. */
  custom?: boolean;
  id?: string;
  /** Bundled thrust curve (from the build-time sync) — lets the motor resolve
   *  entirely offline, no thrustcurve.org fetch. Absent → fetched on demand. */
  length?: number; // mm
  propWeightG?: number; // g
  /** Thrust curves, best-first (a motor can have several — cert/user, RASP/RockSim).
   *  Each `samples` is [time (s), thrust (N)] pairs. */
  curves?: { src: string; samples: [number, number][] }[];
  // Descriptive metadata for the detail panel (bundled by sync-motors.mjs).
  code?: string; // full manufacturer designation, e.g. "E26W"
  type?: string; // 'SU' | 'reload' | 'hybrid'
  delays?: string; // e.g. "4,6,7,8,10"
  propInfo?: string; // propellant type, e.g. "White Lightning"
  sparky?: boolean;
  avgThrust?: number; // N
  maxThrust?: number; // N
  /** Set by the sync when no thrust curve could be bundled (none published, or
   *  missing length/prop weight). Such a motor can't be plotted / combined. */
  noCurve?: boolean;
  /** CG-vs-time as [[t (s), cgFromNose (m)]], read from the motor file (RockSim)
   *  — the real CG OpenRocket uses. Launch CG = cg[0][1]. Absent → the motor
   *  build falls back to mid-length (same as OpenRocket for RASP-only data). */
  cg?: [number, number][];
}

/** Whether a catalog motor has a usable bundled thrust curve: the same sample
 *  threshold the builder seats a motor by (motorCurve.ts), applied to the
 *  catalog's `[t, F]` pairs. "Can we plot / compare / combine this offline". */
export function hasCurve(m: CatalogMotor): boolean {
  return (m.curves?.[0]?.samples?.length ?? 0) >= MIN_CURVE_SAMPLES;
}

/** Project a stored custom motor down to a catalog row for the picker. */
function customToRow(cm: CustomMotor): CatalogMotor {
  const last = cm.samples[cm.samples.length - 1];
  return {
    designation: cm.designation,
    manufacturer: cm.manufacturer,
    class: cm.class,
    diameter: cm.diameter,
    impulse: totalImpulse(cm.samples),
    burn: last ? last.time : 0,
    mass: cm.totalWeightG,
    custom: true,
    id: cm.id,
  };
}

/**
 * A catalog row this app can actually use.
 *
 * `Array.isArray` alone was the whole check, and the catalog can come from a
 * separately deployed host (VITE_DATA_BASE / the jsDelivr data branch). One
 * row missing `class` then threw inside `allClasses`' `localeCompare`, and one
 * missing `designation` threw in `filterMotors`' `toLowerCase` - taking down
 * the entire motor picker rather than that one entry. `motorStore` already
 * guards custom motors exactly this way.
 */
const isCatalogMotor = (v: unknown): v is CatalogMotor => {
  const m = v as CatalogMotor | null;
  return (
    !!m &&
    typeof m === 'object' &&
    typeof m.designation === 'string' &&
    typeof m.manufacturer === 'string' &&
    typeof m.class === 'string' &&
    Number.isFinite(m.diameter) &&
    Number.isFinite(m.impulse)
  );
};

/**
 * A usable catalog: an array with at least one usable row.
 *
 * `every` here made one malformed row reject the WHOLE catalog (and fall
 * through to the in-build copy, or to an empty picker), which is the outcome
 * row-by-row validation exists to avoid. The gate only decides whether this
 * host's copy is worth anything at all; the bad rows are dropped in
 * `loadCatalog` and the rest are kept.
 */
const isCatalog = (v: unknown): boolean => Array.isArray(v) && v.some(isCatalogMotor);

export async function loadCatalog(): Promise<CatalogMotor[]> {
  // The 700 kB+ catalog is a runtime file under public/data (see remoteData.ts),
  // fetched only when something first needs it (e.g. the motor picker opens)
  // rather than weighing down the initial app bundle — and refreshable without
  // rebuilding the app.
  const [custom, bundled] = await Promise.all([
    getMotorStore()
      .listCustomMotors()
      .then((ms) => ms.map(customToRow)),
    // Row by row: keep every usable row, drop the rest. `isCatalog` has
    // already refused a body that is not an array or has no usable row.
    fetchCatalog<unknown[]>('motors', isCatalog).then((rows) => rows.filter(isCatalogMotor)),
  ]);
  return [...custom, ...bundled];
}

/** Parse a .eng file, store it as a custom motor, and return the refreshed catalog. */
export async function importCustomMotorFromEng(text: string): Promise<CatalogMotor[]> {
  await getMotorStore().addCustomMotor(parseEng(text));
  return loadCatalog();
}

/** Remove an imported motor and return the refreshed catalog. */
export async function deleteCustomMotor(id: string): Promise<CatalogMotor[]> {
  await getMotorStore().removeCustomMotor(id);
  return loadCatalog();
}

export interface MotorFilter {
  /** Impulse class letters; empty = all. */
  classes: Set<string>;
  /** Manufacturer names; empty = all. */
  manufacturers: Set<string>;
  /** Free-text match against designation. */
  text: string;
  /** Diameter range (mm), inclusive. Undefined ends = open. Defaults fit the mount. */
  minDiameter?: number;
  maxDiameter?: number;
  /**
   * Total impulse range (N·s), inclusive. Undefined ends = open.
   *
   * Not the same question as the impulse CLASS above, which is why both exist: a
   * class is a doubling bucket, so H spans 160 to 320 N·s, and "at least 400 N·s"
   * is a number that comes out of a design rather than a letter you can pick.
   */
  minImpulse?: number;
  maxImpulse?: number;
  /** Keep only motors that go in this mount (see motorFitsMount). */
  fit?: MountFit;
  /**
   * Keep only motors the manufacturer lists as available plugged. What the spec
   * says rather than what is possible: any motor can be FLOWN plugged (see
   * offersPlugged), so this finds the ones built without an ejection charge.
   */
  plugged?: boolean;
}

export function filterMotors(catalog: CatalogMotor[], filter: MotorFilter): CatalogMotor[] {
  const text = filter.text.trim().toLowerCase();
  return catalog.filter((m) => {
    if (filter.classes.size > 0 && !filter.classes.has(m.class)) return false;
    if (filter.manufacturers.size > 0 && !filter.manufacturers.has(m.manufacturer)) return false;
    if (filter.minDiameter != null && m.diameter < filter.minDiameter) return false;
    if (filter.maxDiameter != null && m.diameter > filter.maxDiameter) return false;
    if (filter.minImpulse != null && m.impulse < filter.minImpulse) return false;
    if (filter.maxImpulse != null && m.impulse > filter.maxImpulse) return false;
    if (filter.fit && !motorFitsMount(m, filter.fit)) return false;
    if (filter.plugged && !offersPlugged(m)) return false;
    if (text && !m.designation.toLowerCase().includes(text)) return false;
    return true;
  });
}

/** Distinct impulse classes present, in canonical A→O order. */
export function allClasses(catalog: CatalogMotor[]): string[] {
  return [...new Set(catalog.map((m) => m.class))].sort((a, b) => a.localeCompare(b));
}

/** Distinct manufacturers present, alphabetical. */
export function allManufacturers(catalog: CatalogMotor[]): string[] {
  return [...new Set(catalog.map((m) => m.manufacturer))].sort((a, b) => a.localeCompare(b));
}

/**
 * Best catalog match for a designation from a .ork file (which names a motor but
 * carries no curve). A .ork stores the FULL manufacturer designation — AeroTech
 * "H128W" (propellant letter), Cesaroni "131G84-10A" (case + delay) — while our
 * catalog keys the SHORT name ("H128", "G84") and stashes the full one in `code`.
 * So we match, progressively looser, against both `designation` and `code`:
 *   1) exact designation           2) exact code (the full name)
 *   3) normalized either (ignore -/space)
 *   4) strip a trailing -VARIANT (…-OLD / …-10A) and/or a trailing propellant
 *      letter, then retry — this is what resolves "J350W-OLD" → "J350"/"J350W".
 * The requested manufacturer breaks ties within each tier (AeroTech vs Cesaroni
 * "I180"). Returns undefined if nothing matches at all.
 */
export function findCatalogMotor(
  catalog: CatalogMotor[],
  designation: string,
  manufacturer?: string,
): CatalogMotor | undefined {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[-\s]/g, '');
  const raw = designation.trim();
  const want = raw.toLowerCase();
  if (!want) return undefined;
  const code = (m: CatalogMotor) => (m.code ?? '').toLowerCase();

  // Prefer the requested manufacturer, but never let it empty a non-empty set.
  const byMfr = (cands: CatalogMotor[]): CatalogMotor[] => {
    if (!manufacturer || cands.length <= 1) return cands;
    const mf = manufacturer.trim().toLowerCase();
    const hit = cands.filter((m) => {
      const mm = m.manufacturer.toLowerCase();
      return mm === mf || mm.includes(mf) || mf.includes(mm);
    });
    return hit.length ? hit : cands;
  };

  // `H128W-OLD` → base `H128W` (drop one trailing -/_ suffix) → bare `H128`
  // (drop trailing propellant letters). Both are retried against designation+code.
  const base = raw.replace(/[-_][^-_]*$/, '');
  const bare = base.replace(/[A-Za-z]+$/, '');
  const stripped = [base, bare].map((s) => s.toLowerCase()).filter((s) => s && s !== want);

  const tiers: Array<() => CatalogMotor[]> = [
    () => catalog.filter((m) => m.designation.toLowerCase() === want),
    () => catalog.filter((m) => code(m) === want),
    () => catalog.filter((m) => norm(m.designation) === norm(raw) || norm(m.code ?? '') === norm(raw)),
    () => catalog.filter((m) => stripped.some((s) => m.designation.toLowerCase() === s || code(m) === s)),
  ];
  for (const tier of tiers) {
    const hit = byMfr(tier());
    if (hit.length) return hit[0];
  }
  return undefined;
}
