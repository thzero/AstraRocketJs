import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { SI_LIMITS } from '../../prefs/entryValue';
import type { Quantity } from '../../prefs/units';

/** One value a loaded design carried that no value of its quantity can be. */
export interface RepairedValue {
  /** The part's own name, falling back to its type for the message. */
  name: string;
  /** The node key, which is also the `prop.*` label the panel shows. */
  field: string;
  was: number;
  now: number;
}

/**
 * Node keys holding a quantity with a PHYSICAL ceiling, by that quantity.
 *
 * Only bulk density today, because `SI_LIMITS` is deliberately short. A surface
 * or line density is a different quantity with no real ceiling, so neither is
 * here; adding one is a row in this table and a row in that one.
 */
const LIMITED: Record<string, Quantity> = { density: 'density' };

/**
 * Pull a loaded design's impossible values back inside the limits the editor
 * enforces, and say which ones moved.
 *
 * The number boxes clamp as you TYPE (`prefs/entryValue`), and nothing clamped
 * on the way IN. So a `.ork`, a share link, or a session autosaved by a build
 * from before a limit existed could carry a bulk density of 1e9 kg/m³, and the
 * app would fly it: a 200 mm tube of that weighs about 180 tonnes, every mass,
 * CG and stability figure on screen is nonsense, and nothing says why.
 *
 * Only quantities with a physical ceiling are touched. A per-field limit is a
 * different thing - it belongs to the field, not to a design arriving from
 * somewhere else - and is left alone here.
 *
 * Returns the SAME tree and nodes when nothing was out of range, so the ordinary
 * load allocates nothing and cannot be told from one that never ran this.
 */
export function repairValues(tree: RocketTree): { tree: RocketTree; repaired: RepairedValue[] } {
  const repaired: RepairedValue[] = [];

  const fixNode = (node: ComponentNode): ComponentNode => {
    let out = node;
    for (const [key, quantity] of Object.entries(LIMITED)) {
      const limit = SI_LIMITS[quantity];
      const v = (node as unknown as Record<string, unknown>)[key];
      if (!limit || typeof v !== 'number' || !Number.isFinite(v)) continue;
      const now = Math.min(limit.max ?? Infinity, Math.max(limit.min ?? -Infinity, v));
      if (now === v) continue;
      repaired.push({ name: (typeof node.name === 'string' && node.name) || node.type, field: key, was: v, now });
      out = { ...out, [key]: now } as ComponentNode;
    }
    return out;
  };

  const walk = (nodes: ComponentNode[]): ComponentNode[] => {
    let changed = false;
    const out = nodes.map((n) => {
      let node = fixNode(n);
      if (node !== n) changed = true;
      if (node.children) {
        const kids = walk(node.children);
        if (kids !== node.children) {
          node = { ...node, children: kids };
          changed = true;
        }
      }
      return node;
    });
    return changed ? out : nodes;
  };

  const components = walk(tree.components);
  return { tree: components === tree.components ? tree : { ...tree, components }, repaired };
}
