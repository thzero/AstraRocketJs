// The user's saved parts as PICKER ROWS: the layer between the raw store
// (presetStore.ts) and the component picker, the way materials.ts sits between
// materialStore.ts and the material picker.
//
// A saved part holds the whole node. The picker, however, lists, searches,
// facets, range-filters, fit-ranks and sorts `Component` rows, so each saved
// part is PROJECTED down to one of those (the inverse of treeEdit.catalogPatch)
// and carries the node along in `patch` for the apply. That way a saved part is
// an ordinary row everywhere except the star beside it and the button that
// removes it, and none of componentFilter had to learn about it.
import type { ComponentNode, NoseShape } from '../engine/openRocketEngine';
import { catalogTypeFor, isComponentRow, type Component, type ComponentType, type PickerType } from './componentDb';
import { getPresetStore, type CustomPart } from './presetStore';

/** What the manufacturer column says when the user names no maker. */
export const DEFAULT_CUSTOM_MFR = 'Custom';

/**
 * Node keys a saved part does NOT keep.
 *
 * `id` and `type` identify the node it was saved FROM, and applying either to
 * another node would either duplicate an id or change what the part is.
 * `name` is what the user called it in THAT design; applying it would rename
 * the part they are filling, which no catalog pick does either.
 * `position` is where it sat in that design, which is never what you want here.
 *
 * `children` is the interesting one. Saving a body tube WITH its fin set is a
 * real feature and this is not it: the patch path is a shallow merge
 * (`patchSelected`), so the children would replace whatever the target holds,
 * and every one of them would arrive carrying the id it had in the design it
 * was saved from. Assemblies need their own apply; a part saves as a part.
 */
const NOT_SAVED: ReadonlySet<string> = new Set(['id', 'type', 'name', 'position', 'children']);

/** What of a node gets saved: everything but its identity and where it sits. */
export function presetNode(node: ComponentNode): Partial<ComponentNode> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) if (!NOT_SAVED.has(k) && v !== undefined) out[k] = v;
  return out as Partial<ComponentNode>;
}

