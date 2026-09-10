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

// The catalog is a runtime file under public/data (see remoteData.ts), fetched
// once and memoized, so it can be refreshed without rebuilding the app.
let catalogP: Promise<ComponentCatalog> | null = null;
function loadCatalog(): Promise<ComponentCatalog> {
  return (catalogP ??= fetchCatalog<ComponentCatalog>('components'));
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
