// A catalog row's stated mass, applied the way the desktop applies it
// (sync-preset-digests.mjs runs it on every row).

/** Catalog types whose stated mass the desktop turns into a material density. */
const DENSITY_FROM_MASS = new Set([
  'bodytube',
  'launchlug',
  'tubecoupler',
  'centeringring',
  'engineblock',
  'bulkhead',
  'nosecone',
  'transition',
]);

/**
 * Apply the mass the desktop's loader states for a row (kg, or null for none).
 *
 * `ComponentPresetFactory` turns the mass of a tube, ring, bulkhead, engine
 * block, nose cone or transition into its material's density, so the row takes
 * the mass spread over the volume `volumeOf` measures, and keeps the mass as
 * `mass`. `Parachute.loadPreset` takes a parachute's as its mass override. A
 * rail button's mass comes from its own file and is left alone; any other
 * row's `mass` is removed.
 *
 * Returns 'applied', 'no-volume' for a row that states a mass the engine gives
 * no volume to spread it over (it keeps its material's density and no `mass`,
 * and the caller has to say so), or null when there is nothing to apply.
 */
export function applyStatedMass(row, mass, volumeOf) {
  if (row.type !== 'railbutton') delete row.mass;
  if (!mass) return null;
  if (row.type === 'parachute') {
    row.mass = mass;
    return 'applied';
  }
  if (!DENSITY_FROM_MASS.has(row.type)) return null;
  const volume = volumeOf(row);
  if (!volume) return 'no-volume';
  row.materialDensity = mass / volume;
  row.mass = mass;
  return 'applied';
}
