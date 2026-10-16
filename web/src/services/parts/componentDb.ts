// Component catalog: real manufacturer parts extracted from OpenRocket's
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
   * The mass the catalog states (kg), when it states one. A parachute takes a
   * positive one as its mass override (`Parachute.loadFromPreset`), and a rail
   * button its total with screw and nut (`RailButton.loadFromPreset`, see
   * `RailButtonComponent`). Every other part already has it folded into
   * `materialDensity` (`ComponentPresetFactory`), and this is the figure the
   * part weighs.
   */
  mass?: number;
  /**
   * The three fields below are a saved part's, and absent on every catalog
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
   * saved part is a component the user built, so applying only those
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

interface NoseConeComponent extends ComponentBase {
  type: 'nosecone';
  material?: string;
  materialDensity: number;
  shape: NoseShape;
  /** OpenRocket's own checksum for this part; the `.ork` link is invalid without it. */
  digest?: string;
  filled: boolean;
  /** The wall a hollow part states; null when it states none. */
  thickness?: number | null;
  outerDiameter: number;
  length: number;
  /** The aft shoulder; null when the part states none. */
  shoulderDiameter?: number | null;
  shoulderLength?: number | null;
}

/**
 * Parachute: the canopy, and what `Parachute.loadFromPreset` also applies. The
 * fields after `cd` are absent from catalogs published before they were
 * carried, and from a part the desktop library does not hold; a part without
 * one takes a new parachute's value for it.
 */
export interface ParachuteComponent extends ComponentBase {
  type: 'parachute';
  diameter: number;
  /** Drag coefficient; null when the file omits it (apply a default). */
  cd: number | null;
  lineCount?: number;
  lineLength?: number;
  /** Packed size, each only where the part states it. */
  packedLength?: number;
  packedDiameter?: number;
  /** The canopy's surface material (density per square meter). */
  material?: string;
  materialDensity?: number;
  /** The shroud lines' material (density per meter). */
  lineMaterial?: string;
  lineMaterialDensity?: number;
}

/** Tube coupler, centering ring, engine block or launch lug: a tube (OD/ID/length). */
export interface TubeComponent extends ComponentBase {
  type: 'tubecoupler' | 'centeringring' | 'engineblock' | 'launchlug';
  material?: string;
  materialDensity: number;
  outerDiameter: number;
  innerDiameter: number | null;
  length: number;
}

/** Bulkhead: a (usually solid) disc. Inner structural part. */
interface BulkHeadComponent extends ComponentBase {
  type: 'bulkhead';
  material?: string;
  materialDensity: number;
  outerDiameter: number;
  length: number;
  filled: boolean;
}

/** Transition: both ends and both shoulders, as Transition.loadFromPreset reads them. */
interface TransitionComponent extends ComponentBase {
  type: 'transition';
  material?: string;
  materialDensity: number;
  shape: NoseShape;
  filled: boolean;
  /** Wall thickness, when the row states one; most state `filled` instead. */
  thickness: number | null;
  length: number;
  foreOuterDiameter: number;
  foreShoulderDiameter: number | null;
  foreShoulderLength: number | null;
  aftOuterDiameter: number;
  aftShoulderDiameter: number | null;
  aftShoulderLength: number | null;
}

/** Streamer: a strip, whose material is a surface one (density per square meter). */
interface StreamerComponent extends ComponentBase {
  type: 'streamer';
  material?: string;
  materialDensity: number;
  stripLength: number;
  stripWidth: number;
}

/**
 * Rail button: the geometry `RailButton.loadFromPreset` reads. Its `mass` is
 * the button, screw and nut together, which the desktop applies as the part's
 * mass override; `cd` is a stated drag coefficient, applied as its override.
 */
interface RailButtonComponent extends ComponentBase {
  type: 'railbutton';
  material?: string;
  materialDensity: number;
  outerDiameter: number;
  innerDiameter: number | null;
  height: number;
  baseHeight: number | null;
  flangeHeight: number | null;
  screwHeight: number | null;
  cd: number | null;
}

