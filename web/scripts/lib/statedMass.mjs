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
  'railbutton',
]);

/**
 * Apply the mass the desktop's loader states for a row (kg, or null for none).
 *
 * `ComponentPresetFactory` turns the mass of a tube, ring, bulkhead, engine
 * block, nose cone, transition or rail button into its material's density, so
 * the row takes the mass spread over the volume `volumeOf` measures, and keeps
 * the mass as `mass`. `Parachute.loadPreset` takes a parachute's as its mass
 * override. A rail button's `mass` is the button, screw and nut together that
 * `RailButton.loadFromPreset` takes as its mass override, read from its own
 * file, so it is kept as it is and only its density comes from the button's
 * own stated mass (`makeRailButton`); any other row's `mass` is removed.
 *
 * Returns 'applied', 'no-volume' for a row that states a mass the engine gives
 * no volume to spread it over (it keeps its material's density and no `mass`,
 * and the caller refuses the catalog), 'degenerate' for one the desktop gives
 * no volume either (`desktopHasVolume` false: `ComponentPresetFactory` divides
 * by zero, so the mass applies in neither build and the row keeps its
 * material's density and no `mass`), or null when there is nothing to apply.
 */
export function applyStatedMass(row, mass, volumeOf, desktopHasVolume = true) {
  if (row.type !== 'railbutton') delete row.mass;
  if (!mass) return null;
  if (row.type === 'parachute') {
    row.mass = mass;
    return 'applied';
  }
  if (!DENSITY_FROM_MASS.has(row.type)) return null;
  const volume = volumeOf(row);
  if (!volume) return desktopHasVolume ? 'no-volume' : 'degenerate';
  row.materialDensity = mass / volume;
  if (row.type !== 'railbutton') row.mass = mass;
  return 'applied';
}

/**
 * Stated masses applied across a catalog, counted, with the run's decision on
 * them. A row that states a mass the engine gives no volume to spread it over
 * (a degenerate upstream shape) would weigh what its material makes it, not
 * what desktop says, and the stated-mass test only sees rows that keep their
 * mass, so `refusal` is the reason not to write the catalog, or null.
 */
export function statedMassTally() {
  let massed = 0;
  const noVolume = [];
  const degenerate = [];
  const label = (row, mass) =>
    `${row.type} ${row.mfr} ${String(row.partNo).trim()} (${Number((mass * 1000).toPrecision(4))} g)`;
  return {
    /** {@link applyStatedMass} on one row. */
    apply(row, mass, volumeOf, desktopHasVolume = true) {
      const applied = applyStatedMass(row, mass, volumeOf, desktopHasVolume);
      if (applied === 'applied') massed++;
      else if (applied === 'no-volume') noVolume.push(label(row, mass));
      else if (applied === 'degenerate') degenerate.push(label(row, mass));
      return applied;
    },
    get massed() {
      return massed;
    },
    /** The rows whose stated mass neither build can apply, for the run's log. */
    get degenerate() {
      return degenerate;
    },
    refusal() {
      return noVolume.length
        ? `refusing to write: the engine gives these parts no volume to spread their stated mass over: ${noVolume.join(', ')}. Nothing written.`
        : null;
    },
  };
}
