// Component catalog — real manufacturer parts extracted from OpenRocket's
// `.orc` files by scripts/sync-components.mjs. (OpenRocket calls these
// "component presets"; here they're just the components catalog, symmetric with
// the motors catalog.) The catalog is a runtime file under public/data, fetched
// on demand (see remoteData.ts) so it can be refreshed without rebuilding the
// app; the picker reads it and prefills the editor's geometry + material. SI
// units throughout (m, kg/m^3).
import { fetchCatalog } from '../app/remoteData';
import type { ComponentNode, NoseShape } from '../../engine/openRocketEngine';
import { isFiniteNumber } from '../app/numbers';

interface ComponentBase {
  mfr: string;
  partNo: string;
  desc: string;
  /**
   * The three fields below are a SAVED PART's, and absent on every catalog
   * row. They live here rather than in a row type of their own so that the
   * user's own parts are ordinary rows to the picker and to componentFilter:
   * one list to search, facet, fit-rank and sort. See customParts.ts.
   */
  /** Stable local id, for deleting the saved part it came from. */
  id?: string;
  /** Marks the row as the user's own (a star in the picker, and deletable). */
  custom?: true;
  /**
   * The whole saved node. A catalog row publishes a handful of dimensions; a
   * saved part is a component the user BUILT, so applying only those
   * dimensions would drop its shoulder, its lines, its motor mount and its
   * color. `treeEdit.catalogPatch` applies this instead of the per-type map.
   */
  patch?: Partial<ComponentNode>;
}

export interface BodyTubeComponent extends ComponentBase {
  type: 'bodytube';
  material?: string;
  materialDensity: number;
  outerDiameter: number;
  innerDiameter: number | null;
  length: number;
}

export interface NoseConeComponent extends ComponentBase {
  type: 'nosecone';
  material?: string;
  materialDensity: number;
  shape: NoseShape;
  /** OpenRocket's own checksum for this part; the `.ork` link is invalid without it. */
  digest?: string;
  filled: boolean;
  outerDiameter: number;
  length: number;
}

export interface ParachuteComponent extends ComponentBase {
  type: 'parachute';
  diameter: number;
  /** Drag coefficient; null when the file omits it (apply a default). */
  cd: number | null;
}

/** Tube coupler / centering ring — a tube (OD/ID/length). Inner structural part. */
export interface TubeComponent extends ComponentBase {
  type: 'tubecoupler' | 'centeringring';
  material?: string;
  materialDensity: number;
  outerDiameter: number;
  innerDiameter: number | null;
  length: number;
}

/** Bulkhead — a (usually solid) disc. Inner structural part. */
export interface BulkHeadComponent extends ComponentBase {
  type: 'bulkhead';
  material?: string;
  materialDensity: number;
  outerDiameter: number;
  length: number;
  filled: boolean;
}

/** Discriminated by `type` — keeps ComponentType and componentsForType in sync. */
interface ComponentMap {
  bodytube: BodyTubeComponent;
  nosecone: NoseConeComponent;
  parachute: ParachuteComponent;
  tubecoupler: TubeComponent;
  centeringring: TubeComponent;
  bulkhead: BulkHeadComponent;
}

export type ComponentType = keyof ComponentMap;
export type Component = ComponentMap[ComponentType];

/**
 * A node type the picker can serve, which is NOT the same set as the catalog's
 * own types: an inner tube has no catalog of its own.
 *
 * Neither does it upstream. OpenRocket's preset files carry a `BodyTube` block
 * and nothing for inner tubes, because an inner tube IS dimensionally a body
 * tube, and 51 of the body tube rows are explicitly motor mount tubes
 * (`Blue Tube, 1.15"/29mm, MMT`). So an inner tube picks from the body tubes,
 * the same way desktop OpenRocket does, and `catalogPatch` needs no new case
 * because the row it receives is a body tube row.
 */
export type PickerType = ComponentType | 'innertube';