/** Discriminated by `type`; keeps ComponentType and componentsForType in sync. */
interface ComponentMap {
  bodytube: BodyTubeComponent;
  nosecone: NoseConeComponent;
  parachute: ParachuteComponent;
  tubecoupler: TubeComponent;
  centeringring: TubeComponent;
  bulkhead: BulkHeadComponent;
  transition: TransitionComponent;
  engineblock: TubeComponent;
  launchlug: TubeComponent;
  streamer: StreamerComponent;
  railbutton: RailButtonComponent;
}

/**
 * The outer diameter the picker sorts, filters and fits a row by: a chute's
 * canopy, a transition's aft end (the end that meets the tube below), and null
 * for a streamer, which has none.
 */
export function outerDiameterOf(p: Component): number | null {
  switch (p.type) {
    case 'parachute':
      return p.diameter;
    case 'transition':
      return p.aftOuterDiameter;
    case 'streamer':
      return null;
    default:
      return p.outerDiameter;
  }
}

/** The length the picker shows and sorts by: a streamer's strip, a rail button's height, nothing for a chute. */
export function lengthOf(p: Component): number | null {
  if (p.type === 'parachute') return null;
  if (p.type === 'railbutton') return p.height;
  return p.type === 'streamer' ? p.stripLength : p.length;
}

export type ComponentType = keyof ComponentMap;
export type Component = ComponentMap[ComponentType];

/**
 * A node type the picker can serve, which is not the same set as the catalog's
 * own types: an inner tube has no catalog of its own.
 *
 * Neither does it upstream. OpenRocket's preset files carry a `BodyTube` block
 * and nothing for inner tubes, because an inner tube is dimensionally a body
 * tube, and many of the body tube rows are explicitly motor mount tubes
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
/** A size the part cannot be built without: a zero would make a zero-volume part. */
const isPositive = (v: unknown): boolean => isFiniteNumber(v) && v > 0;
/** A size that may be zero (no wall, no shoulder, no density on file) but never negative. */
const isNonNegative = (v: unknown): boolean => isFiniteNumber(v) && v >= 0;
const isNullableNonNegative = (v: unknown): boolean => v === null || isNonNegative(v);
/** An optional size: absent, null, or not negative. */
const isOptionalSize = (v: unknown): boolean => v === undefined || isNullableNonNegative(v);

/**
 * Every shape the editor can build. Keyed by the type, so a new `NoseShape`
 * fails the build here until it is listed; an unknown one would otherwise fall
 * back to a different shape without a word.
 */
const KNOWN_SHAPES: ReadonlySet<string> = new Set(
  Object.keys({
    ogive: true,
    conical: true,
    ellipsoid: true,
    power: true,
    parabolic: true,
    haack: true,
  } satisfies Record<NoseShape, true>),
);
const isShape = (v: unknown): boolean => typeof v === 'string' && KNOWN_SHAPES.has(v);

/**
 * One catalog row this build can hand to the editor, checked per type.
 *
 * The rows go straight into `treeEdit.catalogPatch`, which divides
 * `outerDiameter` by two and subtracts `innerDiameter` from it; a row missing
 * either would put a NaN radius in the design with no error. Each type
 * requires exactly the fields its `catalogPatch` case reads, every size it
 * builds from positive (a zero diameter is a zero-volume part that only shows
 * as wrong once applied), and a shape the editor knows.
 */
