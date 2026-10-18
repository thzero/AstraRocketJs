/**
 * Pure, immutable helpers for editing a component tree (add / update / remove
 * nodes) plus sensible defaults for new parts. Each op returns a fresh tree so
 * React state updates cleanly; the caller rebuilds the engine design from it to
 * recompute the physics. Keeps App/PropertyPanel free of tree-walking bookkeeping.
 */
import type { ComponentNode, ComponentType, RocketTree } from '../../engine/openRocketEngine';
import { defaultStageName } from './orkTree';
import type { Component, ParachuteComponent } from '../parts/componentDb';
import { DEFAULT_CHUTE_CD } from '../parts/componentFilter';
import { presetNode } from '../parts/customParts';
import { KERNEL_DEFAULTS, KERNEL_MATERIALS } from '../../tree/kernelDefaults.js';
import { COMPONENT_DEFAULTS } from './componentDefaults.js';
import { isChainType } from '../../tree/componentKinds';
import { uuid } from '../app/uuid';
import { isZero, mathEquals } from '../motors/mathEquals';
import { KeyedError } from '../../i18n/keyedError';
// Every mutator here ends by resolving the radii and shoulders that follow a
// neighbor (syncDerived): this is the one door the tree is edited through, so
// nothing downstream has to know the feature exists.
import { shoulderSeed, syncAutoShoulders } from './autoShoulder';
import { syncAutoRadii } from './autoRadius';
import {
  findNode as findNodeIn,
  findSiblings,
  findWithParent,
  mapTreePreserving,
  walkNodes,
} from '../../tree/treeWalk';
import { shapeChange } from '../../tree/shapeProfile';
import { num } from '../../tree/nodeProps';
import { clampToBounds, RING_BOUNDS } from './linkedDimensions';
import { repairNode } from './repairValues';

/**
 * Both derived-value passes, in the order they depend on each other: an
 * automatic diameter moves a tube's bore, and a shoulder follows that bore.
 *
 * Exported because it is the one choke point for it: any module that rewrites
 * the tree ends with this, or the values that follow a neighbor go stale until
 * some unrelated edit happens to fix them.
 */
export const syncDerived = (tree: RocketTree): RocketTree => syncAutoShoulders(syncAutoRadii(tree));

/**
 * A unique id for a new node.
 *
 * A UUID, not a `<type>-<n>` counter: a module-scope counter restarts at zero on
 * every page load while the persisted tree keeps its ids, so the next session's
 * first body tube would be `bodytube-1` again. Every walker in this file stops at
 * the first match, so editing or deleting the new part would hit the old one.
 */
function newId(): string {
  return uuid();
}

const clone = (tree: RocketTree): RocketTree => structuredClone(tree);

export function findNode(tree: RocketTree, id: string): ComponentNode | null {
  return findNodeIn(tree.components, id);
}

/** The bulk material, `ExternalComponent.setMaterial` and `StructuralComponent.setMaterial`. */
const BULK_MATERIAL = ['materialName', 'density'];
/** The canopy or strip, `RecoveryDevice.setMaterial`. */
const SURFACE_MATERIAL = ['surfaceMaterialName', 'surfaceDensity'];
/**
 * `Transition.setLength`, the two `set*Radius` and `set*RadiusAutomatic`,
 * `setShapeType`, `setShapeParameter`; `SymmetricComponent.setThickness` and
 * `setFilled`.
 */
const TAPER = ['length', 'shape', 'shapeParameter', 'aftRadius', 'aftRadiusAuto', 'thickness', 'filled'];
/** `RingComponent.setLength`, `ThicknessRingComponent.setOuterRadius` and `setThickness`. */
const THICKNESS_RING = ['length', 'outerRadius', 'thickness', ...BULK_MATERIAL];

/**
 * The node keys whose setter calls `clearPreset()`, per part type that can come
 * from the catalog, as the 24.12 release has them (`javap -c` on its
 * `rocketcomponent` classes); the kernel's setters agree on every key here.
 * Placement, deployment, packed size, a transition's `clipped`, the shoulder
 * lengths, walls and caps, a body tube's or launch lug's length and a
 * streamer's strip length all have setters that leave the preset in place, so
 * the link survives them. A nose cone's `flipped` does not:
 * `NoseCone.setFlipped` moves the base through `setForeRadius` and
 * `setAftRadius`, which clear it.
 */
const PRESET_SETTERS: Record<string, ReadonlySet<string>> = {
  nosecone: new Set([...TAPER, 'flipped', 'shoulderRadius', ...BULK_MATERIAL]),
  transition: new Set([
    ...TAPER,
    'foreRadius',
    'foreRadiusAuto',
    'foreShoulderRadius',
    'aftShoulderRadius',
    ...BULK_MATERIAL,
  ]),
  // BodyTube.setOuterRadius, setOuterRadiusAutomatic; SymmetricComponent.setThickness, setFilled.
  bodytube: new Set(['outerRadius', 'outerRadiusAuto', 'thickness', 'filled', ...BULK_MATERIAL]),
  innertube: new Set(THICKNESS_RING),
  tubecoupler: new Set(THICKNESS_RING),
  engineblock: new Set(THICKNESS_RING),
  // RingComponent.setLength, RadiusRingComponent.setOuterRadius and setInnerRadius.
  centeringring: new Set(['length', 'outerRadius', 'innerRadius', ...BULK_MATERIAL]),
  // The same, with Bulkhead.setOuterRadiusAutomatic.
  bulkhead: new Set(['length', 'outerRadius', 'outerRadiusAuto', ...BULK_MATERIAL]),
  // LaunchLug.setOuterRadius and setThickness.
  launchlug: new Set(['outerRadius', 'thickness', ...BULK_MATERIAL]),
  railbutton: new Set([
    'outerDiameter',
    'innerDiameter',
    'height',
    'baseHeight',
    'flangeHeight',
    'screwHeight',
    ...BULK_MATERIAL,
  ]),
  // Parachute.setDiameter and setLineCount, RecoveryDevice.setCD.
  parachute: new Set(['diameter', 'lineCount', 'cd', ...SURFACE_MATERIAL]),
  // Streamer.setStripWidth (and setArea, setAspectRatio, which the derived
  // rows write as a width), RecoveryDevice.setCD.
  streamer: new Set(['stripWidth', 'cd', ...SURFACE_MATERIAL]),
};

