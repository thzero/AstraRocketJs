/**
 * Pure, immutable helpers for editing a component tree (add / update / remove
 * nodes) plus sensible defaults for new parts. Each op returns a fresh tree so
 * React state updates cleanly; the caller re-runs buildTree to recompute the
 * physics. Keeps App/PropertyPanel free of tree-walking bookkeeping.
 */
import type { ComponentNode, ComponentType, RocketTree } from '../engine/openRocketEngine';
import type { Component } from './componentDb';
import { KERNEL_DEFAULTS } from '../tree/kernelDefaults.js';
import { isChainType } from '../tree/componentKinds';
import { uuid } from './uuid';

/**
 * A unique id for a new node.
 *
 * This was a module-scope counter minting `<type>-<n>`, which restarted at
 * zero on every page load while the persisted tree kept its ids. The second
 * session's first body tube got `bodytube-1` again, and every walker in this
 * file stops at the first match, so editing or deleting the new part edited
 * or deleted the old one. A UUID cannot collide across sessions.
 */
function newId(): string {
  return uuid();
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

/**
 * Patch one node, returning a new tree.
 *
 * Path-copies only the SPINE from the root to the patched node; every sibling
 * and untouched subtree is shared with the input. This runs on every keystroke
 * in the property panel, and it used to `structuredClone` the whole design
 * first, so typing a length into a hundred-part rocket serialized a hundred
 * parts per character. The contract is unchanged: the input tree is never
 * mutated, and the result is a distinct object even when `id` is not found.
 */
export function updateNode(tree: RocketTree, id: string, patch: Partial<ComponentNode>): RocketTree {
  let found = false;
  const rec = (nodes: ComponentNode[]): ComponentNode[] => {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      if (n.id === id) {
        found = true;
        const out = nodes.slice();
        out[i] = { ...n, ...patch };
        return out;
      }
      if (n.children) {
        const kids = rec(n.children);
        if (found) {
          const out = nodes.slice();
          out[i] = { ...n, children: kids };
          return out;
        }
      }
    }
    return nodes;
  };
  const components = rec(tree.components);
  return { ...tree, components };
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

/**
 * Axial components stack nose→tail in the stage; everything else nests inside
 * a tube. The one `CHAIN_TYPES` table (tree/componentKinds.ts), not a fourth
 * local copy of it.
 */
export function isAxial(type: string): boolean {
  return isChainType(type);
}

/**
 * Which child types each parent type may host (roughly OpenRocket's rules).
 * A parent absent from this map is a leaf — nothing can be added under it, so
 * the Add menu is empty when such a part is selected.
 */
const ALLOWED_CHILDREN: Record<string, ComponentType[]> = {
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
    'podset',
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
    'podset',
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
    'podset',
  ],
  innertube: ['engineblock', 'masscomponent'],
  tubecoupler: ['centeringring', 'bulkhead', 'masscomponent'],
  // A mass component hosts other INTERNAL components: an altimeter bay or a
  // payload sled with its rings, bulkheads and hardware nested inside it.
  //
  // The list mirrors the kernel's own rule (`MassComponent.isCompatible` takes
  // any `InternalComponent`) rather than a narrower one of our own. It has to:
  // the engine builds whatever tree it is handed, and a rule tighter than the
  // kernel's would reject a `.ork` the desktop writes happily. It was empty
  // until now because the extracted kernel carried a stale copy of
  // `MassComponent` that forbade children outright.
  masscomponent: [
    'innertube',
    'tubecoupler',
    'centeringring',
    'bulkhead',
    'engineblock',
    'parachute',
    'streamer',
    'shockcord',
    'masscomponent',
  ],
  // A PodSet hosts its own axial chain (a mini nose→body→transition stack),
  // just like a stage; the chain members then host fins / inner tubes / etc.
  podset: ['nosecone', 'bodytube', 'transition'],
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
  // NOT 'fairing'. It is modeled as a MassComponent whose mass is set outright
  // (ComponentFactory's fairing case calls setComponentMass), so a material
  // changes nothing the kernel flies; `writeFairing` has no <material> element
  // to put one in either, so the choice was dropped on the next save. It was
  // the one type for which picking a material did nothing and then forgot
  // itself. See `ork/materialRoundTrip.test.ts`, which holds every type in this
  // set to the opposite.
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

/** Map a chosen catalog part onto a node patch (radii, length, material, …). */
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

/**
 * The node's parent component, or null for a top-level node (a stage) or an
 * id that isn't in the tree.
 *
 * Tube fins need it: whether their tubes collide depends on the BODY radius
 * they ring, which lives on the parent, not on the fin set.
 */
export function findParent(tree: RocketTree, id: string): ComponentNode | null {
  // Boxed, because `null` is a legitimate ANSWER (a top-level node has no
  // parent) as well as the "keep looking" signal.
  const rec = (nodes: ComponentNode[], parent: ComponentNode | null): { parent: ComponentNode | null } | null => {
    for (const n of nodes) {
      if (n.id === id) return { parent };
      if (n.children) {
        const r = rec(n.children, n);
        if (r) return r;
      }
    }
    return null;
  };
  return rec(tree.components, null)?.parent ?? null;
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
        nodes.splice(j, 0, x!);
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
  const id = newId();
  switch (type) {
    // A bare stage: no parts yet (the user adds them). Seeded with the desktop-
    // default separation (used only when it sits below another stage).
    case 'stage':
      return { type, id, separationEvent: 'ejection', separationDelay: 0 };
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
        drogue: false,
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
        drogue: false,
        deployEvent: 'apogee',
        deployAltitude: 200,
        deployDelay: 0,
        position: { method: 'top', offset: 0.02 },
      };
    // `radius` is set EXPLICITLY rather than left to each side's own default.
    // Omitting it meant the kernel flew KERNEL_DEFAULTS.masscomponent.radius
    // while the schematic drew 70% of the parent radius.
    case 'masscomponent':
      return {
        type,
        id,
        mass: 0.01,
        length: 0.02,
        radius: KERNEL_DEFAULTS.masscomponent.radius,
        position: { method: 'top', offset: 0 },
      };
    // Rail buttons had no case at all, so the editor produced a bare
    // `{ type, id }`: flown at the kernel's 9.7 mm, drawn at 4 mm, and saved
    // as 9.7 mm by orkExport. Only the drawing was wrong, but nothing said so.
    case 'railbutton':
      return {
        type,
        id,
        outerDiameter: KERNEL_DEFAULTS.railbutton.outerDiameter,
        angleOffset: Math.PI,
        position: { method: 'middle', offset: 0 },
      };
    // An external pod: a mini body chain riding alongside the airframe. Seeded
    // with one slim body tube so it's visible and immediately editable.
    // radiusOffset 0 (relative) means the pod just touches the parent surface;
    // instanceCount 1 = a single pod (raise it for a symmetric ring).
    case 'podset': {
      const body = defaultNode('bodytube');
      body.length = 0.12;
      body.outerRadius = 0.009;
      return {
        type,
        id,
        instanceCount: 1,
        radiusOffset: 0,
        radiusMethod: 'relative',
        angleOffset: 0,
        position: { method: 'bottom', offset: 0 },
        children: [body],
      };
    }
    default:
      return { type, id };
  }
}

