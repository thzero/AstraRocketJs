// Component catalog — real manufacturer parts extracted from OpenRocket's
// `.orc` files by scripts/sync-components.mjs. (OpenRocket calls these
// "component presets"; here they're just the components catalog, symmetric with
// the motors catalog.) The catalog is a runtime file under public/data, fetched
// on demand (see remoteData.ts) so it can be refreshed without rebuilding the
// app; the picker reads it and prefills the editor's geometry + material. SI
// units throughout (m, kg/m^3).
import { fetchCatalog } from './remoteData';
import type { NoseShape } from '../engine/openRocketEngine';

interface ComponentBase {
  mfr: string;
  partNo: string;
  desc: string;
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

interface ComponentCatalog {
  generated: string;
  count: number;
  components: Component[];
}

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
/** `innerDiameter` / `cd` are `number | null` in the sync's schema. */
const isNullableFinite = (v: unknown): boolean => v === null || isFiniteNum(v);

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
        isFiniteNum(r.materialDensity) &&
        isFiniteNum(r.outerDiameter) &&
        isNullableFinite(r.innerDiameter) &&
        isFiniteNum(r.length)
      );
    case 'nosecone':
      return (
        isFiniteNum(r.materialDensity) &&
        isStr(r.shape) &&
        typeof r.filled === 'boolean' &&
        isFiniteNum(r.outerDiameter) &&
        isFiniteNum(r.length)
      );
    case 'bulkhead':
      return (
        isFiniteNum(r.materialDensity) &&
        isFiniteNum(r.outerDiameter) &&
        isFiniteNum(r.length) &&
        typeof r.filled === 'boolean'
      );
    case 'parachute':
      return isFiniteNum(r.diameter) && isNullableFinite(r.cd);
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

/**
 * Free-text filter over manufacturer / part number / description. Whitespace-
 * separated terms are AND-ed (each must appear somewhere), so "estes ogive"
 * finds Estes ogive parts even though no single field holds that exact phrase.
 */
export function filterComponents<C extends Component>(list: C[], text: string): C[] {
  const terms = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return list;
  return list.filter((c) => {
    const hay = `${c.mfr} ${c.partNo} ${c.desc}`.toLowerCase();
    return terms.every((term) => hay.includes(term));
  });
}