/** `Parachute.setLineLength` and `setLineMaterial` clear the link only on a chute that has lines. */
const PARACHUTE_LINE_KEYS = ['lineLength', 'lineMaterialName', 'lineDensity'];

/** Whether a setter would see a new value: `MathUtil.equals` for a number, as the kernel's setters compare. */
const differs = (a: unknown, b: unknown): boolean =>
  typeof a === 'number' && typeof b === 'number' ? !mathEquals(a, b) : a !== b;

/**
 * Does this edit make the part stop being the catalog part it came from?
 *
 * The kernel answers this by calling `clearPreset()` from some of its setters,
 * and {@link PRESET_SETTERS} is that list keyed by node key, so a design keeps
 * or drops its `<preset>` exactly where the desktop would. A setter returns
 * before `clearPreset()` when the value is unchanged, so only a key whose value
 * changes counts. `before` is the node as it was and `after` the node with
 * the edit and everything it brings: a shoulder length grown from or set back
 * to 0 sets the shoulder radius through its own setter, which clears the link
 * when that radius changes.
 */
function breaksPreset(before: ComponentNode, after: ComponentNode, patch: Partial<ComponentNode>): boolean {
  if ('preset' in patch) return false; // the picker sets the link and the dimensions together
  const changed = (k: string) => differs(before[k], after[k]);
  const setters = PRESET_SETTERS[before.type];
  if (setters && [...setters].some(changed)) return true;
  if (before.type !== 'parachute') return false;
  const lines = after['lineCount'] as number | undefined;
  return lines !== 0 && PARACHUTE_LINE_KEYS.some(changed);
}

/**
 * Would {@link updateNode} change anything?
 *
 * `updateNode` always returns a fresh tree (it cannot cheaply know otherwise,
 * because it path-copies the spine as it walks), and `tree.components` is the
 * rebuild dependency, so a value-identical patch costs a full kernel build. The
 * property panel fires one patch per keystroke with the already-clamped value, so
 * typing past a ceiling fires N identical patches, N kernel builds and an undo
 * step that changes nothing.
 *
 * Shallow `!==` per key, which is the comparison `updateNode` itself makes when it
 * spreads the patch. A patch whose every value matches cannot drop the preset
 * link either, since only a changed value clears it.
 */
export function patchChangesNode(tree: RocketTree, id: string, patch: Partial<ComponentNode>): boolean {
  const node = findNode(tree, id);
  if (!node) return false;
  const current = node as unknown as Record<string, unknown>;
  const incoming = patch as unknown as Record<string, unknown>;
  for (const key of Object.keys(incoming)) {
    if (current[key] !== incoming[key]) return true;
  }
  return false;
}

/**
 * Patch one node, returning a new tree.
 *
 * Path-copies only the spine from the root to the patched node; every sibling and
 * untouched subtree is shared with the input. This runs on every keystroke in the
 * property panel, so a `structuredClone` of the whole design would serialize a
 * hundred parts per character on a hundred-part rocket. The input tree is never
 * mutated, and the result is a distinct object even when `id` is not found.
 */
