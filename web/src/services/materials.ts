// Materials available to the editor = the BUILT-IN catalog + the user's CUSTOM
// materials.
//
// The built-ins are a runtime file (public/data/materials.generated.json,
// written by scripts/sync-materials.mjs) fetched on demand like the motor and
// component catalogs, not compiled into the bundle. Custom materials persist
// through a swappable store (materialStore.ts) — IndexedDB by default, a
// backend service tomorrow. This layer only owns the domain rules (validation,
// merging built-ins with custom) and talks to neither mechanism directly.
import { isMaterialCatalog, type Material, type MaterialType } from './materialTypes';
import { getMaterialStore } from './materialStore';
import { fetchCatalog } from './remoteData';

/**
 * The built-in table, fetched once per session.
 *
 * ~16 KB, so it is not deferred the way the 1.6 MB motor catalog is: the first
 * thing that wants a material asks for it and everything after shares the one
 * promise, exactly as the bundled import used to share a module.
 */
function loadBuiltins(): Promise<Material[]> {
  return fetchCatalog<Material[]>('materials', isMaterialCatalog);
}

/** Built-ins for one type, in catalog order. */
export async function builtinsForType(type: MaterialType): Promise<Material[]> {
  return (await loadBuiltins()).filter((m) => m.type === type);
}

/** The user's custom materials from the active store. */
function loadCustom(): Promise<Material[]> {
  return getMaterialStore().list();
}

/**
 * Where a custom material goes when it belongs to no group of its own.
 *
 * `Other` is upstream's own group name (its `Thread (heavy-duty)` is in it),
 * not one invented here, so a custom material lands in the vocabulary the rest
 * of the list already speaks.
 */
export const DEFAULT_CUSTOM_GROUP = 'Other';

/**
 * What custom materials used to be filed under, before they joined the real
 * groups. Still read, never written: a material saved by an older build is
 * re-homed on the way out of the store rather than stranded in a group nothing
 * else is in.
 */
const LEGACY_CUSTOM_GROUP = 'Custom';

/**
 * The groups a custom material can be filed under, in list order.
 *
 * Derived from a list already in hand rather than fetched again: the caller is
 * the add form inside the picker, which only exists once the picker has its
 * materials, and passing them in keeps the dropdown from being empty for a
 * frame. Custom materials are in that list too, so a group the user invented
 * is offered back to them.
 */
export function groupsOf(materials: Material[]): string[] {
  return [...new Set([...materials.map((m) => m.group), DEFAULT_CUSTOM_GROUP])];
}

/**
 * Adds (or replaces, by name+type) a custom material; returns the updated
 * custom list (newest first). A blank name or non-positive density is rejected.
 *
 * `group` is where it sits in the picker. It is only a hint: a custom material
 * that SHARES A NAME with a built-in takes that built-in's group and its place
 * in the list, because it is that material at your density rather than a second
 * material with the same name — see {@link mergeCustom}.
 */
export async function addCustom(
  name: string,
  type: MaterialType,
  density: number,
  group: string = DEFAULT_CUSTOM_GROUP,
): Promise<Material[]> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Material name is required');
  if (!Number.isFinite(density) || density <= 0) throw new Error('Density must be a positive number');
  await getMaterialStore().add({ name: trimmed, type, density, group: group || DEFAULT_CUSTOM_GROUP, custom: true });
  return getMaterialStore().list();
}

/** Removes a custom material by name+type; returns the updated custom list. */
export async function removeCustom(name: string, type: MaterialType): Promise<Material[]> {
  await getMaterialStore().remove(name, type);
  return getMaterialStore().list();
}

/**
 * Built-ins and custom materials as ONE list, in picker order.
 *
 * Exported for test, and separate from the store round trip so the rule can be
 * read without one.
 *
 * Two things it does, both of which the old `[...custom, ...builtins]` did not:
 *
 * - **A custom material with a built-in's name replaces it**, in place: same
 *   row, same group, your density. It used to appear as well, so the list
 *   carried two materials called `Blue tube` in two different groups, and which
 *   one a design got depended on which the picker found first.
 * - **The rest join a real group** rather than a `Custom` one of their own. A
 *   custom material is marked with a star where it sits; a group per provenance
 *   put every one of them at the top of the list, away from the material it is
 *   a variant of.
 */
export function mergeCustom(builtins: Material[], custom: Material[]): Material[] {
  const byName = new Map(custom.map((m) => [m.name, m]));
  const shadowed = new Set<string>();
  const out = builtins.map((b) => {
    const c = byName.get(b.name);
    if (!c) return b;
    shadowed.add(b.name);
    return { ...c, group: b.group };
  });

  for (const c of custom) {
    if (shadowed.has(c.name)) continue;
    const group = !c.group || c.group === LEGACY_CUSTOM_GROUP ? DEFAULT_CUSTOM_GROUP : c.group;
    const entry = { ...c, group };
    // After the last member of its group, so it reads as part of it. A group
    // the built-ins do not have (Other, for a bulk material) lands at the end.
    let at = -1;
    for (let i = 0; i < out.length; i++) if (out[i]!.group === group) at = i;
    if (at < 0) out.push(entry);
    else out.splice(at + 1, 0, entry);
  }
  return out;
}

/** Built-ins + custom for a given type, merged (see {@link mergeCustom}). */
export async function materialsForType(type: MaterialType): Promise<Material[]> {
  const [builtins, custom] = await Promise.all([builtinsForType(type), loadCustom()]);
  return mergeCustom(
    builtins,
    custom.filter((m) => m.type === type),
  );
}

/** Look up a material by name+type across built-ins and custom. */
export async function findMaterial(name: string, type: MaterialType): Promise<Material | undefined> {
  return (await materialsForType(type)).find((m) => m.name === name);
}

/**
 * Which node keys a material of each kind lands on. A part carries up to three
 * at once — a parachute has a canopy AND shroud lines — so the material type is
 * what decides, not the part.
 */
const MATERIAL_KEYS: Record<MaterialType, { name: string; density: string }> = {
  bulk: { name: 'materialName', density: 'density' },
  surface: { name: 'surfaceMaterialName', density: 'surfaceDensity' },
  line: { name: 'lineMaterialName', density: 'lineDensity' },
};

/** The settings key for one part type's material of one kind. */
export const defaultMaterialKey = (partType: string, materialType: MaterialType): string =>
  `${partType}:${materialType}`;

/**
 * What to stamp onto a NEWLY ADDED part of `partType`, from the user's
 * per-part-type defaults (Settings ▸ Materials). `{}` when they have set none.
 *
 * The preference is spent here, at creation, rather than resolved later: the
 * part ends up carrying a real material that shows in the panel and is written
 * to the `.ork`. Desktop OpenRocket keeps the part unset and applies its
 * equivalent preference at runtime, which means the same file weighs one thing
 * on the machine that made it and another on the machine it was sent to.
 */
export function defaultMaterialPatch(
  partType: string,
  defaults: Record<string, { name: string; density: number }>,
): Record<string, string | number> {
  const patch: Record<string, string | number> = {};
  for (const materialType of Object.keys(MATERIAL_KEYS) as MaterialType[]) {
    const chosen = defaults[defaultMaterialKey(partType, materialType)];
    if (!chosen) continue;
    const keys = MATERIAL_KEYS[materialType];
    patch[keys.name] = chosen.name;
    patch[keys.density] = chosen.density;
  }
  return patch;
}
