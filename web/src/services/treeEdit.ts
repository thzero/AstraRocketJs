/**
 * Pure, immutable helpers for editing a component tree (add / update / remove
 * nodes) plus sensible defaults for new parts. Each op returns a fresh tree so
 * React state updates cleanly; the caller re-runs buildTree to recompute the
 * physics. Keeps App/PropertyPanel free of tree-walking bookkeeping.
 */
import type { ComponentNode, ComponentType, RocketTree } from '../engine/openRocketEngine';
import type { Component } from './componentDb';

let idCounter = 0;
/** A stable-ish unique id for a new node (readable: `<type>-<n>`). */
export function newId(type: string): string {
  idCounter += 1;
  return `${type}-${idCounter}`;
}

const clone = (tree: RocketTree): RocketTree => structuredClone(tree);

function* walk(nodes: ComponentNode[]): Generator<ComponentNode> {
  for (const n of nodes) {
    yield n;
    if (n.children) yield* walk(n.children);
  }
}

export function findNode(tree: RocketTree, id: string): ComponentNode | null {
  for (const n of walk(tree.components)) if (n.id === id) return n;
  return null;
}

export function updateNode(tree: RocketTree, id: string, patch: Partial<ComponentNode>): RocketTree {
  const next = clone(tree);
  for (const n of walk(next.components)) {
    if (n.id === id) {
      Object.assign(n, patch);
      break;
    }
  }
  return next;
}

export function removeNode(tree: RocketTree, id: string): RocketTree {
  const next = clone(tree);
  const rec = (nodes: ComponentNode[]): boolean => {
    const i = nodes.findIndex((n) => n.id === id);
    if (i >= 0) {
      nodes.splice(i, 1);
      return true;
    }
    for (const n of nodes) if (n.children && rec(n.children)) return true;
    return false;
  };
  rec(next.components);
  return next;
}

export function addChild(tree: RocketTree, parentId: string, node: ComponentNode): RocketTree {
  const next = clone(tree);
  for (const n of walk(next.components)) {
    if (n.id === parentId) {
      (n.children ??= []).push(node);
      break;
    }
  }
  return next;
}

/** The id of the first motor-mount node, for seating the motor. */
export function findMountId(tree: RocketTree): string | undefined {
  for (const n of walk(tree.components)) if (n.motorMount === true && typeof n.id === 'string') return n.id;
  return undefined;
}

/** All motor-mount nodes in tree order (first = primary). */
export function findMounts(tree: RocketTree): ComponentNode[] {
  const out: ComponentNode[] = [];
  for (const n of walk(tree.components)) if (n.motorMount === true && typeof n.id === 'string') out.push(n);
  return out;
}

/**
 * Whether a mount sits on a stage that has another stage BELOW it (a sustainer /
 * upper stage) — the only case where "ignite on the stage below's ejection /
 * burnout" can ever fire. False for a single (or implicit) stage and for the
 * bottom booster. Top-level `stage` nodes run desktop order: [0] = top
 * sustainer … [last] = bottom booster.
 */
export function isUpperStageMount(tree: RocketTree, mountId: string): boolean {
  const stages = tree.components.filter((n) => n.type === 'stage');
  if (stages.length < 2) return false; // one (or implicit) stage → nothing below any mount
  const bottom = stages[stages.length - 1]!;
  // A mount is an upper-stage mount unless it lives in the bottom stage's subtree.
  for (const n of walk([bottom])) if (n.id === mountId) return false;
  return true;
}

const AXIAL: ReadonlySet<string> = new Set(['nosecone', 'bodytube', 'transition']);
/** Axial components stack nose→tail in the stage; everything else nests inside a tube. */
export function isAxial(type: string): boolean {
  return AXIAL.has(type);
}

/**
 * Which child types each parent type may host (roughly OpenRocket's rules).
 * A parent absent from this map is a leaf — nothing can be added under it, so
 * the Add menu is empty when such a part is selected.
 */
