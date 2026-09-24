// What a material IS. Types only, no data and no I/O, so anything that merely
// needs the shape (the store, the picker's props, a settings row) can import it
// without dragging the catalog in behind it.
//
// The catalog itself is a runtime file — public/data/materials.generated.json,
// written by scripts/sync-materials.mjs and fetched on demand like motors and
// components (see remoteData.ts). It is NOT bundled: nothing in src/ holds the
// table.
//
// The engine applies a material by DENSITY, so that is all the app needs to
// reproduce OpenRocket's mass/CG. Densities are SI: bulk kg/m^3, surface
// kg/m^2, line kg/m.

export type MaterialType = 'bulk' | 'surface' | 'line';

/**
 * The one group that is not a material a rocket is BUILT from.
 *
 * Every other bulk material in the table is something a part can legitimately
 * be made of (people build fins from aluminum and nose cones from PLA) so the
 * app does not presume to filter them, and neither does OpenRocket. Glue is
 * different: it exists here for fin fillets and nothing is made of it. The
 * picker uses this to keep it out of the structural lists.
 */
export const ADHESIVE_GROUP = 'Adhesives';

export interface Material {
  name: string;
  type: MaterialType;
  /** bulk: kg/m^3 · surface: kg/m^2 · line: kg/m */
  density: number;
  /** Upstream MaterialGroup, used to group the picker. */
  group: string;
  /** true for user-defined materials; absent/false for built-ins. */
  custom?: boolean;
}

/**
 * Where a catalog row came from. Carried so the drift gate
 * (`engine-java/extract/extract.mjs --check`) can hold the `upstream` rows to
 * OpenRocket's own `Databases.java` and leave ours alone. The app itself does
 * not read it: a material is a name and a density whoever wrote it down.
 */
export type MaterialKind = 'upstream' | 'adhesive' | 'corrected';

/** A row of the runtime catalog, as sync-materials.mjs writes it. */
export interface MaterialRow {
  name: string;
  type: MaterialType;
  density: number;
  group: string;
  kind: MaterialKind;
}

const TYPES: readonly string[] = ['bulk', 'surface', 'line'];

const isRow = (v: unknown): v is MaterialRow => {
  const r = v as Partial<MaterialRow> | null;
  return (
    !!r &&
    typeof r.name === 'string' &&
    r.name.length > 0 &&
    TYPES.includes(r.type as string) &&
    typeof r.density === 'number' &&
    Number.isFinite(r.density) &&
    r.density > 0 &&
    typeof r.group === 'string'
  );
};

/**
 * Shape guard for the fetched catalog.
 *
 * `fetchCatalog` needs this for the same reason the motor catalog does: a data
 * host that is UP but WRONG serves `{"error":"rebuilding"}` with HTTP 200,
 * which parses fine and would reach the picker as a material list. A failed
 * check makes that host's answer a failure of THAT host, so the in-build copy
 * is still tried. The density test earns its keep twice over here, since a row
 * that got through would be stamped onto a part and flown.
 */
export function isMaterialCatalog(v: unknown): v is MaterialRow[] {
  return Array.isArray(v) && v.length > 0 && v.every(isRow);
}
