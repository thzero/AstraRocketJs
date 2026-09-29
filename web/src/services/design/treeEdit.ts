/**
 * Both derived-value passes, in the order they depend on each other: an
 * automatic diameter moves a tube's bore, and a shoulder follows that bore.
 *
 * Exported because it is the ONE choke point for it: any module that rewrites
 * the tree ends with this, or the values that follow a neighbor go stale until
 * some unrelated edit happens to fix them.
 */
export const syncDerived = (tree: RocketTree): RocketTree => syncAutoShoulders(syncAutoRadii(tree));

/**
 * Pure, immutable helpers for editing a component tree (add / update / remove
 * nodes) plus sensible defaults for new parts. Each op returns a fresh tree so
 * React state updates cleanly; the caller re-runs buildTree to recompute the
 * physics. Keeps App/PropertyPanel free of tree-walking bookkeeping.
 */
import type { ComponentNode, ComponentType, RocketTree } from '../../engine/openRocketEngine';
import type { Component } from '../parts/componentDb';
import { DEFAULT_CHUTE_CD } from '../parts/componentFilter';
import { KERNEL_DEFAULTS } from '../../tree/kernelDefaults.js';
import { isChainType } from '../../tree/componentKinds';
import { uuid } from '../app/uuid';
// Every mutator here ends by resolving the shoulders that follow a neighbor:
// this is the one door the tree is edited through, so nothing downstream has to
// know the feature exists.
import { syncAutoShoulders } from './autoShoulder';
import { syncAutoRadii } from './autoRadius';
import { FIELDS } from './componentFields';

/**
 * A unique id for a new node.
 *
 * A UUID, not a `<type>-<n>` counter: a module-scope counter restarts at zero on
 * every page load while the persisted tree keeps its ids, so the next session's
 * first body tube is `bodytube-1` again. Every walker in this file stops at the
 * first match, so editing or deleting the new part would hit the old one.
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
 * Does this edit make the part stop being the catalog part it came from?
 *
 * The kernel answers this by calling `clearPreset()` from the setters a preset
 * defines (`BodyTube.setOuterRadius`, `ExternalComponent.setMaterial`, and so
 * on). Here the FIELDS table is the same list: everything in a type's dimension
 * rows, plus the material, describes the part itself, while placement, motor
 * mount, comment, color and the overrides describe where it sits and how it is
 * accounted for.
 *
 * Deliberately conservative. Keeping a link that no longer matches would label a
 * hand-sized tube with somebody's part number; dropping one the desktop would
 * have kept costs nothing but the label.
 */
function breaksPreset(type: string, patch: Partial<ComponentNode>): boolean {
  if ('preset' in patch) return false; // the picker sets the link and the dimensions together
  const keys = Object.keys(patch);
  if (keys.some((k) => k === 'materialName' || k === 'density')) return true;
  const dimensions = new Set((FIELDS[type] ?? []).filter((f) => f.section === undefined).map((f) => f.key));
  return keys.some((k) => dimensions.has(k));
}

/**
 * Patch one node, returning a new tree.
 *
 * Path-copies only the SPINE from the root to the patched node; every sibling and
 * untouched subtree is shared with the input. This runs on every keystroke in the
 * property panel, so a `structuredClone` of the whole design would serialize a
 * hundred parts per character on a hundred-part rocket. The input tree is never
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
        const next = { ...n, ...patch };
        if (n['preset'] && breaksPreset(n.type, patch)) delete next['preset'];
        out[i] = next;
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
  return syncDerived({ ...tree, components });
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
  return syncDerived(next);
}

export function addChild(tree: RocketTree, parentId: string, node: ComponentNode): RocketTree {
  const next = clone(tree);
  for (const n of walk(next.components)) {
    if (n.id === parentId) {
      (n.children ??= []).push(node);
      break;
    }
  }
  return syncDerived(next);
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
 * Every recovery device in the design, in tree order.
 *
 * What a flight configuration's recovery overrides are keyed by, the way the
 * mounts are what its motors are keyed by. `recoveryDevices` answers the
 * narrower question the stage's own Recovery section asks.
 */
export function findRecoveryDevices(tree: RocketTree): ComponentNode[] {
  const out: ComponentNode[] = [];
  for (const n of walk(tree.components)) {
    if ((n.type === 'parachute' || n.type === 'streamer') && typeof n.id === 'string') out.push(n);
  }
  return out;
}

/**
 * Every stage in the design, in the order the KERNEL numbers them.
 *
 * Stage numbers are handed out as stages are added to the rocket, and the build
 * walks the tree depth-first, so this pre-order walk over stage and
 * parallel-stage nodes is that same order: index 0 is stage 0, the sustainer.
 * The `.ork` file numbers its `<stage number="n">` flags the same way, which is
 * why one walk answers for both.
 */
export function findStages(tree: RocketTree): ComponentNode[] {
  const out: ComponentNode[] = [];
  for (const n of walk(tree.components)) {
    if ((n.type === 'stage' || n.type === 'parallelstage') && typeof n.id === 'string') out.push(n);
  }
  return out;
}

