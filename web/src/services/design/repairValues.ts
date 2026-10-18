import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { clampEntry, SI_LIMITS } from '../../prefs/entryValue';
import type { Quantity } from '../../prefs/units';
import { partLabel } from '../../i18n/format';
import { mapTreePreserving } from '../../tree/treeWalk';

/** One value a loaded design carried that no value of its quantity can be. */
export interface RepairedValue {
  type: string;
  /** The part's own name, empty when it has none (the reader labels it). */
  name: string;
  /** The node key. */
  field: string;
  was: number;
  now: number;
}

/**
 * Node keys holding a quantity with a physical ceiling, by that quantity, with
 * the label the banner names the value by.
 *
 * Only bulk densities, because `SI_LIMITS` is deliberately short: a part's own
 * and a fin set's fillet, which the material picker clamps alike. A surface or
 * line density is a different quantity with no real ceiling, so neither is
 * here; adding one is a row in this table and a row in that one.
 */
const LIMITED: Record<string, { quantity: Quantity; label: string }> = {
  density: { quantity: 'density', label: 'units.q.density' },
  filletDensity: { quantity: 'density', label: 'prop.filletDensity' },
};

/** One repaired value as the banner's line, the part named by {@link partLabel}. */
export function repairedText(r: RepairedValue, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const field = LIMITED[r.field]?.label ?? `prop.${r.field}`;
  return t('banner.repaired', { part: partLabel(t, r), field: t(field), was: r.was, now: r.now });
}

/**
 * One node with its impossible values pulled back inside the editor's limits,
 * and the values that moved. The node itself when none did.
 */
export function repairNode(node: ComponentNode): { node: ComponentNode; repaired: RepairedValue[] } {
  const repaired: RepairedValue[] = [];
  let out = node;
  for (const [key, { quantity }] of Object.entries(LIMITED)) {
    const limit = SI_LIMITS[quantity];
    const v = (node as unknown as Record<string, unknown>)[key];
    if (!limit || typeof v !== 'number' || !Number.isFinite(v)) continue;
    const now = clampEntry(v, limit.min, limit.max)!;
    if (now === v) continue;
    repaired.push({ type: node.type, name: typeof node.name === 'string' ? node.name : '', field: key, was: v, now });
    out = { ...out, [key]: now };
  }
  return { node: out, repaired };
}

/**
 * Pull a loaded design's impossible values back inside the limits the editor
 * enforces, and say which ones moved.
 *
 * The number boxes clamp as you type (`prefs/entryValue`), but a value arriving
 * from outside does not pass through them. An opened file or an autosaved
 * session can carry a bulk density of 1e9 kg/m³, and without this the app
 * would fly it: a 200 mm tube of that weighs about 180 metric tons, every
 * mass, CG and stability figure on screen is nonsense, and nothing says why.
 *
 * Only quantities with a physical ceiling are touched. A per-field limit is a
 * different thing (it belongs to the field, not to a design arriving from
 * somewhere else) and is left alone here.
 *
 * Returns the same tree and nodes when nothing was out of range, so the ordinary
 * load allocates nothing and cannot be told from one that never ran this.
 */
export function repairValues(tree: RocketTree): { tree: RocketTree; repaired: RepairedValue[] } {
  const repaired: RepairedValue[] = [];

  const fixNode = (node: ComponentNode): ComponentNode => {
    const fixed = repairNode(node);
    repaired.push(...fixed.repaired);
    return fixed.node;
  };

  const components = mapTreePreserving(tree.components, fixNode, 'pre');
  return { tree: components === tree.components ? tree : { ...tree, components }, repaired };
}
