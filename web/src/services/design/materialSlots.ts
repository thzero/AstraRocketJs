import { KERNEL_MATERIALS } from '../../tree/kernelDefaults';
import type { MaterialType } from '../materials/materialTypes';

/**
 * What a part is MADE OF by default: which material slots each type has, and
 * what goes in them when nobody has said.
 *
 * Its own module, and a leaf one. `services/materials/materials` reaches the material
 * CATALOG, which pulls in the remote-data fetch and the IndexedDB custom store,
 * and the default rocket is built in `engine/api`, where none of that belongs.
 * Nothing here needs a catalog: the three stock materials are the kernel's own
 * and are named in `tree/kernelDefaults`.
 */

/**
 * Which node keys a material of each kind lands on. A part carries up to three
 * at once — a parachute has a canopy AND shroud lines — so the material type is
 * what decides, not the part.
 *
 * Only the bulk material has a `group` key. The `.ork` writer emits the group
 * attribute for a bulk material and not for the other two, so there is nowhere
 * for a surface or line group to go.
 */
const MATERIAL_KEYS: Record<MaterialType, { name: string; density: string; group?: string }> = {
  bulk: { name: 'materialName', density: 'density', group: 'materialGroup' },
  surface: { name: 'surfaceMaterialName', density: 'surfaceDensity' },
  line: { name: 'lineMaterialName', density: 'lineDensity' },
};

/**
 * Which material kinds each part type has a slot for.
 *
 * One list, read by Settings ▸ Materials to draw its rows and by
 * {@link defaultMaterialPatch} to decide what a new part is made of. Most parts
 * have exactly one; a parachute has two, its canopy and its shroud lines, which
 * is why this is keyed by the PAIR rather than by the part.
 *
 * A type that is not here has no material at all: a stage, a pod set and a mass
 * component carry a mass outright rather than a density and a volume.
 */
export const MATERIAL_SLOTS: readonly { part: string; material: MaterialType }[] = [
  { part: 'nosecone', material: 'bulk' },
  { part: 'bodytube', material: 'bulk' },
  { part: 'transition', material: 'bulk' },
  { part: 'trapezoidfinset', material: 'bulk' },
  { part: 'ellipticalfinset', material: 'bulk' },
  { part: 'freeformfinset', material: 'bulk' },
  { part: 'tubefinset', material: 'bulk' },
  { part: 'innertube', material: 'bulk' },
  { part: 'tubecoupler', material: 'bulk' },
  { part: 'centeringring', material: 'bulk' },
  { part: 'bulkhead', material: 'bulk' },
  { part: 'engineblock', material: 'bulk' },
  { part: 'launchlug', material: 'bulk' },
  { part: 'railbutton', material: 'bulk' },
  { part: 'parachute', material: 'surface' },
  { part: 'parachute', material: 'line' },
  { part: 'streamer', material: 'surface' },
  { part: 'shockcord', material: 'line' },
];

/** The settings key for one part type's material of one kind. */
export const defaultMaterialKey = (partType: string, materialType: MaterialType): string =>
  `${partType}:${materialType}`;

/**
 * What to stamp onto a NEWLY ADDED part of `partType`: the user's per-part-type
 * default (Settings ▸ Materials) where they have set one, and otherwise the
 * material the kernel would weigh the part with anyway
 * ({@link KERNEL_MATERIALS}).
 *
 * The preference is spent here, at creation, rather than resolved later: the
 * part ends up carrying a real material that shows in the panel and is written
 * to the `.ork`. Desktop OpenRocket keeps the part unset and applies its
 * equivalent preference at runtime, which means the same file weighs one thing
 * on the machine that made it and another on the machine it was sent to.
 *
 * The kernel fallback is why a new part no longer reads "Not specified". That
 * state was never a lighter part - the kernel was already flying it as
 * cardboard, ripstop nylon or elastic cord - but nothing in the editor said so,
 * and it did not survive a round trip either, since the `.ork` writer fills the
 * same three materials in and the reader hands them back. The panel now says
 * what the simulation is using, before the save rather than after it, which is
 * also what the desktop shows: every OpenRocket component is constructed WITH
 * one of these, so its own dropdown never has an empty state to explain.
 *
 * Returns `{}` for a type with no material slot at all (a stage, a pod set, a
 * mass component, which carries a mass outright).
 */
export function defaultMaterialPatch(
  partType: string,
  defaults: Record<string, { name: string; density: number }>,
): Record<string, string | number> {
  const patch: Record<string, string | number> = {};
  for (const { part, material } of MATERIAL_SLOTS) {
    if (part !== partType) continue;
    const keys = MATERIAL_KEYS[material];
    const chosen = defaults[defaultMaterialKey(partType, material)];
    patch[keys.name] = chosen ? chosen.name : KERNEL_MATERIALS[material].name;
    patch[keys.density] = chosen ? chosen.density : KERNEL_MATERIALS[material].density;
    // The group only rides along on the kernel's own material, whose `.ork`
    // database string is known here. A material the user picked carries no
    // group through the settings, the same as one picked in the panel.
    if (keys.group && !chosen) patch[keys.group] = KERNEL_MATERIALS[material].group;
  }
  return patch;
}
