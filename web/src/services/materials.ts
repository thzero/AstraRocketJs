// Materials available to the editor = built-ins (data/materials.ts) + the
// user's CUSTOM materials. Custom materials persist through a swappable store
// (materialStore.ts) — localStorage today, a backend service tomorrow — so this
// layer only owns the domain rules (validation, merging built-ins with custom)
// and never talks to a storage mechanism directly.
import { BUILTIN_MATERIALS, type Material, type MaterialType } from '../data/materials';
import { getMaterialStore } from './materialStore';

/** Built-ins for a type — static, synchronous (safe for a first render). */
export function builtinsForType(type: MaterialType): Material[] {
  return BUILTIN_MATERIALS.filter((m) => m.type === type);
}

/** The user's custom materials from the active store. */
export function loadCustom(): Promise<Material[]> {
  return getMaterialStore().list();
}

/**
 * Adds (or replaces, by name+type) a custom material; returns the updated
 * custom list (newest first). A blank name or non-positive density is rejected.
 */
export async function addCustom(name: string, type: MaterialType, density: number): Promise<Material[]> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Material name is required');
  if (!Number.isFinite(density) || density <= 0) throw new Error('Density must be a positive number');
  await getMaterialStore().add({ name: trimmed, type, density, group: 'Custom', custom: true });
  return getMaterialStore().list();
}

/** Removes a custom material by name+type; returns the updated custom list. */
export async function removeCustom(name: string, type: MaterialType): Promise<Material[]> {
  await getMaterialStore().remove(name, type);
  return getMaterialStore().list();
}

/** Built-ins + custom for a given type (custom listed first). */
export async function materialsForType(type: MaterialType): Promise<Material[]> {
  const custom = (await loadCustom()).filter((m) => m.type === type);
  return [...custom, ...builtinsForType(type)];
}

/** Look up a material by name+type across built-ins and custom. */
export async function findMaterial(name: string, type: MaterialType): Promise<Material | undefined> {
  return (await materialsForType(type)).find((m) => m.name === name);
}
