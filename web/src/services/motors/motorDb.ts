// The motor catalog, produced by the build-time sync utility
// (scripts/sync-motors.mjs), which sweeps thrustcurve.org for every available,
// license-clean motor and ships the factual specs plus, where one is
// published, the bundled thrust curve (`curves`). A motor without one has its
// curve fetched on demand at pick time (see thrustcurve.ts).
//
// The catalog is a runtime file fetched through remoteData.ts and memoized for
// the session. There is no localStorage mirror of it: a catalog-with-curves is
// too large for that budget, and the bundle is always available offline.
import { getMotorStore, type CustomMotor } from './motorStore';
import { MIN_CURVE_SAMPLES } from './motorCurve';
import { parseEng, totalImpulse } from './engParser';
import { parseRse } from './rseParser';
import { motorFitsMount, offersPlugged, type MountFit } from './motorPicker';
import { fetchCatalog } from '../app/remoteData';
import { PLUGGED_DELAY } from '../../engine/openRocketEngine';
import { keyOf } from './motorKey';
import { errorMessage } from '../app/errorMessage';
import { assertImportSize } from '../files/decodeText';

/** One catalog row: the sync utility's schema, plus optional custom-motor tags. */
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
  /** Length and propellant weight, which together with a bundled curve let the
   *  motor resolve entirely offline, with no thrustcurve.org fetch. */
  length?: number; // mm
  propWeightG?: number; // g
  /** Bundled thrust curves from the build-time sync, best-first (a motor can have
   *  several: cert/user, RASP/RockSim). Each `samples` is [time (s), thrust (N)]
   *  pairs. Absent → fetched on demand. */
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
  /** Out of regular production (thrustcurve.org's OOP). Desktop's chooser hides
   *  these behind "Hide motors which are not in regular production". */
  oop?: boolean;
  /**
   * OpenRocket's own digests for this motor, one per entry its database holds
   * for the name, with the delays that entry offers. Put here by
   * `npm run sync:motor-digests`.
   *
   * A `.ork` identifies a motor by manufacturer, designation, diameter and
   * length, and the desktop's database holds several entries behind one of
   * those names (Estes C6 is a plugged one and a delayed one). With nothing to
   * choose between them it takes the first and warns that it did. The digest is
   * the only field that names which, which is why `<digest>` goes into every
   * `<motor>` block we write - see `catalogDigest`.
   */
  digests?: { digest: string; delays: (number | 'P')[] }[];
  /** CG-vs-time as [[t (s), cgFromNose (m)]], read from the motor file (RockSim):
   *  the real CG OpenRocket uses. Launch CG = cg[0][1]. Absent → the motor
   *  build falls back to mid-length (same as OpenRocket for RASP-only data). */
  cg?: [number, number][];
}

/**
 * Which of OpenRocket's entries for this motor the seated delay means.
 *
 * The delay is what separates them in the usual case - a plugged C6 and a C6-5
 * are different motors with different digests - and where it does not, the sync
 * has already put the entry whose curve is closest to ours first. Undefined
 * when the catalog has no digests for the row, which is a motor the desktop's
 * database does not contain: then we write no digest rather than a wrong one.
 */
export function catalogDigest(cat: CatalogMotor, ejectionDelay: number): string | undefined {
  const entries = cat.digests;
  if (!entries?.length) return undefined;
  const want: number | 'P' = ejectionDelay >= PLUGGED_DELAY ? 'P' : Math.round(ejectionDelay);
  return (entries.find((e) => e.delays.includes(want)) ?? entries[0]!).digest;
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
    length: cm.length,
    propWeightG: cm.propWeightG,
    // `.rse` carries these; `.eng` has nowhere to put either. They are what
    // make an imported hybrid read as a hybrid in the detail panel, and what
    // lets the plugged filter see a motor built without an ejection charge.
    type: cm.type,
    delays: cm.delayList,
  };
}

/**
 * A catalog row this app can actually use.
 *
 * The catalog can come from a separately deployed host (VITE_DATA_BASE / the
 * jsDelivr data branch), so each row is checked. A row missing `class` throws
 * inside `allClasses`' `localeCompare`, and one missing `designation` throws in
 * `filterMotors`' `toLowerCase`, taking down the entire motor picker rather than
 * that one entry. `motorStore` guards custom motors the same way.
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
 * `some`, not `every`: with `every`, one malformed row would reject the whole
 * catalog (and fall through to the in-build copy, or to an empty picker), which
 * is the outcome row-by-row validation exists to avoid. The gate only decides
 * whether this host's copy is worth anything at all; the bad rows are dropped in
 * `loadCatalog` and the rest are kept.
 */
const isCatalog = (v: unknown): boolean => Array.isArray(v) && v.some(isCatalogMotor);