export const ALLOWED_CHILDREN: Record<string, ComponentType[]> = {
  stage: ['nosecone', 'bodytube', 'transition'],
  nosecone: [
    'innertube',
    'tubecoupler',
    'centeringring',
    'bulkhead',
    'launchlug',
    'parachute',
    'streamer',
    'masscomponent',
  ],
  bodytube: [
    'trapezoidfinset',
    'ellipticalfinset',
    'freeformfinset',
    'tubefinset',
    'innertube',
    'tubecoupler',
    'centeringring',
    'bulkhead',
    'engineblock',
    'launchlug',
    'parachute',
    'streamer',
    'masscomponent',
  ],
  transition: [
    'trapezoidfinset',
    'ellipticalfinset',
    'freeformfinset',
    'innertube',
    'tubecoupler',
    'centeringring',
    'bulkhead',
    'launchlug',
    'parachute',
    'streamer',
    'masscomponent',
  ],
  innertube: ['engineblock', 'masscomponent'],
  tubecoupler: ['centeringring', 'bulkhead', 'masscomponent'],
};

/** Child types that may be added under a parent of `parentType` (empty for leaves). */
export function allowedChildren(parentType: string | undefined): ComponentType[] {
  return ALLOWED_CHILDREN[parentType ?? 'stage'] ?? [];
}

// Node types that can be picked from the parts catalog (componentDb types).
const CATALOG_TYPES: ReadonlySet<string> = new Set([
  'nosecone',
  'bodytube',
  'tubecoupler',
  'centeringring',
  'bulkhead',
  'parachute',
]);
export function hasCatalog(type: string): boolean {
  return CATALOG_TYPES.has(type);
}

// Node types that carry a bulk material (solid/structural parts, not recovery/mass).
const MATERIAL_TYPES: ReadonlySet<string> = new Set([
  'nosecone',
  'bodytube',
  'transition',
  'fairing',
  'trapezoidfinset',
  'ellipticalfinset',
  'freeformfinset',
  'tubefinset',
  'innertube',
  'tubecoupler',
  'centeringring',
  'bulkhead',
  'engineblock',
  'launchlug',
  'railbutton',
]);
export function hasMaterial(type: string): boolean {
  return MATERIAL_TYPES.has(type);
}

/** Map a chosen catalogue part onto a node patch (radii, length, material, …). */
export function catalogPatch(p: Component): Partial<ComponentNode> {
  const mat =
    'materialDensity' in p && p.materialDensity
      ? { density: p.materialDensity, materialName: (p as { material?: string }).material }
      : {};
  switch (p.type) {
    case 'nosecone':
      return {
        shape: p.shape,
        length: p.length,
        aftRadius: p.outerDiameter / 2,
        ...(p.filled ? { thickness: p.outerDiameter / 2 } : {}),
        ...mat,
      };
    case 'bodytube':
    case 'tubecoupler':
      return {
        outerRadius: p.outerDiameter / 2,
        length: p.length,
        ...(p.innerDiameter ? { thickness: Math.max(0.0001, (p.outerDiameter - p.innerDiameter) / 2) } : {}),
        ...mat,
      };
    case 'centeringring':
      return { outerRadius: p.outerDiameter / 2, innerRadius: (p.innerDiameter ?? 0) / 2, length: p.length, ...mat };
    case 'bulkhead':
      return { outerRadius: p.outerDiameter / 2, length: p.length, ...mat };
    case 'parachute':
      return { diameter: p.diameter, cd: p.cd ?? 0.8 };
  }
}

/** The node's index among its siblings and the sibling count (for move up/down). */
export function siblingIndex(tree: RocketTree, id: string): { index: number; count: number } | null {
  const rec = (nodes: ComponentNode[]): { index: number; count: number } | null => {
    const i = nodes.findIndex((n) => n.id === id);
    if (i >= 0) return { index: i, count: nodes.length };
    for (const n of nodes)
      if (n.children) {
        const r = rec(n.children);
        if (r) return r;
      }
    return null;
  };
  return rec(tree.components);
}

/** Move a node one slot earlier (dir -1) or later (dir +1) among its siblings. */
export function moveNode(tree: RocketTree, id: string, dir: -1 | 1): RocketTree {
  const next = clone(tree);
  const rec = (nodes: ComponentNode[]): boolean => {
    const i = nodes.findIndex((n) => n.id === id);
    if (i >= 0) {
      const j = i + dir;
      if (j >= 0 && j < nodes.length) {
        const [x] = nodes.splice(i, 1);
        nodes.splice(j, 0, x);
      }
      return true;
    }
    for (const n of nodes) if (n.children && rec(n.children)) return true;
    return false;
  };
  rec(next.components);
  return next;
}