/** A finite number from the node's parameter bag, or null when absent. */
function n(node: Partial<ComponentNode>, key: string): number | null {
  const v = node[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** A diameter from a radius key, or null. */
function dia(node: Partial<ComponentNode>, key: string): number | null {
  const r = n(node, key);
  return r === null ? null : r * 2;
}

/**
 * The dimensions a picker row publishes, read back off a saved node: the
 * inverse of `treeEdit.catalogPatch`, per type, and the one piece of real
 * logic here.
 *
 * Null when the node cannot answer. That is not paranoia about a node the
 * editor built (the editor seeds every dimension), it is the gate on a blob
 * out of storage: these numbers are divided and subtracted by the picker's fit
 * ranking and sort, and a row with an undefined outer diameter sorts every
 * other part in the catalog around it.
 */
function rowGeometry(node: Partial<ComponentNode>, type: string): Record<string, unknown> | null {
  const material = typeof node.materialName === 'string' ? node.materialName : undefined;
  // 0, not null: the row's own schema requires a finite density, and a part
  // with no material picked is the app's default rather than a missing value.
  // `catalogPatch` never reads it for a saved row anyway (the node carries the
  // real `density`), so it only ever feeds the picker's material column.
  const materialDensity = n(node, 'density') ?? 0;
  const length = n(node, 'length');
  const outerDiameter = dia(node, 'outerRadius');
  const wall = n(node, 'thickness');

  switch (type) {
    case 'bodytube':
    case 'tubecoupler':
      if (outerDiameter === null || length === null) return null;
      return {
        type,
        material,
        materialDensity,
        outerDiameter,
        // A tube's bore is its OD less two walls. No wall means no bore to
        // publish, which is the same `null` the catalog uses for a row that
        // does not give one.
        innerDiameter: wall === null ? null : Math.max(0, outerDiameter - 2 * wall),
        length,
      };
    case 'centeringring':
      if (outerDiameter === null || length === null) return null;
      return { type, material, materialDensity, outerDiameter, innerDiameter: dia(node, 'innerRadius'), length };
    case 'bulkhead':
      if (outerDiameter === null || length === null) return null;
      // The kernel's bulkhead is a solid disc: it has no wall field, so there
      // is nothing for this to be but true.
      return { type, material, materialDensity, outerDiameter, length, filled: true };
    case 'nosecone': {
      const od = dia(node, 'aftRadius');
      if (od === null || length === null || typeof node.shape !== 'string') return null;
      return {
        type,
        material,
        materialDensity,
        shape: node.shape as NoseShape,
        // Mirrors what catalogPatch WRITES for a filled cone (thickness = the
        // radius), so a catalog cone that was picked, saved and listed again
        // reads the same both times.
        filled: wall !== null && wall >= od / 2 - 1e-9,
        outerDiameter: od,
        length,
      };
    }
    case 'parachute': {
      const diameter = n(node, 'diameter');
      if (diameter === null) return null;
      return { type, diameter, cd: n(node, 'cd') };
    }
    default:
      return null;
  }
}

/**
 * A saved part as a picker row, or null when it cannot be listed as one.
 *
 * The projected row is run through the catalog's own `isComponentRow`, so a
 * saved part is held to exactly the schema every catalog row is held to and
 * cannot reach `catalogPatch` by a side door.
 */
export function customPartToRow(part: CustomPart): Component | null {
  const geometry = rowGeometry(part.node, part.type);
  if (!geometry) return null;
  const row = {
    ...geometry,
    mfr: part.mfr,
    partNo: part.partNo,
    desc: part.desc,
    id: part.id,
    custom: true,
    patch: part.node,
  };
  return isComponentRow(row) ? row : null;
}

// Saving and deleting happen in the property panel, while the picker that has
// to show the result is a separate lazily-loaded component with its own copy of
// the list. A version counter both of them can see is the smallest thing that
// keeps them in step: the picker subscribes, and a save or a delete re-runs its
// load without the dialog closing or the button flashing back to "Loading".
let version = 0;
const listeners = new Set<() => void>();

/** The current saved-parts revision (a `useSyncExternalStore` snapshot). */
export const savedPartsVersion = (): number => version;

/** Subscribe to saves and deletes; returns the unsubscribe. */
export function onSavedPartsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function bump(): void {
  version++;
  for (const fn of listeners) fn();
}

/**
 * Save a component for reuse, replacing any part saved under the same maker
 * and part number. Returns what was stored.
 *
 * A blank part number is refused, and so is a node the picker could not list:
 * telling someone their part is saved and then never showing it to them again
 * is the failure this whole feature exists to avoid.
 */
export async function saveCustomPart(node: ComponentNode, type: PickerType, meta: PartMeta): Promise<CustomPart> {
  const { mfr, partNo, desc } = cleanMeta(meta);
  const catalogType = catalogTypeFor(type);
  // "Saving again under the same maker and name replaces it" is matched on the
  // LABEL, and the id is stable and opaque. An id encoding
  // `<type>:<mfr>:<partNo>` cannot express a rename: it changes with the name, so
  // the part is copied and the original stays behind under its old name.
  const existing = (await getPresetStore().list()).find(
    (p) => p.type === catalogType && p.mfr === mfr && p.partNo === partNo,
  );
  return write({
    id: existing?.id ?? newPartId(),
    type: catalogType,
    mfr,
    partNo,
    desc,
    node: presetNode(node),
  });
}

/** What the user types about a part, as opposed to what the part IS. */
export interface PartMeta {
  mfr: string;
  partNo: string;
  desc: string;
}

/** Trimmed, with the two rules that apply wherever a part is written. */
function cleanMeta(meta: PartMeta): PartMeta {
  const partNo = meta.partNo.trim();
  if (!partNo) throw new Error('A part number is required');
  return { mfr: meta.mfr.trim() || DEFAULT_CUSTOM_MFR, partNo, desc: meta.desc.trim() };
}

/** An opaque id that survives a rename. */
function newPartId(): string {
  return `custom:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

/** The one write path: gate on the projection, store, announce. */
async function write(part: CustomPart): Promise<CustomPart> {
  if (!customPartToRow(part)) throw new Error('This part is missing the dimensions the picker lists parts by');
  await getPresetStore().add(part);
  bump();
  return part;
}

/**
 * Edit a saved part in place: its name, maker and notes, and its geometry.
 *
 * Keeps the id, so this is one atomic `add` however much changes, and a
 * rename does not leave the old part behind. It refuses a label that another
 * part of the same type already uses, because two rows reading `Bench · BT-50`
 * in the picker are indistinguishable and the next save would silently merge
 * them.
 */
export async function updateCustomPart(id: string, meta: PartMeta, node: Partial<ComponentNode>): Promise<CustomPart> {
  const clean = cleanMeta(meta);
  const saved = await getPresetStore().list();
  const current = saved.find((p) => p.id === id);
  if (!current) throw new Error('That part is no longer saved');
  const clash = saved.some(
    (p) => p.id !== id && p.type === current.type && p.mfr === clean.mfr && p.partNo === clean.partNo,
  );
  if (clash) throw new Error('Another saved part of this type already uses that maker and name');
  return write({ ...current, ...clean, node });
}

/** Remove a saved part by id. */
export async function deleteCustomPart(id: string): Promise<void> {
  await getPresetStore().remove(id);
  bump();
}

/**
 * The user's saved parts of one CATALOG type, as picker rows.
 *
 * Row by row, like the catalog itself: a part that no longer projects (an
 * older shape, a hand-edited store) costs that part and not the list.
 */
export async function customRowsForType(type: ComponentType): Promise<Component[]> {
  const saved = await getPresetStore().list();
  return saved
    .filter((p) => p.type === type)
    .map(customPartToRow)
    .filter((r): r is Component => r !== null);
}

/** A saved part beside the row it projects to, or null when it no longer does. */
export interface SavedPartEntry {
  part: CustomPart;
  row: Component | null;
}

/**
 * EVERY saved part, of every type, for the manage view.
 *
 * Deliberately not `customRowsForType` over each type in turn, and the
 * difference is the whole reason this exists: the picker DROPS a part that no
 * longer projects to a row, which is right for a list you are choosing from
 * and wrong for the only list you can delete from. A part nothing can show you
 * is a part you can never get rid of. So the row is optional here, and a null
 * one is something the view has to render rather than skip.
 */
export async function listSavedParts(): Promise<SavedPartEntry[]> {
  const saved = await getPresetStore().list();
  return saved.map((part) => ({ part, row: customPartToRow(part) }));
}
