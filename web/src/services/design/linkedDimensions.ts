import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { num } from '../../tree/nodeProps';
import { mapTreePreserving } from '../../tree/treeWalk';
import { COMPONENT_DEFAULTS } from './componentDefaults';

/**
 * Dimensions of one part that the kernel clamps against each other.
 *
 * A rail button's heights and bore and a centering ring's two radii are not
 * independent: the kernel's setters hold each one inside a range the others set
 * (`RailButton.setInnerDiameter`, `setTotalHeight`, `setBaseHeight`,
 * `setFlangeHeight`, `RadiusRingComponent.setInnerRadius` and
 * `setOuterRadius`). A value outside that range is not refused, it is changed,
 * so the panel, the saved design and the export have to hold the clamped value
 * or they describe a different part from the one that flies.
 *
 * Each bound is in the node's own units (a ring's radii are radii) and reads
 * the part as it is now. The outer dimension's floor is the inner one, where
 * the kernel would instead pull the inner one down with it: the panel writes on
 * every keystroke, so typing 54 over a 25 mm bore would pass through 5 and
 * leave the bore there.
 */
export interface DimensionBounds {
  min?: (node: ComponentNode) => number;
  max?: (node: ComponentNode) => number;
}

const RB = COMPONENT_DEFAULTS.railbutton;

/** The rail button dimensions the kernel links, with an absent key read as the kernel default. */
export const RAIL_BUTTON_FALLBACK = {
  outerDiameter: RB.outerDiameter,
  innerDiameter: RB.innerDiameter,
  height: RB.height,
  baseHeight: RB.baseHeight,
  flangeHeight: RB.flangeHeight,
  screwHeight: RB.screwHeight,
} as const;

type RailKey = keyof typeof RAIL_BUTTON_FALLBACK;

const rail = (node: ComponentNode, key: RailKey): number => num(node, key, RAIL_BUTTON_FALLBACK[key]);

/** `RailButton`'s setters: the bore within the outside, and the base and flange within the total height. */
export const RAIL_BUTTON_BOUNDS: Partial<Record<RailKey, DimensionBounds>> = {
  outerDiameter: { min: (n) => Math.max(0, rail(n, 'innerDiameter')) },
  innerDiameter: { max: (n) => rail(n, 'outerDiameter') },
  height: { min: (n) => rail(n, 'baseHeight') + rail(n, 'flangeHeight') },
  baseHeight: { max: (n) => Math.max(0, rail(n, 'height') - rail(n, 'flangeHeight')) },
  flangeHeight: { max: (n) => Math.max(0, rail(n, 'height') - rail(n, 'baseHeight')) },
};

/** `RadiusRingComponent`'s setters: the inner radius never past the outer. */
export const RING_BOUNDS: Record<'outerRadius' | 'innerRadius', DimensionBounds> = {
  outerRadius: { min: (n) => Math.max(0, num(n, 'innerRadius')) },
  innerRadius: { max: (n) => num(n, 'outerRadius') },
};

/** A value held inside a field's bounds, the lower bound applied first as the kernel's setters do. */
export function clampToBounds(node: ComponentNode, bounds: DimensionBounds | undefined, v: number): number {
  if (!bounds) return v;
  const lo = bounds.min?.(node);
  const hi = bounds.max?.(node);
  let out = v;
  if (lo !== undefined) out = Math.max(out, lo);
  if (hi !== undefined) out = Math.min(out, hi);
  return out;
}

/**
 * A rail button's linked dimensions as the desktop loads them from a file.
 *
 * The loader runs each tag through its setter in the order `RailButtonSaver`
 * writes them (outer, inner, total, base, flange), starting from the
 * constructor's values, so a pair that disagrees comes out clamped. A value
 * the file leaves out keeps the constructor's.
 */
export function settleRailButtonLoad(read: Partial<Record<RailKey, number>>): Record<RailKey, number> {
  let od: number = RB.outerDiameter;
  let id: number = RB.innerDiameter;
  let total: number = RB.height;
  let base: number = RB.baseHeight;
  let flange: number = RB.flangeHeight;
  if (read.outerDiameter !== undefined) {
    od = read.outerDiameter;
    id = Math.min(id, od);
  }
  if (read.innerDiameter !== undefined) id = Math.min(read.innerDiameter, od);
  if (read.height !== undefined) total = Math.max(read.height, base + flange);
  if (read.baseHeight !== undefined) base = Math.min(Math.max(read.baseHeight, 0), total - flange);
  if (read.flangeHeight !== undefined) flange = Math.min(Math.max(read.flangeHeight, 0), total - base);
  return {
    outerDiameter: od,
    innerDiameter: id,
    height: total,
    baseHeight: base,
    flangeHeight: flange,
    screwHeight: read.screwHeight ?? RB.screwHeight,
  };
}

/**
 * A centering ring's outer radius as the desktop loads it: the outer radius is
 * set first, then the inner, whose setter raises the outer to meet it.
 */
export const settleRingOuterLoad = (outer: number, inner: number): number => Math.max(outer, inner);

/**
 * A rail button's linked dimensions as the bridge builds them
 * (`ComponentFactory`): the outer diameter first, which caps the bore; the base
 * and flange cleared, then the total height, the base and the flange, each
 * against the ones already set. An absent key flies as the kernel default.
 *
 * A button whose dimensions agree comes back unchanged, so this only moves a
 * stored part the panel would never have produced.
 */
function settleRailButtonBuild(node: ComponentNode): Partial<Record<RailKey, number>> {
  const od = rail(node, 'outerDiameter');
  const id = Math.min(rail(node, 'innerDiameter'), od);
  const total = Math.max(rail(node, 'height'), 0);
  const base = Math.min(Math.max(rail(node, 'baseHeight'), 0), total);
  const flange = Math.min(Math.max(rail(node, 'flangeHeight'), 0), total - base);
  const settled = { innerDiameter: id, height: total, baseHeight: base, flangeHeight: flange };
  const patch: Partial<Record<RailKey, number>> = {};
  for (const [k, v] of Object.entries(settled) as [RailKey, number][]) if (v !== rail(node, k)) patch[k] = v;
  return patch;
}

/**
 * A centering ring's outer radius as the bridge builds it: the outer radius is
 * set, then the inner, whose setter raises the outer to meet it. An automatic
 * outer radius is switched back on afterward and follows the parent's bore
 * whatever the inner radius is, so it is left alone.
 */
function settleRingBuild(node: ComponentNode): { outerRadius?: number } {
  if (node['outerRadiusAuto'] === true) return {};
  const outer = node['outerRadius'];
  const inner = node['innerRadius'];
  if (typeof outer !== 'number' || typeof inner !== 'number') return {};
  const raised = settleRingOuterLoad(outer, Math.max(inner, 0));
  return raised === outer ? {} : { outerRadius: raised };
}

/**
 * A stored design with every rail button and centering ring held as the
 * kernel builds it. Returns the same tree, arrays and nodes where nothing
 * moves, so a design that was already consistent is untouched.
 */
export function settleLinkedDimensions(tree: RocketTree): RocketTree {
  const components = mapTreePreserving(
    tree.components,
    (n) => {
      const patch =
        n.type === 'railbutton' ? settleRailButtonBuild(n) : n.type === 'centeringring' ? settleRingBuild(n) : {};
      return Object.keys(patch).length ? { ...n, ...patch } : n;
    },
    'pre',
  );
  return components === tree.components ? tree : { ...tree, components };
}