/** A new node of `type` with reasonable default dimensions (SI units, m). */
export function defaultNode(type: ComponentType): ComponentNode {
  const id = newId(type);
  switch (type) {
    case 'nosecone':
      return { type, id, shape: 'ogive', length: 0.1, aftRadius: 0.013, thickness: 0.001 };
    case 'bodytube':
      return { type, id, length: 0.2, outerRadius: 0.013, thickness: 0.0005 };
    case 'transition':
      return { type, id, shape: 'conical', length: 0.05, foreRadius: 0.013, aftRadius: 0.019, thickness: 0.0005 };
    case 'trapezoidfinset':
      return {
        type,
        id,
        finCount: 3,
        rootChord: 0.06,
        tipChord: 0.03,
        sweep: 0.03,
        height: 0.05,
        thickness: 0.003,
        position: { method: 'bottom', offset: 0 },
      };
    case 'ellipticalfinset':
      return {
        type,
        id,
        finCount: 3,
        rootChord: 0.06,
        height: 0.05,
        thickness: 0.003,
        position: { method: 'bottom', offset: 0 },
      };
    // Freeform outline (m): a swept quad — root 0→0.06 along the body, tip at 0.05 height.
    case 'freeformfinset':
      return {
        type,
        id,
        finCount: 3,
        thickness: 0.003,
        points: [
          [0, 0],
          [0.02, 0.05],
          [0.05, 0.05],
          [0.06, 0],
        ],
        position: { method: 'bottom', offset: 0 },
      };
    case 'tubefinset':
      return {
        type,
        id,
        finCount: 6,
        length: 0.08,
        outerRadius: 0.012,
        thickness: 0.001,
        position: { method: 'bottom', offset: 0 },
      };
    case 'innertube':
      return {
        type,
        id,
        motorMount: true,
        length: 0.07,
        outerRadius: 0.0092,
        thickness: 0.0004,
        motorOverhang: 0.00635,
        position: { method: 'bottom', offset: 0 },
      };
    case 'tubecoupler':
      return {
        type,
        id,
        length: 0.03,
        outerRadius: 0.0125,
        thickness: 0.0005,
        position: { method: 'bottom', offset: 0 },
      };
    case 'centeringring':
      return {
        type,
        id,
        length: 0.003,
        outerRadius: 0.0125,
        innerRadius: 0.0092,
        position: { method: 'bottom', offset: 0 },
      };
    case 'bulkhead':
      return { type, id, length: 0.003, outerRadius: 0.0125, position: { method: 'bottom', offset: 0 } };
    case 'engineblock':
      return {
        type,
        id,
        length: 0.005,
        outerRadius: 0.0092,
        thickness: 0.0005,
        position: { method: 'bottom', offset: 0 },
      };
    case 'launchlug':
      return {
        type,
        id,
        length: 0.03,
        outerRadius: 0.0022,
        angleOffset: Math.PI,
        position: { method: 'middle', offset: 0 },
      };
    case 'parachute':
      return {
        type,
        id,
        diameter: 0.3,
        cd: 0.8,
        lineCount: 6,
        lineLength: 0.3,
        deployEvent: 'apogee',
        deployAltitude: 200,
        deployDelay: 0,
        position: { method: 'top', offset: 0.02 },
      };
    case 'streamer':
      return {
        type,
        id,
        stripLength: 0.4,
        stripWidth: 0.05,
        cd: 0.6,
        deployEvent: 'apogee',
        deployAltitude: 200,
        deployDelay: 0,
        position: { method: 'top', offset: 0.02 },
      };
    case 'masscomponent':
      return { type, id, mass: 0.01, length: 0.02, position: { method: 'top', offset: 0 } };
    default:
      return { type, id };
  }
}

/**
 * Add a new part of `type` as a child of the selected node (its parent), or of
 * the stage when nothing is selected. The Add menu only offers types valid for
 * that parent (see {@link allowedChildren}), so no re-parenting is needed.
 * Returns the new tree and the new node's id.
 */
export function addPart(
  tree: RocketTree,
  type: ComponentType,
  selectedId: string | null,
): { tree: RocketTree; id: string } {
  const node = defaultNode(type);
  const id = node.id!;
  const stageId = tree.components.find((n) => n.type === 'stage')?.id;
  const parentId = selectedId && findNode(tree, selectedId) ? selectedId : stageId;
  if (!parentId) {
    const next = clone(tree);
    next.components.push(node);
    return { tree: next, id };
  }
  return { tree: addChild(tree, parentId, node), id };
}