/**
 * Every part that separates from what it is attached to, in tree order.
 *
 * The booster stages (every top-level stage but the first: the top one has
 * nothing above it to let go of) and every parallel booster. What a flight
 * configuration's separation overrides are keyed by.
 */
export function findSeparators(tree: RocketTree): ComponentNode[] {
  const out = tree.components.filter((n) => n.type === 'stage' && typeof n.id === 'string').slice(1);
  for (const n of walk(tree.components)) {
    if (n.type === 'parallelstage' && typeof n.id === 'string') out.push(n);
  }
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
  // kernel's would reject a `.ork` the desktop writes happily.
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

// Node types that can be picked from the parts catalog. Mostly componentDb's own
// types, plus `innertube`, which is served by the body tube rows: see
// componentDb.catalogTypeFor for why it has no catalog of its own.
const CATALOG_TYPES: ReadonlySet<string> = new Set([
  'nosecone',
  'bodytube',
  'innertube',
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

/**
 * The catalog link to record beside the dimensions a pick applies: which part
 * this component now IS, in the shape the `.ork` carries it
 * (`RocketComponentSaver`, `<preset type manufacturer partno>`).
 *
 * A part the user saved themselves is not in anybody's catalog, so it gets no
 * link: writing one would claim a manufacturer's part number for it.
 */
export function presetRef(p: Component): Partial<ComponentNode> {
  if (p.custom || !p.partNo) return { preset: undefined } as Partial<ComponentNode>;
  return {
    preset: { type: p.type, manufacturer: p.mfr, partNo: p.partNo },
  } as unknown as Partial<ComponentNode>;
}

/**
 * The automatic flag that governs each dimension a preset can state.
 *
 * Only the ones `syncAutoRadii` actually resolves. The kernel's own setters do
 * this - `RadiusRingComponent.setOuterRadius` and `BodyTube.setOuterRadius`
 * both clear `outerRadiusAutomatic` - and here it is what stops the resolver
 * overwriting the part you just picked on its next pass, which would read as
 * the picker doing nothing at all.
 */
const AUTO_FLAG_OF: Record<string, string> = {
  outerRadius: 'outerRadiusAuto',
  innerRadius: 'innerRadiusAuto',
  foreRadius: 'foreRadiusAuto',
  aftRadius: 'aftRadiusAuto',
  radius: 'radiusAuto',
};

/**
 * Turn the automatic flag off for every dimension the patch states outright,
 * unless the patch has an opinion about the flag itself - a saved part that was
 * stored AS automatic stays automatic.
 */
function pinStated(patch: Partial<ComponentNode>): Partial<ComponentNode> {
  const out: Record<string, unknown> = { ...patch };
  for (const [dim, flag] of Object.entries(AUTO_FLAG_OF)) {
    if (out[dim] !== undefined && out[flag] === undefined) out[flag] = false;
  }
  return out as Partial<ComponentNode>;
}

/**
 * Map a chosen catalog part onto a node patch (radii, length, material, …).
 *
 * The dimensions it states are PINNED as they are applied: a part picked for a
 * ring whose diameter is automatic would otherwise be undone by the resolver on
 * its next pass. That was unreachable while nothing started automatic; the four
 * bore-filling parts now do, as their kernel constructors do.
 */
export function catalogPatch(p: Component): Partial<ComponentNode> {
  return pinStated(statedPatch(p));
}

/** The dimensions the chosen part states, before {@link pinStated} pins them. */
function statedPatch(p: Component): Partial<ComponentNode> {
  // A SAVED part (customParts.ts) carries its whole node, not the handful of
  // dimensions a catalog row publishes, and applying only the switch below
  // would drop the nose cone's shoulder, the parachute's lines, the tube's
  // motor mount and the part's color: everything the user saved it FOR.
  // Copied, so the stored object cannot be mutated through the tree.
  if (p.custom && p.patch) return { ...p.patch };
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
      return { diameter: p.diameter, cd: p.cd ?? DEFAULT_CHUTE_CD };
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
  // Moving a part changes WHO its neighbors are, so a shoulder that follows one
  // has a new tube to follow.
  return syncDerived(next);
}

/** A new node of `type` with reasonable default dimensions (SI units, m). */
export function defaultNode(type: ComponentType): ComponentNode {
  const id = newId();
  switch (type) {
    // A bare stage: no parts yet (the user adds them). Seeded with the desktop-
    // default separation (used only when it sits below another stage).
    case 'stage':
      return { type, id, separationEvent: 'ejection', separationDelay: 0 };
    // The shoulder diameters follow the tube next door (see autoShoulder.ts).
    // Only on parts created HERE: the flag is never written by the .ork reader,
    // so no design that already exists grows a shoulder it did not have.
    case 'nosecone':
      return { type, id, shape: 'ogive', length: 0.1, aftRadius: 0.013, thickness: 0.001, shoulderAuto: true };
    case 'bodytube':
      return { type, id, length: 0.2, outerRadius: 0.013, thickness: 0.0005 };
    case 'transition':
      return {
        type,
        id,
        shape: 'conical',
        length: 0.05,
        foreRadius: 0.013,
        aftRadius: 0.019,
        thickness: 0.0005,
        foreShoulderAuto: true,
        aftShoulderAuto: true,
      };
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
    // The four parts that fill the bore of the tube they sit in start
    // AUTOMATIC, because that is what their kernel constructors do:
    // `TubeCoupler()`, `Bulkhead()` and `EngineBlock()` each call
    // `setOuterRadiusAutomatic(true)`, and `CenteringRing()` turns on both its
    // outer radius and its inner one. Without the flags a ring dropped into a
    // 54 mm airframe arrived sized for a 25 mm one and stayed that way until
    // someone noticed the checkbox, which is a wrong rocket that simulates
    // quietly. The radii below are still written, because the app keeps the
    // resolved number beside the flag rather than spelling auto as an absent
    // key (see services/design/autoRadius); `addPart` resolves them against the real
    // parent in the same edit.
    case 'tubecoupler':
      return {
        type,
        id,
        length: 0.03,
        outerRadius: 0.0125,
        outerRadiusAuto: true,
        thickness: 0.0005,
        position: { method: 'bottom', offset: 0 },
      };
    case 'centeringring':
      return {
        type,
        id,
        length: 0.003,
        outerRadius: 0.0125,
        outerRadiusAuto: true,
        // A ring's bore follows the motor mount running through it, and is 0
        // with no mount there - a solid disc, which is what the kernel gives
        // too (`CenteringRing.getInnerRadius` starts at 0 and takes the largest
        // InnerTube sibling it overlaps).
        innerRadius: 0.0092,
        innerRadiusAuto: true,
        position: { method: 'bottom', offset: 0 },
      };
    case 'bulkhead':
      return {
        type,
        id,
        length: 0.003,
        outerRadius: 0.0125,
        outerRadiusAuto: true,
        position: { method: 'bottom', offset: 0 },
      };
    case 'engineblock':
      return {
        type,
        id,
        length: 0.005,
        outerRadius: 0.0092,
        outerRadiusAuto: true,
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

/**
 * The recovery devices inside one stage, in tree order.
 *
 * What the stage's Recovery section chooses between: OpenRocket asks which
 * device in THIS stage is the drogue, so a chute in the booster is not on offer
 * when configuring the sustainer.
 */
export function recoveryDevices(tree: RocketTree, stageId: string): ComponentNode[] {
  const stage = findNode(tree, stageId);
  if (!stage?.children) return [];
  return [...walk(stage.children)].filter((n) => n.type === 'parachute' || n.type === 'streamer');
}

/**
 * Make ONE device in a stage the drogue, or none of them.
 *
 * The drogue flag is stored per device (`<isdrogue>` in the file), but it is a
 * property of the STAGE's recovery plan: single deployment is no drogue, dual
 * deployment is exactly one, and the desktop only ever sets it from the stage's
 * Recovery tab, clearing the rest of the stage first. Doing the same here is
 * what keeps a design out of the state OpenRocket's own UI cannot produce - two
 * drogues in one stage, which its warning code reads as whichever it walks into
 * first.
 *
 * Returns the same tree when nothing changes, so an undo step is only recorded
 * for a real edit.
 */
export function setStageDrogue(tree: RocketTree, stageId: string, deviceId: string | null): RocketTree {
  const wanted = new Map<string, boolean>();
  for (const d of recoveryDevices(tree, stageId)) {
    wanted.set(d.id as string, d.id === deviceId);
  }
  let next = tree;
  for (const [id, on] of wanted) {
    const node = findNode(next, id);
    if (!node) continue;
    if ((node['drogue'] === true) === on) continue;
    // `undefined` rather than `false`, so a single-deployment stage writes no
    // `<isdrogue>` at all, which is what the desktop's saver omits.
    next = updateNode(next, id, { drogue: on ? true : undefined } as Partial<ComponentNode>);
  }
  return next;
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
 * offers valid types for the selected part, but this is the function every caller
 * goes through, so trusting `selectedId` outright would put a part added while a
 * fin was selected under the fin and let the kernel build a tree the desktop
 * would never write. A selection that cannot host `type` yields to its nearest
 * ancestor that can (the fin's body tube), then to the stage; a type not even the
 * stage may host is a caller bug, and throws rather than silently producing an
 * invalid design.
 */
export function addPart(
  tree: RocketTree,
  type: ComponentType,
  selectedId: string | null,
  /** Merged onto the new node — the caller's per-part-type material defaults
   *  (`services/design/materialSlots.defaultMaterialPatch`). Kept as a parameter rather
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
    return { tree: syncDerived(next), id };
  }
  if (!allowedChildren('stage').includes(type)) {
    throw new Error(`A ${type} cannot be added here: neither the selected part nor the stage may host it.`);
  }
  return { tree: addChild(tree, stageId, node), id };
}