/** Top-level stage nodes, in desktop order ([0] = top sustainer … [last] = bottom booster). */
export function stageNodes(tree: RocketTree): ComponentNode[] {
  return tree.components.filter((n) => n.type === 'stage');
}

/** Whether `id` is the top stage — the one with nothing above it to separate from. */
export function isFirstStage(tree: RocketTree, id: string): boolean {
  const stages = stageNodes(tree);
  return stages.length > 0 && stages[0]!.id === id;
}

/**
 * Add a new empty stage as the bottom booster: a top-level sibling appended
 * after the existing stages. Named "Booster" for the second stage and "Stage N"
 * beyond, matching the "Sustainer" the base design ships with. Returns the new
 * tree and the new stage's id (so the caller can select it).
 */
export function addStage(tree: RocketTree): { tree: RocketTree; id: string } {
  const node = defaultNode('stage');
  const id = node.id!;
  const count = stageNodes(tree).length;
  node.name = count === 1 ? 'Booster' : `Stage ${count + 1}`;
  const next = clone(tree);
  next.components.push(node);
  return { tree: next, id };
}

/**
 * Add a new part of `type` under the selected node, or under the stage when
 * nothing is selected. Returns the new tree and the new node's id.
 *
 * {@link allowedChildren} is ENFORCED here, not only by the Add menu. The menu
 * offers valid types for the selected part, but this is the function every
 * caller goes through, and it used to trust `selectedId` outright: a part
 * added while a fin was selected went under the fin, a bulkhead added with the
 * stage selected went straight into the stage, and the kernel then built a
 * tree the desktop would never write. Now a selection that cannot host `type`
 * yields to its nearest ancestor that can (the fin's body tube), then to the
 * stage; a type not even the stage may host is a caller bug, and throws rather
 * than silently producing an invalid design.
 */
export function addPart(
  tree: RocketTree,
  type: ComponentType,
  selectedId: string | null,
  /** Merged onto the new node — the caller's per-part-type material defaults
   *  (`services/materials.defaultMaterialPatch`). Kept as a parameter rather
   *  than read here so this module stays a pure tree editor with no settings
   *  of its own. */
  seed: Partial<ComponentNode> = {},
): { tree: RocketTree; id: string } {
  const node = { ...defaultNode(type), ...seed };
  const id = node.id!;
  const stageId = tree.components.find((n) => n.type === 'stage')?.id;
  let host = selectedId ? findNode(tree, selectedId) : null;
  while (host && !allowedChildren(host.type).includes(type)) {
    host = host.id ? findParent(tree, host.id) : null;
  }
  if (host?.id) return { tree: addChild(tree, host.id, node), id };
  if (!stageId) {
    const next = clone(tree);
    next.components.push(node);
    return { tree: next, id };
  }
  if (!allowedChildren('stage').includes(type)) {
    throw new Error(`A ${type} cannot be added here: neither the selected part nor the stage may host it.`);
  }
  return { tree: addChild(tree, stageId, node), id };
}