export function isComponentRow(v: unknown): v is Component {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  if (!isStr(r.mfr) || !isStr(r.partNo) || !isStr(r.desc)) return false;
  if (r.mass !== undefined && !isNonNegative(r.mass)) return false;
  switch (r.type) {
    case 'bodytube':
    case 'tubecoupler':
    case 'centeringring':
    case 'engineblock':
    case 'launchlug':
      return (
        isNonNegative(r.materialDensity) &&
        isPositive(r.outerDiameter) &&
        isNullableNonNegative(r.innerDiameter) &&
        isPositive(r.length)
      );
    case 'nosecone':
      // The wall and shoulder fields are absent from catalogs published before
      // they were carried, which are still valid rows.
      return (
        isNonNegative(r.materialDensity) &&
        isShape(r.shape) &&
        typeof r.filled === 'boolean' &&
        isPositive(r.outerDiameter) &&
        isPositive(r.length) &&
        [r.thickness, r.shoulderDiameter, r.shoulderLength].every(isOptionalSize)
      );
    case 'bulkhead':
      return (
        isNonNegative(r.materialDensity) &&
        isPositive(r.outerDiameter) &&
        isPositive(r.length) &&
        typeof r.filled === 'boolean'
      );
    case 'parachute':
      return (
        isPositive(r.diameter) &&
        isNullableFinite(r.cd) &&
        [r.lineCount, r.lineLength, r.packedLength, r.packedDiameter, r.materialDensity, r.lineMaterialDensity].every(
          (v) => v === undefined || isNonNegative(v),
        ) &&
        [r.material, r.lineMaterial].every((v) => v === undefined || isStr(v))
      );
    case 'transition':
      return (
        isNonNegative(r.materialDensity) &&
        isShape(r.shape) &&
        typeof r.filled === 'boolean' &&
        isNullableNonNegative(r.thickness) &&
        isPositive(r.length) &&
        // One end may close to a point, as a tail cone does; not both.
        isNonNegative(r.foreOuterDiameter) &&
        isNonNegative(r.aftOuterDiameter) &&
        (isPositive(r.foreOuterDiameter) || isPositive(r.aftOuterDiameter)) &&
        isNullableNonNegative(r.foreShoulderDiameter) &&
        isNullableNonNegative(r.foreShoulderLength) &&
        isNullableNonNegative(r.aftShoulderDiameter) &&
        isNullableNonNegative(r.aftShoulderLength)
      );
    case 'streamer':
      return isNonNegative(r.materialDensity) && isPositive(r.stripLength) && isPositive(r.stripWidth);
    case 'railbutton':
      return (
        isNonNegative(r.materialDensity) &&
        isPositive(r.outerDiameter) &&
        isPositive(r.height) &&
        [r.innerDiameter, r.baseHeight, r.flangeHeight, r.screwHeight].every(isNullableNonNegative) &&
        isNullableFinite(r.cd)
      );
    default:
      return false;
  }
}

/**
 * The shape gate handed to `fetchCatalog`: an object carrying a `components`
 * array. The data host can serve `{"error":"rebuilding"}` with HTTP 200; a
 * looser check would let that be memoized for the session, and `projectByType`
 * would then throw on `.filter` of undefined at every picker open until a
 * reload. A wrong shape is a failed load (the picker says so and can retry)
 * and is never cached.
 */
export const isComponentCatalog = (v: unknown): v is { components: unknown[] } =>
  !!v && typeof v === 'object' && Array.isArray((v as { components?: unknown }).components);

// The catalog is a runtime file under public/data (see remoteData.ts), fetched
// once and memoized, so it can be refreshed without rebuilding the app.
let catalogP: Promise<ComponentCatalog> | null = null;
export function loadCatalog(): Promise<ComponentCatalog> {
  if (!catalogP) {
    // Row by row: keep every usable row, drop the rest (motorDb does the same
    // for motors). A single malformed part costs that part, not the picker.
    catalogP = fetchCatalog<ComponentCatalog & { components: unknown[] }>('components', isComponentCatalog).then(
      (cat) => ({ ...cat, components: cat.components.filter(isComponentRow) }),
    );
    // Don't memoize a failure: a cached rejected promise would replay the same
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

/** All catalog components of a type; loads (and caches) the catalog on first use. */
export async function componentsForType<T extends ComponentType>(type: T): Promise<ComponentMap[T][]> {
  return projectByType(await loadCatalog(), type);
}
