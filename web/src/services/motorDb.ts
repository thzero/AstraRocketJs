// The motor CATALOG (specs only) — brought in by the VC-style build-time sync
// utility (scripts/sync-motors.mjs), which sweeps thrustcurve.org for every
// available, license-clean motor and ships the factual specs. Thrust CURVES are
// NOT in here — they download on demand at pick time (see thrustcurve.ts).
//
// The bundled JSON is the seed; on first load we mirror it into localStorage so
// the catalog itself lives in local alongside the fetched curves.
import bundled from '../data/motors.generated.json';
import { getMotorStore, type CustomMotor } from './motorStore';
import { parseEng, totalImpulse } from './engParser';

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
  length?: number;      // mm
  propWeightG?: number; // g
  /** Thrust curves, best-first (a motor can have several — cert/user, RASP/RockSim).
   *  Each `samples` is [time (s), thrust (N)] pairs. */
  curves?: { src: string; samples: [number, number][] }[];
  // Descriptive metadata for the detail panel (bundled by sync-motors.mjs).
  code?: string;        // full manufacturer designation, e.g. "E26W"
  type?: string;        // 'SU' | 'reload' | 'hybrid'
  delays?: string;      // e.g. "4,6,7,8,10"
  propInfo?: string;    // propellant type, e.g. "White Lightning"
  sparky?: boolean;
  avgThrust?: number;   // N
  maxThrust?: number;   // N
  /** Set by the sync when no thrust curve could be bundled (none published, or
   *  missing length/prop weight). Such a motor can't be plotted / combined. */
  noCurve?: boolean;
}

/** Whether a catalog motor has a usable bundled thrust curve (≥ 2 samples).
 *  The single source of truth for "can we plot / compare / combine this offline". */
export function hasCurve(m: CatalogMotor): boolean {
  return (m.curves?.[0]?.samples?.length ?? 0) >= 2;
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
 * The catalog: the bundled motors (now shipping their thrust curves) plus the
 * user's imported motors first, so they're easy to find in the picker. The
 * bundle is the source of truth — no localStorage mirror (a catalog-with-curves
 * is too large to cache there, and the bundle is always available offline).
 */
export async function loadCatalog(): Promise<CatalogMotor[]> {
  const custom = (await getMotorStore().listCustomMotors()).map(customToRow);
  return [...custom, ...(bundled as CatalogMotor[])];
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
}

export function filterMotors(catalog: CatalogMotor[], filter: MotorFilter): CatalogMotor[] {
  const text = filter.text.trim().toLowerCase();
  return catalog.filter((m) => {
    if (filter.classes.size > 0 && !filter.classes.has(m.class)) return false;
    if (filter.manufacturers.size > 0 && !filter.manufacturers.has(m.manufacturer)) return false;
    if (filter.minDiameter != null && m.diameter < filter.minDiameter) return false;
    if (filter.maxDiameter != null && m.diameter > filter.maxDiameter) return false;
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
 * Best catalog match for a designation from a .ork file (which names a motor
 * but carries no curve). Matches designation exactly, then loosely (ignoring
 * spaces/dashes), preferring the given manufacturer. Returns undefined if none.
 */
export function findCatalogMotor(
  catalog: CatalogMotor[],
  designation: string,
  manufacturer?: string,
): CatalogMotor | undefined {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[-\s]/g, '');
  const want = designation.trim().toLowerCase();
  if (!want) return undefined;
  let cands = catalog.filter((m) => m.designation.toLowerCase() === want);
  if (cands.length === 0) cands = catalog.filter((m) => norm(m.designation) === norm(designation));
  if (manufacturer) {
    const mf = manufacturer.trim().toLowerCase();
    const byMfr = cands.filter((m) => {
      const mm = m.manufacturer.toLowerCase();
      return mm === mf || mm.includes(mf) || mf.includes(mm);
    });
    if (byMfr.length) cands = byMfr;
  }
  return cands[0];
}