export function updateNode(tree: RocketTree, id: string, patch: Partial<ComponentNode>): RocketTree {
  let found = false;
  let before = undefined as ComponentNode | undefined;
  const rec = (nodes: ComponentNode[]): ComponentNode[] => {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      if (n.id === id) {
        found = true;
        before = n;
        const out = nodes.slice();
        const patched = { ...n, ...patch };
        // A shoulder length set from or back to 0 brings its wall, radius and
        // cap with it, as desktop's setter does.
        const next = { ...patched, ...shoulderSeed(n, patched, patch, tree.components) };
        if (n['preset'] && breaksPreset(n, next, patch)) delete next['preset'];
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
  const synced = syncDerived({ ...tree, components });
  return before?.['preset'] && !('preset' in patch) ? unlinkMovedShoulder(synced, id, before) : synced;
}

/** Every shoulder radius a nose cone or transition has. */
const SHOULDER_RADII = ['shoulderRadius', 'foreShoulderRadius', 'aftShoulderRadius'];

/**
 * Drop the catalog link of the part `id` when the edit moved a shoulder's
 * radius by way of the radii that follow a neighbor: an automatic shoulder
 * turned on takes the neighbor's bore, and on the desktop that radius arrives
 * through `setShoulderRadius`, which clears the preset when it changes.
 */
function unlinkMovedShoulder(tree: RocketTree, id: string, before: ComponentNode): RocketTree {
  const after = findNode(tree, id);
  if (!after?.['preset'] || !SHOULDER_RADII.some((k) => differs(before[k], after[k]))) return tree;
  const components = mapTreePreserving(
    tree.components,
    (n) => {
      if (n.id !== id) return n;
      const out = { ...n };
      delete out['preset'];
      return out;
    },
    'pre',
  );
  return { ...tree, components };
}

export function removeNode(tree: RocketTree, id: string): RocketTree {
  const next = clone(tree);
  const hit = findSiblings(next.components, id);
  if (hit) hit.siblings.splice(hit.index, 1);
  return syncDerived(next);
}

export function addChild(tree: RocketTree, parentId: string, node: ComponentNode): RocketTree {
  const next = clone(tree);
  const parent = findNodeIn(next.components, parentId);
  if (parent) (parent.children ??= []).push(node);
  return syncDerived(next);
}

/** All motor-mount nodes in tree order (first = primary). */
export function findMounts(tree: RocketTree): ComponentNode[] {
  const out: ComponentNode[] = [];
  for (const n of walkNodes(tree.components)) if (n.motorMount === true && typeof n.id === 'string') out.push(n);
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
  for (const n of walkNodes(tree.components)) {
    if (isRecoveryDevice(n.type) && typeof n.id === 'string') out.push(n);
  }
  return out;
}

/**
 * Every stage in the design, in the order the kernel numbers them.
 *
 * Stage numbers are handed out as stages are added to the rocket, and the build
 * walks the tree depth-first, so this pre-order walk over stage and
 * parallel-stage nodes is that same order: index 0 is stage 0, the sustainer.
 * The `.ork` file numbers its `<stage number="n">` flags the same way, which is
 * why one walk answers for both.
 */
export function findStages(tree: RocketTree): ComponentNode[] {
  const out: ComponentNode[] = [];
  for (const n of walkNodes(tree.components)) {
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
  const out = stageNodes(tree)
    .filter((n) => typeof n.id === 'string')
    .slice(1);
  for (const n of walkNodes(tree.components)) {
    if (n.type === 'parallelstage' && typeof n.id === 'string') out.push(n);
  }
  return out;
}

/**
 * Axial components stack nose→tail in the stage; everything else nests inside
 * a tube. The one `CHAIN_TYPES` table (tree/componentKinds.ts), not a local
 * copy of it.
 */
export function isAxial(type: string): boolean {
  return isChainType(type);
}

/*
 * Which part may sit inside which: the kernel's `isCompatible` rules, by the
 * class each type is built as. The kernel's `addChild` throws for any other
 * pair, so a looser rule here is a design that fails to build, and a tighter
 * one rejects a `.ork` desktop writes.
 */
/** InternalComponent: rings, tubes inside the airframe, recovery and mass. A
 *  `fairing` is built as a mass component, so it counts here. */
const INTERNAL: ReadonlySet<string> = new Set([
  'innertube',
  'tubecoupler',
  'centeringring',
  'bulkhead',
  'engineblock',
  'parachute',
  'streamer',
  'shockcord',
  'masscomponent',
  'fairing',
]);
/** BodyComponent: the airframe chain. */
const BODY: ReadonlySet<string> = new Set(['nosecone', 'bodytube', 'transition']);
/** ExternalComponent that is not a BodyComponent: fins, lugs and buttons. */
const ON_BODY: ReadonlySet<string> = new Set([
  'trapezoidfinset',
  'ellipticalfinset',
  'freeformfinset',
  'tubefinset',
  'launchlug',
  'railbutton',
]);
const ALL_TYPES: readonly ComponentType[] = [
  'stage',
  ...BODY,
  ...ON_BODY,
  ...INTERNAL,
  'podset',
  'parallelstage',
] as ComponentType[];

/**
 * Whether a part of `childType` may sit directly inside one of `parentType`.
 * `'rocket'` is the design itself, whose children are the stages.
 */
export function canHost(parentType: string, childType: string): boolean {
  switch (parentType) {
    case 'rocket':
      return childType === 'stage';
    case 'stage':
    case 'parallelstage':
    case 'podset':
      return BODY.has(childType);
    case 'bodytube':
      return (
        childType === 'podset' || childType === 'parallelstage' || INTERNAL.has(childType) || ON_BODY.has(childType)
      );
    // Transition.isCompatible, which the nose cone inherits: internal parts and
    // freeform fins only. Trapezoidal and elliptical fins, lugs and pods are
    // refused, because their geometry assumes a straight tube.
    case 'transition':
    case 'nosecone':
      return INTERNAL.has(childType) || childType === 'freeformfinset';
    case 'innertube':
    case 'tubecoupler':
    case 'masscomponent':
      return INTERNAL.has(childType);
    default:
      return false;
  }
}

/** Child types that may sit under a parent of `parentType` (empty for leaves). */
export function allowedChildren(parentType: string | undefined): ComponentType[] {
  const parent = parentType ?? 'stage';
  return ALL_TYPES.filter((type) => canHost(parent, type));
}

// Node types that can be picked from the parts catalog. Mostly componentDb's own
// types, plus `innertube`, which is served by the body tube rows: see
// componentDb.catalogTypeFor for why it has no catalog of its own.
const CATALOG_TYPES: ReadonlySet<string> = new Set([
  'nosecone',
  'bodytube',
  'transition',
  'innertube',
  'tubecoupler',
  'centeringring',
  'bulkhead',
  'engineblock',
  'launchlug',
  'parachute',
  'streamer',
  'railbutton',
]);
export function hasCatalog(type: string): boolean {
  return CATALOG_TYPES.has(type);
}

// Node types that carry a bulk material (solid/structural parts, not recovery/mass).
const MATERIAL_TYPES: ReadonlySet<string> = new Set([
  'nosecone',
  'bodytube',
  'transition',
  // Not 'fairing'. It is modeled as a MassComponent whose mass is set outright
  // (ComponentFactory's fairing case calls setComponentMass), so a material
  // changes nothing the kernel flies, and `writeFairing` has no <material>
  // element to put one in, so the choice would be dropped on the next save.
  // `ork/materialRoundTrip.test.ts` holds every type in this set to a material
  // that survives the round trip.
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

/** A part that deploys during the flight: a parachute or a streamer. */
export function isRecoveryDevice(type: string): boolean {
  return type === 'parachute' || type === 'streamer';
}

/**
 * The catalog link to record beside the dimensions a pick applies: which part
 * this component now is, in the shape the `.ork` carries it
 * (`RocketComponentSaver`, `<preset type manufacturer partno>`).
 *
 * A part the user saved themselves is not in anybody's catalog, so it gets no
 * link: writing one would claim a manufacturer's part number for it.
 */
export function presetRef(p: Component): Partial<ComponentNode> {
  if (p.custom || !p.partNo) return { preset: undefined };
  return {
    preset: presetLink(p.type, p.mfr, p.partNo, (p as { digest?: string }).digest),
  };
}

/**
 * The `preset` value a catalog part writes onto a node. The digest is left off
 * when there is none: the desktop rejects a link with no checksum, so writing
 * an empty one would cost the reader a warning dialog and buy nothing.
 */
export function presetLink(type: string, manufacturer: string, partNo: string, digest: string | undefined) {
  return { type, manufacturer, partNo, ...(digest ? { digest } : {}) };
}

/**
 * The automatic flag that governs each dimension a preset can state.
 *
 * Only the ones `syncAutoRadii` actually resolves. The kernel's own setters do
 * this (`RadiusRingComponent.setOuterRadius` and `BodyTube.setOuterRadius`
 * both clear `outerRadiusAutomatic`), and here it is what stops the resolver
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
 * unless the patch has an opinion about the flag itself: a saved part that was
 * stored as automatic stays automatic.
 */
function pinStated(patch: Partial<ComponentNode>): Partial<ComponentNode> {
  const out: Record<string, unknown> = { ...patch };
  for (const [dim, flag] of Object.entries(AUTO_FLAG_OF)) {
    if (out[dim] !== undefined && out[flag] === undefined) out[flag] = false;
  }
  return out;
}

/**
 * Map a chosen catalog part onto a node patch (radii, length, material, …).
 *
 * The dimensions it states are pinned as they are applied: a part picked for a
 * ring whose diameter is automatic would otherwise be undone by the resolver on
 * its next pass. The four bore-filling parts start automatic, as their kernel
 * constructors do.
 */
export function catalogPatch(p: Component, node?: ComponentNode): Partial<ComponentNode> {
  return pinStated(statedPatch(p, node));
}

/**
 * A wall for a cone the catalog calls hollow but states no wall for.
 *
 * The row publishes `filled` and an outside diameter and nothing else, so a
 * hollow part has to inherit a wall from somewhere. The node's own is the right
 * answer when it is a wall: picking a different hollow cone should not throw
 * away a thickness that was typed for this airframe. It is the wrong answer
 * when the part being replaced was solid, because its "wall" is its whole
 * radius, and carried onto a hollow part it keeps the cone solid at the new
 * part's dimensions: a nose cone still flying several times its real mass.
 */
function hollowWall(node: ComponentNode | undefined, radius: number): Partial<ComponentNode> {
  const n = node as Record<string, unknown> | undefined;
  const wall = typeof n?.['thickness'] === 'number' ? n['thickness'] : null;
  const wasSolid = n?.['filled'] === true || wall == null || wall >= radius;
  return wasSolid ? { thickness: KERNEL_DEFAULTS.nosecone.thickness } : {};
}

/**
 * A shoulder a catalog part states, as `Transition.loadFromPreset` applies it:
 * its radius and length, replacing the one that follows the neighboring tube,
 * and solid on a filled part. `side` is '' for a nose cone's one shoulder,
 * 'fore' or 'aft' for a transition's, and `end` the radius of the end it plugs.
 *
 * The radius is held to that end, as the 24.12 release's
 * `setAftShoulderRadius(double)` and `setForeShoulderRadius(double)` clamp it
 * to `getAftRadius()` and `getForeRadius()` (a nose cone's to its base, which
 * `NoseCone.loadFromPreset` loads unflipped). A filled part's shoulder wall is
 * half the stated diameter, unclamped, as that release sets it.
 *
 * A hollow part's stated wall is the kernel's rule: its `loadFromPreset` gives
 * both shoulders the part's wall, where 24.12 leaves the shoulder walls alone.
 *
 * The cap is left as the part had it: the 24.12 release's `loadFromPreset` and
 * shoulder length setters never touch it. A part with no shoulder before the
 * pick is stated uncapped, as a new part is, because the length edit's own
 * seeding (`shoulderSeed`) would otherwise cap it, and `ComponentPresetFactory`
 * measures the volume a stated mass is spread over on that uncapped part, so a
 * capped pick would fly heavier than the catalog states.
 *
 * Only a stated shoulder diameter applies anything here. The kernel also gives
 * both shoulders a stated wall when the row states no shoulder diameter; no
 * shipped row is hollow with a wall and without a shoulder diameter.
 */
function presetShoulder(
  side: '' | 'fore' | 'aft',
  diameter: number | null,
  length: number | null,
  end: number,
  p: { filled?: boolean; thickness?: number | null },
  node: ComponentNode | undefined,
): Partial<ComponentNode> {
  if (diameter == null) return {};
  const key = (k: string) => (side ? `${side}${k}` : k.charAt(0).toLowerCase() + k.slice(1));
  const radius = Math.min(diameter / 2, end);
  const wall = p.filled ? diameter / 2 : p.thickness;
  const hadShoulder = node !== undefined && !isZero(num(node, key('ShoulderLength'), 0));
  return {
    [key('ShoulderAuto')]: false,
    [key('ShoulderRadius')]: radius,
    ...(hadShoulder ? {} : { [key('ShoulderCapped')]: false }),
    ...(length == null ? {} : { [key('ShoulderLength')]: length }),
    ...(wall == null ? {} : { [key('ShoulderThickness')]: wall }),
  };
}

/** A new parachute's shroud line count, `Parachute.DEFAULT_LINE_COUNT`. */
const DEFAULT_LINE_COUNT = 6;

/**
 * A catalog parachute as `Parachute.loadFromPreset` applies it. Everything the
 * part leaves unstated goes back to a new parachute's value rather than keeping
 * the replaced part's: the name to the type's own, the drag coefficient to
 * automatic, six lines of 0.3 m, the default canopy and line materials, and no
 * mass override. A stated description becomes the part's name. The packed
 * length and diameter are set only where stated, and with both stated the
 * packed radius follows the parent's bore. The stated pair is written as is:
 * `syncAutoRadii` then resizes it to the bore at the volume the pair packs.
 */
function parachutePatch(p: ParachuteComponent): Partial<ComponentNode> {
  const packedLength = p.packedLength ?? null;
  const packedDiameter = p.packedDiameter ?? null;
  return {
    name: p.desc ? p.desc : undefined,
    diameter: p.diameter,
    cd: p.cd ?? DEFAULT_CHUTE_CD,
    cdAuto: p.cd == null,
    lineCount: p.lineCount ?? DEFAULT_LINE_COUNT,
    lineLength: p.lineLength ?? KERNEL_DEFAULTS.parachute.lineLength,
    lineLengthAuto: false,
    surfaceMaterialName: p.material ?? KERNEL_MATERIALS.surface.name,
    surfaceDensity: p.materialDensity ?? KERNEL_MATERIALS.surface.density,
    lineMaterialName: p.lineMaterial ?? KERNEL_MATERIALS.line.name,
    lineDensity: p.lineMaterialDensity ?? KERNEL_MATERIALS.line.density,
    ...(packedLength != null ? { length: packedLength } : {}),
    ...(packedDiameter != null ? { radius: packedDiameter / 2, radiusAuto: packedLength != null } : {}),
    overrideMass: p.mass != null && p.mass > 0 ? p.mass : undefined,
  };
}

/** The dimensions the chosen part states, before {@link pinStated} pins them. */
function statedPatch(p: Component, node?: ComponentNode): Partial<ComponentNode> {
  // A saved part (customParts.ts) carries its whole node, not the handful of
  // dimensions a catalog row publishes, and applying only the switch below
  // would drop the nose cone's shoulder, the parachute's lines, the tube's
  // motor mount and the part's color: everything the user saved it for.
  // Copied, so the stored object cannot be mutated through the tree, and
  // without the keys a saved part never keeps: a stored entry is read back
  // from the browser's storage, and an id, type or children in it would
  // duplicate an id or turn the node into another part.
  // Repaired as a design loaded from storage is: the stored entry has not been
  // through the editor's limits since it was written.
  if (p.custom && p.patch) return presetNode(repairNode(p.patch as ComponentNode).node);
  const mat =
    'materialDensity' in p && p.materialDensity
      ? { density: p.materialDensity, materialName: (p as { material?: string }).material }
      : {};
  switch (p.type) {
    case 'nosecone': {
      const radius = p.outerDiameter / 2;
      // NoseCone.loadFromPreset: the stated wall, else the one the part had. A
      // part that states a mass has its density computed on the wall it states
      // or, stating none, on a new part's (SymmetricComponent.DEFAULT_THICKNESS),
      // so it takes that wall to weigh what the catalog says.
      const wall = p.filled
        ? { thickness: radius }
        : p.thickness != null
          ? { thickness: p.thickness }
          : p.mass != null
            ? { thickness: KERNEL_DEFAULTS.nosecone.thickness }
            : hollowWall(node, radius);
      return {
        ...shapeChange('nosecone', p.shape),
        length: p.length,
        aftRadius: radius,
        // Said outright, both ways. The kernel reads solidness from this flag
        // (`ComponentFactory` calls `setFilled`), not from the thickness, so
        // leaving it alone would let the part before this one decide: a solid
        // cone followed by a hollow one would go on flying solid, at the hollow
        // one's dimensions, and the `.ork` would go on saying `<thickness>filled`.
        filled: !!p.filled,
        ...wall,
        ...presetShoulder('', p.shoulderDiameter ?? null, p.shoulderLength ?? null, radius, p, node),
        ...mat,
      };
    }
    // BodyTube and ThicknessRingComponent.loadFromPreset: the outer radius, and
    // the wall the two diameters leave whenever the part states an inner
    // diameter. A stated 0 is a solid part (the Estes balsa nose blocks), not a
    // missing one: its wall is its whole radius.
    case 'bodytube':
    case 'tubecoupler':
    case 'engineblock':
    case 'launchlug':
      return {
        outerRadius: p.outerDiameter / 2,
        length: p.length,
        ...(p.innerDiameter != null ? { thickness: Math.max(0.0001, (p.outerDiameter - p.innerDiameter) / 2) } : {}),
        ...mat,
      };
    // RadiusRingComponent.loadFromPreset: the bore is pinned either way, and
    // takes the part's inner diameter only when it states one, so a row with no
    // inner diameter keeps the bore the ring had. Either bore is held inside the
    // new outer radius, as the panel holds a typed one: a few catalog rows state
    // an inner diameter above the outer.
    case 'centeringring': {
      const outerRadius = p.outerDiameter / 2;
      const kept = typeof node?.['innerRadius'] === 'number' ? node['innerRadius'] : null;
      const bore = p.innerDiameter != null ? p.innerDiameter / 2 : kept != null && kept > outerRadius ? kept : null;
      return {
        outerRadius,
        ...(bore != null
          ? { innerRadius: clampToBounds({ outerRadius } as unknown as ComponentNode, RING_BOUNDS.innerRadius, bore) }
          : {}),
        innerRadiusAuto: false,
        length: p.length,
        ...mat,
      };
    }
    case 'bulkhead':
      return { outerRadius: p.outerDiameter / 2, length: p.length, ...mat };
    case 'parachute':
      return parachutePatch(p);
    // Transition.loadFromPreset: both ends pinned, the shoulders as stated, and
    // a filled part's shoulders solid too. A stated shoulder replaces the one
    // that follows the neighboring tube.
    case 'transition': {
      const shoulder = (side: 'fore' | 'aft', diameter: number | null, length: number | null) =>
        presetShoulder(
          side,
          diameter,
          length,
          (side === 'fore' ? p.foreOuterDiameter : p.aftOuterDiameter) / 2,
          p,
          node,
        );
      return {
        ...shapeChange('transition', p.shape),
        length: p.length,
        foreRadius: p.foreOuterDiameter / 2,
        aftRadius: p.aftOuterDiameter / 2,
        filled: !!p.filled,
        ...(p.thickness != null && !p.filled ? { thickness: p.thickness } : {}),
        ...shoulder('fore', p.foreShoulderDiameter, p.foreShoulderLength),
        ...shoulder('aft', p.aftShoulderDiameter, p.aftShoulderLength),
        ...mat,
      };
    }
    // RailButton.loadFromPreset: the button's geometry; the button, screw and
    // nut masses together as its mass override, and a stated positive drag
    // coefficient as its drag override. An override the part does not state is
    // left as it was.
    case 'railbutton':
      return {
        outerDiameter: p.outerDiameter,
        height: p.height,
        ...(p.innerDiameter != null ? { innerDiameter: p.innerDiameter } : {}),
        ...(p.baseHeight != null ? { baseHeight: p.baseHeight } : {}),
        ...(p.flangeHeight != null ? { flangeHeight: p.flangeHeight } : {}),
        ...(p.screwHeight != null ? { screwHeight: p.screwHeight } : {}),
        ...(p.mass != null ? { overrideMass: p.mass } : {}),
        ...(p.cd != null && p.cd > 0 ? { overrideCD: p.cd } : {}),
        ...mat,
      };
    // Streamer.loadFromPreset: the strip, its surface material (the default
    // one when the part states none, `RecoveryDevice.loadFromPreset`), the drag
    // coefficient left for the kernel to work out from them, and the packed
    // length set to the strip width.
    case 'streamer':
      return {
        stripLength: p.stripLength,
        stripWidth: p.stripWidth,
        length: p.stripWidth,
        ...(p.materialDensity
          ? { surfaceMaterialName: p.material, surfaceDensity: p.materialDensity }
          : { surfaceMaterialName: KERNEL_MATERIALS.surface.name, surfaceDensity: KERNEL_MATERIALS.surface.density }),
        cdAuto: true,
      };
  }
}

/** The node's index among its siblings and the sibling count (for move up/down). */
export function siblingIndex(tree: RocketTree, id: string): { index: number; count: number } | null {
  const hit = findSiblings(tree.components, id);
  return hit ? { index: hit.index, count: hit.siblings.length } : null;
}

/**
 * The node's parent component, or null for a top-level node (a stage) or an
 * id that isn't in the tree.
 *
 * Tube fins need it: whether their tubes collide depends on the body radius
 * they ring, which lives on the parent, not on the fin set.
 */
export function findParent(tree: RocketTree, id: string): ComponentNode | null {
  return findWithParent(tree.components, id)?.parent ?? null;
}

/** Move a node one slot earlier (dir -1) or later (dir +1) among its siblings. */
export function moveNode(tree: RocketTree, id: string, dir: -1 | 1): RocketTree {
  // At either end of its siblings, or not in the tree, the part has nowhere to
  // go: the same tree comes back, so the caller can tell nothing changed.
  const at = findSiblings(tree.components, id);
  if (!at || at.index + dir < 0 || at.index + dir >= at.siblings.length) return tree;
  const next = clone(tree);
  const { siblings, index } = findSiblings(next.components, id)!;
  const [x] = siblings.splice(index, 1);
  siblings.splice(index + dir, 0, x!);
  // Moving a part changes who its neighbors are, so a shoulder that follows one
  // has a new tube to follow.
  return syncDerived(next);
}

/**
 * A new node of `type`: the part desktop OpenRocket adds, which is the part its
 * Java constructor builds (SI units, m, kg, rad). Every dimension, count and
 * automatic setting below is the constructor's, read from
 * `engine-java/src/java/info/openrocket/core/rocketcomponent/<Type>.java`, and
 * `tests/services/design/newParts.kernel.test.ts` holds each case to the part
 * the kernel builds from a node with no keys at all.
 *
 * The seeds that are the app's own, not the constructor's, and why:
 * - `shoulderAuto`, `foreShoulderAuto`, `aftShoulderAuto`: app-only flags
 *   (services/design/autoShoulder) that the kernel never reads; the kernel part
 *   has no shoulder either way.
 * - inner tube `motorMount: true` and `motorOverhang: 0.00635`: the run
 *   refuses a design with no mount (services/flight/runnability, `noMount`),
 *   so the Add menu's inner tube is one, with the 6.35 mm overhang the motor
 *   picker's fit filter assumes (services/motors/motorPicker). `InnerTube()`
 *   is not a mount and has no overhang.
 * - parachute and streamer `deployEvent: 'apogee'`: the constructor's
 *   `DeploymentConfiguration` fires on the motor's ejection charge. The app
 *   seats a motor in an empty mount for the run (services/flight/flightConfigs,
 *   `reconcileConfig`), so that charge's delay is not one the user chose;
 *   apogee deploys at the same point whichever motor is seated.
 * - booster (`parallelstage`) children: `ParallelStage()` is empty; the seed
 *   holds one slim body tube so the booster is visible and has something to add
 *   fins and a motor mount to. Its own fields are the constructor's.
 * - rail button: desktop's `RailButton()` dimensions, stated on the node from
 *   `COMPONENT_DEFAULTS` because the bridge reads them one by one.
 */
export function defaultNode(type: ComponentType): ComponentNode {
  const id = newId();
  switch (type) {
    // A bare stage: no parts yet (the user adds them). Seeded with the desktop-
    // default separation (used only when it sits below another stage).
    case 'stage':
      return { type, id, separationEvent: 'ejection', separationDelay: 0 };
    // `NoseCone()` (NoseCone.java:27, 34): ogive, 6 x DEFAULT_RADIUS long, a
    // DEFAULT_RADIUS base, a 2 mm wall. The shoulder diameter follows the tube
    // next door (see autoShoulder.ts). Only on parts created here: the flag is
    // never written by the .ork reader, so no design that already exists grows
    // a shoulder it did not have.
    case 'nosecone':
      return { type, id, shape: 'ogive', length: 0.15, aftRadius: 0.025, thickness: 0.002, shoulderAuto: true };
    // A new body tube and both ends of a new transition follow their
    // neighbors, as `BodyTube()` (BodyTube.java:40-43) and `Transition()`
    // (Transition.java:43-51) set. The radii beside the flags are the
    // constructors' DEFAULT_RADIUS, what they show until resolved; the walls
    // are DEFAULT_THICKNESS (SymmetricComponent.java:24-25).
    case 'bodytube':
      return { type, id, length: 0.2, outerRadius: 0.025, outerRadiusAuto: true, thickness: 0.002 };
    case 'transition':
      return {
        type,
        id,
        shape: 'conical',
        length: 0.075,
        foreRadius: 0.025,
        foreRadiusAuto: true,
        aftRadius: 0.025,
        aftRadiusAuto: true,
        thickness: 0.002,
        foreShoulderAuto: true,
        aftShoulderAuto: true,
      };
    // `TrapezoidFinSet()` (TrapezoidFinSet.java:43): 3 fins, root 0.05, tip
    // 0.05, sweep 0.025, height 0.03; the wall is FinSet's 0.003 (FinSet.java:111).
    case 'trapezoidfinset':
      return {
        type,
        id,
        finCount: 3,
        rootChord: 0.05,
        tipChord: 0.05,
        sweep: 0.025,
        height: 0.03,
        thickness: 0.003,
        position: { method: 'bottom', offset: 0 },
      };
    // `EllipticalFinSet()` (EllipticalFinSet.java:30-33): root 0.05, height 0.05.
    case 'ellipticalfinset':
      return {
        type,
        id,
        finCount: 3,
        rootChord: 0.05,
        height: 0.05,
        thickness: 0.003,
        position: { method: 'bottom', offset: 0 },
      };
    // `FreeformFinSet()` (FreeformFinSet.java:34-37): its outline (m), a quad
    // whose root runs 0 to 0.05 along the body and whose tip, at 0.05 height,
    // overhangs the root's trailing edge.
    case 'freeformfinset':
      return {
        type,
        id,
        finCount: 3,
        thickness: 0.003,
        points: [
          [0, 0],
          [0.025, 0.05],
          [0.075, 0.05],
          [0.05, 0],
        ],
        position: { method: 'bottom', offset: 0 },
      };
    // `TubeFinSet()` (TubeFinSet.java:24-28, 56-58): 6 tubes, 0.10 long, an
    // automatic radius, and no wall of its own (NaN: the tube takes the body's
    // wall), so neither key is stored. `addPart` resolves the radius against
    // the real parent, as for the bore-filling parts below.
    case 'tubefinset':
      return {
        type,
        id,
        finCount: 6,
        length: 0.1,
        outerRadiusAuto: true,
        position: { method: 'bottom', offset: 0 },
      };
    // `InnerTube()` (InnerTube.java:48-52): an A-C motor's 19 mm bore, 0.5 mm
    // wall, 70 mm long. The mount flag and the overhang are the app's (see above).
    case 'innertube':
      return {
        type,
        id,
        motorMount: true,
        length: 0.07,
        outerRadius: 0.0095,
        thickness: 0.0005,
        motorOverhang: 0.00635,
        position: { method: 'bottom', offset: 0 },
      };
    // The four parts that fill the bore of the tube they sit in start
    // automatic, because that is what their kernel constructors do:
    // `TubeCoupler()`, `Bulkhead()` and `EngineBlock()` each call
    // `setOuterRadiusAutomatic(true)`, and `CenteringRing()` turns on both its
    // outer radius and its inner one. Without the flags a ring dropped into a
    // 54 mm airframe would arrive sized for a 25 mm one and stay that way until
    // someone noticed the checkbox, which is a wrong rocket that simulates
    // quietly. The radii below are still written, because the app keeps the
    // resolved number beside the flag rather than spelling auto as an absent
    // key (see services/design/autoRadius); `addPart` resolves them against the
    // real parent in the same edit.
    case 'tubecoupler':
      return {
        type,
        id,
        length: 0.06,
        outerRadius: 0.0125,
        outerRadiusAuto: true,
        thickness: 0.002,
        position: { method: 'bottom', offset: 0 },
      };
    case 'centeringring':
      return {
        type,
        id,
        length: 0.002,
        outerRadius: 0.0125,
        outerRadiusAuto: true,
        // A ring's bore follows the motor mount running through it, and is 0
        // with no mount there: a solid disc, which is what the kernel gives
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
        length: 0.002,
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
        thickness: 0.005,
        position: { method: 'bottom', offset: 0 },
      };
    // `LaunchLug()` (LaunchLug.java:33-38): a 10 mm bore, 1 mm wall, 30 mm long,
    // on the far side of the body, at the middle of its parent.
    case 'launchlug':
      return {
        type,
        id,
        length: 0.03,
        outerRadius: 0.005,
        thickness: 0.001,
        angleOffset: Math.PI,
        position: { method: 'middle', offset: 0 },
      };
    // A new recovery device works out its own drag coefficient, and a new
    // parachute its shroud line length (1.5 times its diameter), as `Streamer()`
    // and `Parachute()` start with `cdAutomatic` and `lineLengthAutomatic` set.
    // The bridge reads a stated `cd` or `lineLength` as the user's own number
    // unless the matching flag is on.
    case 'parachute':
      return {
        type,
        id,
        diameter: 0.3,
        cd: 0.8,
        cdAuto: true,
        lineCount: 6,
        lineLength: 0.45,
        lineLengthAuto: true,
        drogue: false,
        deployEvent: 'apogee',
        deployAltitude: 200,
        deployDelay: 0,
        position: { method: 'top', offset: 0 },
      };
    // `Streamer()` (Streamer.java:20-22): a 0.5 m by 0.05 m strip.
    case 'streamer':
      return {
        type,
        id,
        stripLength: 0.5,
        stripWidth: 0.05,
        cdAuto: true,
        drogue: false,
        deployEvent: 'apogee',
        deployAltitude: 200,
        deployDelay: 0,
        position: { method: 'top', offset: 0 },
      };
    // `MassComponent()`: 0 kg (MassComponent.java:17), 25 mm long and 12.5 mm
    // across (MassObject.java:38). `radius` is set explicitly rather than left
    // to each side's own default, so the drawing, the export and the kernel
    // read the one stored value.
    case 'masscomponent':
      return {
        type,
        id,
        mass: KERNEL_DEFAULTS.masscomponent.mass,
        length: KERNEL_DEFAULTS.masscomponent.length,
        radius: KERNEL_DEFAULTS.masscomponent.radius,
        position: { method: 'top', offset: 0 },
      };
    // Desktop's RailButton() dimensions, stated on the node. A bare `{ type, id }`
    // would fly and save at the kernel's 9.7 mm but be drawn at 4 mm, and the
    // panel would show the other five dimensions blank.
    case 'railbutton':
      return {
        type,
        id,
        outerDiameter: COMPONENT_DEFAULTS.railbutton.outerDiameter,
        innerDiameter: COMPONENT_DEFAULTS.railbutton.innerDiameter,
        height: COMPONENT_DEFAULTS.railbutton.height,
        baseHeight: COMPONENT_DEFAULTS.railbutton.baseHeight,
        flangeHeight: COMPONENT_DEFAULTS.railbutton.flangeHeight,
        screwHeight: COMPONENT_DEFAULTS.railbutton.screwHeight,
        angleOffset: Math.PI,
        position: { method: 'middle', offset: 0 },
      };
    // On Auto, as `ShockCord()` starts: the kernel sizes the cord from the
    // rocket's length and the panel shows its figure. The stored length is what
    // the cord keeps if Auto is turned off before a build reports one. Packed
    // like a chute, at the top of its parent.
    case 'shockcord':
      return {
        type,
        id,
        cordLength: KERNEL_DEFAULTS.shockcord.cordLength,
        cordLengthAuto: true,
        length: KERNEL_DEFAULTS.shockcord.length,
        position: { method: 'top', offset: 0 },
      };
    // An external pod: a body chain riding alongside the airframe, two copies
    // and empty as `PodSet()` starts (PodSet.java:32-35; its fields'
    // initializers at :20-30). radiusOffset 0 (relative) means the pod just
    // touches the parent surface; the user adds the pod's own parts.
    case 'podset':
      return {
        type,
        id,
        instanceCount: KERNEL_DEFAULTS.podset.instanceCount,
        radiusOffset: 0,
        radiusMethod: 'relative',
        angleOffset: 0,
        position: { method: 'bottom', offset: 0 },
      };
    // A strap-on booster: a parallel stage beside its parent tube, two of them
    // as `ParallelStage()` starts. Seeded with one body tube like a pod, so it
    // is visible and has something to add fins and a motor mount to.
    case 'parallelstage': {
      const body = defaultNode('bodytube');
      body.length = 0.2;
      body.outerRadius = 0.009;
      // A fixed radius: a new body tube is automatic, and an automatic tube with
      // nothing ahead of it or behind it in its own chain resolves to the
      // kernel's 25 mm, which is no longer slim.
      body.outerRadiusAuto = false;
      return {
        type,
        id,
        instanceCount: KERNEL_DEFAULTS.parallelstage.instanceCount,
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
 * device in this stage is the drogue, so a chute in the booster is not on offer
 * when configuring the sustainer.
 */
export function recoveryDevices(tree: RocketTree, stageId: string): ComponentNode[] {
  const stage = findNode(tree, stageId);
  if (!stage?.children) return [];
  return [...walkNodes(stage.children)].filter((n) => isRecoveryDevice(n.type));
}

/**
 * Make one device in a stage the drogue, or none of them.
 *
 * The drogue flag is stored per device (`<isdrogue>` in the file), but it is a
 * property of the stage's recovery plan: single deployment is no drogue, dual
 * deployment is exactly one, and the desktop only ever sets it from the stage's
 * Recovery tab, clearing the rest of the stage first. Doing the same here is
 * what keeps a design out of the state OpenRocket's own UI cannot produce: two
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
    next = updateNode(next, id, { drogue: on ? true : undefined });
  }
  return next;
}

/** Whether `id` is the top stage: the one with nothing above it to separate from. */
export function isFirstStage(tree: RocketTree, id: string): boolean {
  const stages = stageNodes(tree);
  return stages.length > 0 && stages[0]!.id === id;
}

/**
 * Add a new empty stage as the bottom booster: a top-level sibling appended
 * after the existing stages, and named the way a file's unnamed stages are
 * ({@link defaultStageName}). Returns the new tree and the new stage's id (so
 * the caller can select it).
 */
export function addStage(tree: RocketTree): { tree: RocketTree; id: string } {
  const node = defaultNode('stage');
  const id = node.id!;
  const count = stageNodes(tree).length;
  node.name = defaultStageName(count);
  const next = clone(tree);
  next.components.push(node);
  return { tree: next, id };
}

/**
 * Add a new part of `type` under the selected node, or under the stage when
 * nothing is selected. Returns the new tree and the new node's id.
 *
 * {@link allowedChildren} is enforced here, not only by the Add menu. The menu
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
  /** Merged onto the new node: the caller's per-part-type material defaults
   *  (`services/design/materialSlots.defaultMaterialPatch`). Kept as a parameter
   *  rather than read here so this module stays a pure tree editor with no
   *  settings of its own. */
  seed: Partial<ComponentNode> = {},
): { tree: RocketTree; id: string } {
  const node = { ...defaultNode(type), ...seed };
  const id = node.id!;
  const stageId = stageNodes(tree)[0]?.id;
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
    throw new KeyedError('errors.design.cannotAdd', { part: { key: `part.${type}` } });
  }
  return { tree: addChild(tree, stageId, node), id };
}
