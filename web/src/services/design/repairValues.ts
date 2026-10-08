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
  /** The node key, which is also the `prop.*` label the panel shows. */
  field: string;
  was: number;
  now: number;
}

/**
 * Node keys holding a quantity with a physical ceiling, by that quantity.
 *
 * Only bulk density today, because `SI_LIMITS` is deliberately short. A surface
 * or line density is a different quantity with no real ceiling, so neither is
 * here; adding one is a row in this table and a row in that one.
 */
const LIMITED: Record<string, Quantity> = { density: 'density' };

/** One repaired value as the banner's line, the part named by {@link partLabel}. */
export function repairedText(r: RepairedValue, t: (key: string, opts?: Record<string, unknown>) => string): string {
  return t('banner.repaired', { part: partLabel(t, r), field: t(`prop.${r.field}`), was: r.was, now: r.now });
}

/**
 * Pull a loaded design's impossible values back inside the limits the editor
 * enforces, and say which ones moved.
 *
 * The number boxes clamp as you type (`prefs/entryValue`), but a value arriving
 * from outside does not pass through them. A `.ork`, a share link, or a session
 * autosaved before a limit existed can carry a bulk density of 1e9 kg/m³, and
 * without this the app would fly it: a 200 mm tube of that weighs about 180
 * tonnes, every mass, CG and stability figure on screen is nonsense, and nothing
 * says why.
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
    let out = node;
    for (const [key, quantity] of Object.entries(LIMITED)) {
      const limit = SI_LIMITS[quantity];
      const v = (node as unknown as Record<string, unknown>)[key];
      if (!limit || typeof v !== 'number' || !Number.isFinite(v)) continue;
      const now = clampEntry(v, limit.min, limit.max)!;
      if (now === v) continue;
      repaired.push({ type: node.type, name: typeof node.name === 'string' ? node.name : '', field: key, was: v, now });
      out = { ...out, [key]: now };
    }
    return out;
  };

  const components = mapTreePreserving(tree.components, fixNode, 'pre');
  return { tree: components === tree.components ? tree : { ...tree, components }, repaired };
}
