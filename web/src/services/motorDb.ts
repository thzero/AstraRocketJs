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
 * Cheap FNV-1a signature of the bundled catalog (hash + length). The MotorStore
 * stamps it on the mirror so a NEWER bundle — shipped by a re-sync + redeploy —
 * supersedes the cached copy instead of being shadowed by it forever.
 */
function signature(cat: CatalogMotor[]): string {
  const s = JSON.stringify(cat);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16)}:${cat.length}`;
}

/**
 * The catalog. Uses the localStorage mirror only while it matches the bundled
 * catalog's signature; a redeploy with a re-synced catalog changes the
 * signature, so the fresh bundle wins automatically (zero thrustcurve load —
 * the catalog is refreshed at build time, not at runtime).
 */
export async function loadCatalog(): Promise<CatalogMotor[]> {
  const catalog = bundled as CatalogMotor[];
  const sig = signature(catalog);
  let base = await getMotorStore().readCatalog(sig);
  if (!base) {
    await getMotorStore().writeCatalog(catalog, sig);
    base = catalog;
  }
  // Imported motors first, so they're easy to find in the picker.
  const custom = (await getMotorStore().listCustomMotors()).map(customToRow);
  return [...custom, ...base];
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
}

export function filterMotors(catalog: CatalogMotor[], filter: MotorFilter): CatalogMotor[] {
  const text = filter.text.trim().toLowerCase();
  return catalog.filter((m) => {
    if (filter.classes.size > 0 && !filter.classes.has(m.class)) return false;
    if (filter.manufacturers.size > 0 && !filter.manufacturers.has(m.manufacturer)) return false;
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