export async function loadCatalog(): Promise<CatalogMotor[]> {
  // The 700 kB+ catalog is a runtime file under public/data (see remoteData.ts),
  // fetched only when something first needs it (e.g. the motor picker opens)
  // rather than weighing down the initial app bundle, and refreshable without
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

/**
 * Parse a motor file, store what it holds, and return the refreshed catalog.
 *
 * The format is chosen from the file's bytes rather than its extension, the
 * way `designFile.ts` picks between `.ork` and `.rkt`: a `.rse` arrives named
 * `.rse`, `.rse.xml` or occasionally `.eng` from a site that guessed, and the
 * one thing that never lies is whether the text is XML.
 *
 * Returns the refreshed catalog and how many motors landed, because a `.rse`
 * can be a manufacturer's whole range and importing 40 of them silently would
 * be indistinguishable from importing one.
 */
export async function importCustomMotors(
  files: { name: string; text: string }[],
): Promise<{ catalog: CatalogMotor[]; imported: number; failed: string[] }> {
  // Several files at once, the way desktop loads a whole folder of thrust
  // curves. A file that cannot be read is named and skipped rather than
  // stopping the rest.
  const motors: ReturnType<typeof parseEng>[] = [];
  const failed: string[] = [];
  let firstError: Error | null = null;
  for (const { name, text } of files) {
    try {
      assertImportSize(text.length);
      motors.push(...(text.trimStart().startsWith('<') ? parseRse(text) : [parseEng(text)]));
    } catch (err) {
      failed.push(name);
      firstError ??= err instanceof Error ? err : new Error(errorMessage(err));
    }
  }
  // Nothing read at all: the parser's own message says what is wrong with it.
  if (motors.length === 0 && firstError) throw firstError;
  // One write for every file. A `.rse` engine database is a manufacturer's
  // entire range, and a write per motor would re-parse the stored array every
  // time and could stop half way with no way to say where.
  await getMotorStore().addCustomMotors(motors);
  return { catalog: await loadCatalog(), imported: motors.length, failed };
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
   * Not the same question as the impulse class above, which is why both exist: a
   * class is a doubling bucket, so H spans 160 to 320 N·s, and "at least 400 N·s"
   * is a number that comes out of a design rather than a letter you can pick.
   */
  minImpulse?: number;
  maxImpulse?: number;
  /** Keep only motors that go in this mount (see motorFitsMount). */
  fit?: MountFit;
  /**
   * Keep only motors the manufacturer lists as available plugged. What the spec
   * says rather than what is possible: any motor can be flown plugged (see
   * offersPlugged), so this finds the ones built without an ejection charge.
   */
  plugged?: boolean;
  /** Leave out motors no longer in regular production (desktop's "hide unavailable"). */
  hideOop?: boolean;
  /** Leave out these motors, by `keyOf`: the ones already used in the mount. */
  hide?: ReadonlySet<string>;
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
    if (filter.hideOop && m.oop) return false;
    if (filter.hide && filter.hide.has(keyOf(m))) return false;
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
 * Why a motor is not simply the one the file named.
 *
 * `maker`      the file named a manufacturer and this motor is not theirs
 * `shortened`  the name only matched once parts of it were taken off
 * `several`    more than one motor matched equally well and this is the first
 */
export type MotorMatchDoubt = 'maker' | 'shortened' | 'several';

/** A found motor, and whether it is the one the file asked for. */
export interface MotorMatch {
  motor: CatalogMotor;
  /** Absent when the file's own name and maker identify this motor outright. */
  doubt?: MotorMatchDoubt;
}

/**
 * The catalog motor a design file's designation resolves to, and how sure that is.
 *
 * A file stores the full manufacturer designation (AeroTech "H128W" with its
 * propellant letter, Cesaroni "131G84-10A" with case and delay) while the
 * catalog keys the short name ("H128", "G84") and keeps the full one in `code`.
 * So the match runs, progressively looser, against both `designation` and `code`:
 *   1) exact designation           2) exact code (the full name)
 *   3) normalized either (ignore -/space)
 *   4) strip trailing -VARIANT segments (…-OLD / …-10A), a leading impulse
 *      number and/or a trailing propellant letter, then retry. This is what
 *      resolves "J350W-OLD" → "J350"/"J350W".
 * The requested manufacturer breaks ties within each tier (AeroTech vs Cesaroni
 * "I180"). Returns undefined if nothing matches at all.
 *
 * The manufacturer is a preference rather than a filter, so a file naming a
 * maker we carry no motors for still gets somebody's motor. Every tier is a
 * real match worth making and none of them is certain, so the result carries a
 * `doubt`: without it, an `I170-P` filed under Kosdon would load Cesaroni's I170
 * with no notice.
 *
 * `findCatalogMotor` is this without the doubt, for the callers that only want
 * the row.
 */
export function matchCatalogMotor(
  catalog: CatalogMotor[],
  designation: string,
  manufacturer?: string,
): MotorMatch | undefined {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[-\s]/g, '');
  const raw = designation.trim();
  const want = raw.toLowerCase();
  if (!want) return undefined;
  const code = (m: CatalogMotor) => (m.code ?? '').toLowerCase();

  // Prefer the requested manufacturer, but never let it empty a non-empty set.
  const byMfr = (cands: CatalogMotor[]): CatalogMotor[] => {
    if (!manufacturer || cands.length <= 1) return cands;
    const mf = manufacturer.trim().toLowerCase();
    const hit = cands.filter((m) => sameMaker(m.manufacturer, mf));
    return hit.length ? hit : cands;
  };

  // `H128W-OLD` → base `H128W` (drop one trailing -/_ suffix) → bare `H128`
  // (drop trailing propellant letters). Both are retried against designation+code.
  //
  // One segment at a time rather than one pass, because a file can carry
  // several: RockSim writes a Cesaroni motor as `26-E31-WH-15A`, where the
  // catalog holds `E31` and its own code is `26E31-15A`, so stopping after one
  // would leave `26-E31-WH`, which matches nothing. Every candidate has to keep a letter,
  // so a name is never worn down to a bare number that could match another
  // motor by its digits.
  const shrink = (name: string): string[] => {
    const out: string[] = [];
    for (let s = name; s.length > 1; s = s.replace(/[-_][^-_]*$/, '')) {
      out.push(s, s.replace(/[A-Za-z]+$/, '').replace(/[-_]+$/, ''));
      if (!/[-_]/.test(s)) break;
    }
    return out.filter((c) => c.length > 1 && /[A-Za-z]/.test(c));
  };
  // `206J530-IM` → `J530-IM`, `26-E31-WH-15A` → `E31-WH-15A`. RockSim writes a
  // Cesaroni motor with its total impulse in front of the name, hyphenated or
  // not, where the catalog holds the name on its own and the file's number is
  // not always the one our row's code carries. Only read past when a letter
  // follows it, so a designation that really begins with digits ("1/2A6", a
  // bare part number) is left alone.
  const noImpulse = raw.replace(/^\d+[-_]?(?=[A-Za-z])/, '');
  const stripped = [...new Set([...shrink(raw), ...(noImpulse === raw ? [] : shrink(noImpulse))])]
    .map((s) => s.toLowerCase())
    .filter((s) => s && s !== want);

  const tiers: Array<() => CatalogMotor[]> = [
    () => catalog.filter((m) => m.designation.toLowerCase() === want),
    () => catalog.filter((m) => code(m) === want),
    () => catalog.filter((m) => norm(m.designation) === norm(raw) || norm(m.code ?? '') === norm(raw)),
    () => catalog.filter((m) => stripped.some((s) => m.designation.toLowerCase() === s || code(m) === s)),
  ];
  // The last tier is the shortened one: everything above it matched the name as
  // the file wrote it, give or take spaces and dashes.
  const shortenedTier = tiers.length - 1;
  for (let i = 0; i < tiers.length; i++) {
    const hit = byMfr(tiers[i]!());
    if (!hit.length) continue;
    const motor = hit[0]!;
    return { motor, ...(doubtAbout(motor, hit.length, i === shortenedTier, manufacturer) ?? {}) };
  }
  return undefined;
}

/**
 * Whether a catalog maker answers to the one a file asked for (`asked` already
 * trimmed and lowercased): equal, or either name containing the other.
 */
function sameMaker(catalogMaker: string, asked: string): boolean {
  const got = catalogMaker.toLowerCase();
  return got === asked || got.includes(asked) || asked.includes(got);
}

/** Which doubt to report, most surprising first. */
function doubtAbout(
  motor: CatalogMotor,
  candidates: number,
  shortened: boolean,
  manufacturer?: string,
): { doubt: MotorMatchDoubt } | undefined {
  const asked = manufacturer?.trim().toLowerCase();
  // The same test `byMfr` prefers by, so "no doubt" means it got its way.
  if (asked && !sameMaker(motor.manufacturer, asked)) return { doubt: 'maker' };
  if (shortened) return { doubt: 'shortened' };
  if (candidates > 1) return { doubt: 'several' };
  return undefined;
}

/** The motor a name resolves to, without asking how sure that is. */
export function findCatalogMotor(
  catalog: CatalogMotor[],
  designation: string,
  manufacturer?: string,
): CatalogMotor | undefined {
  return matchCatalogMotor(catalog, designation, manufacturer)?.motor;
}