/** The catalog type whose rows serve a node type. */
export const catalogTypeFor = (t: PickerType): ComponentType => (t === 'innertube' ? 'bodytube' : t);

interface ComponentCatalog {
  generated: string;
  count: number;
  components: Component[];
}

const isStr = (v: unknown): v is string => typeof v === 'string';
/** `innerDiameter` / `cd` are `number | null` in the sync's schema. */
const isNullableFinite = (v: unknown): boolean => v === null || isFiniteNumber(v);

/**
 * One catalog row this build can hand to the editor, checked PER TYPE.
 *
 * The rows go straight into `treeEdit.catalogPatch`, which divides
 * `outerDiameter` by two and subtracts `innerDiameter` from it; a row missing
 * either produced a NaN radius in the design and nothing said so. Each type
 * requires exactly the fields its `catalogPatch` case reads.
 */
export function isComponentRow(v: unknown): v is Component {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  if (!isStr(r.mfr) || !isStr(r.partNo) || !isStr(r.desc)) return false;
  switch (r.type) {
    case 'bodytube':
    case 'tubecoupler':
    case 'centeringring':
      return (
        isFiniteNumber(r.materialDensity) &&
        isFiniteNumber(r.outerDiameter) &&
        isNullableFinite(r.innerDiameter) &&
        isFiniteNumber(r.length)
      );
    case 'nosecone':
      return (
        isFiniteNumber(r.materialDensity) &&
        isStr(r.shape) &&
        typeof r.filled === 'boolean' &&
        isFiniteNumber(r.outerDiameter) &&
        isFiniteNumber(r.length)
      );
    case 'bulkhead':
      return (
        isFiniteNumber(r.materialDensity) &&
        isFiniteNumber(r.outerDiameter) &&
        isFiniteNumber(r.length) &&
        typeof r.filled === 'boolean'
      );
    case 'parachute':
      return isFiniteNumber(r.diameter) && isNullableFinite(r.cd);
    default:
      return false;
  }
}

/**
 * The shape gate handed to `fetchCatalog`: an object carrying a `components`
 * ARRAY. "Any object" was the whole check before, and the data host can serve
 * `{"error":"rebuilding"}` with HTTP 200: that parsed, passed, was memoized
 * for the session, and `projectByType` then threw on `.filter` of undefined
 * at every picker open until a reload. A wrong shape is a failure of THAT
 * base (remoteData falls through to the in-build copy) and is never cached.
 */
export const isComponentCatalog = (v: unknown): v is { components: unknown[] } =>
  !!v && typeof v === 'object' && Array.isArray((v as { components?: unknown }).components);

// The catalog is a runtime file under public/data (see remoteData.ts), fetched
// once and memoized, so it can be refreshed without rebuilding the app.
let catalogP: Promise<ComponentCatalog> | null = null;
function loadCatalog(): Promise<ComponentCatalog> {
  if (!catalogP) {
    // Row by row: keep every usable row, drop the rest (motorDb does the same
    // for motors). A single malformed part costs that part, not the picker.
    catalogP = fetchCatalog<ComponentCatalog & { components: unknown[] }>('components', isComponentCatalog).then(
      (cat) => ({ ...cat, components: cat.components.filter(isComponentRow) }),
    );
    // Don't memoize a FAILURE: a cached rejected promise would replay the same
    // error on every retry, so the picker could never recover from one bad load.
    // (remoteData clears its own cache on failure for the same reason.)
    catalogP.catch(() => (catalogP = null));
  }
  return catalogP;
}

/** Filter a loaded catalog to a single component type (pure). */
export function projectByType<T extends ComponentType>(cat: ComponentCatalog, type: T): ComponentMap[T][] {
  return cat.components.filter((p): p is ComponentMap[T] => p.type === type);
}

/** All catalog components of a type — loads (and caches) the catalog on first use. */
export async function componentsForType<T extends ComponentType>(type: T): Promise<ComponentMap[T][]> {
  return projectByType(await loadCatalog(), type);
}
