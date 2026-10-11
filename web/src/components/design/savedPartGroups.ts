import type { ComponentType } from '../../services/parts/componentDb';
import type { SavedPartEntry } from '../../services/parts/customParts';

/**
 * Where each catalog type's group sits in the saved-parts library: the add-part
 * palette's order (body, inner, recovery, other). Typed against the catalog's
 * own type list, so a new catalog type does not compile until it has a place
 * here, and the list never falls back to first-seen order.
 */
const GROUP_ORDER = {
  nosecone: 0,
  bodytube: 1,
  transition: 2,
  tubecoupler: 3,
  centeringring: 4,
  bulkhead: 5,
  engineblock: 6,
  parachute: 7,
  streamer: 8,
  launchlug: 9,
  railbutton: 10,
} as const satisfies Record<ComponentType, number>;

const rank = (type: string): number =>
  // A type the app no longer knows sorts last rather than first.
  (GROUP_ORDER as Record<string, number>)[type] ?? Object.keys(GROUP_ORDER).length;

/**
 * Saved parts grouped by catalog type, each group's parts by part number. The
 * group order is fixed, so the list does not rearrange itself as parts are
 * saved and deleted.
 */
export function groupSavedParts(entries: readonly SavedPartEntry[]): { type: string; list: SavedPartEntry[] }[] {
  const by = new Map<string, SavedPartEntry[]>();
  for (const e of entries) {
    if (!by.has(e.part.type)) by.set(e.part.type, []);
    by.get(e.part.type)!.push(e);
  }
  return [...by.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([type, list]) => ({
      type,
      list: [...list].sort((a, b) => a.part.partNo.localeCompare(b.part.partNo)),
    }));
}
