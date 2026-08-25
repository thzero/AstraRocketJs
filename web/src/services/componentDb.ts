// Component catalog — real manufacturer parts extracted from OpenRocket's
// bundled `.orc` files at build time (scripts/sync-components.mjs). (OpenRocket
// calls these "component presets"; here they're just the components catalog,
// symmetric with the motors catalog.) Pure bundled reference data (no runtime
// fetch, no store): the picker reads it and prefills the editor's geometry +
// material. SI units throughout (m, kg/m^3).
import bundled from '../data/components.generated.json';
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

const db = bundled as { generated: string; count: number; components: Component[] };

export const COMPONENTS_DATE: string = db.generated;

/** All catalog components of a type. */
export function componentsForType<T extends ComponentType>(type: T): ComponentMap[T][] {
  return db.components.filter((p): p is ComponentMap[T] => p.type === type);
}

/** Free-text filter over manufacturer / part number / description. */
export function filterComponents<C extends Component>(list: C[], text: string): C[] {
  const q = text.trim().toLowerCase();
  if (!q) return list;
  return list.filter((c) =>
    c.mfr.toLowerCase().includes(q) ||
    c.partNo.toLowerCase().includes(q) ||
    c.desc.toLowerCase().includes(q));
}
