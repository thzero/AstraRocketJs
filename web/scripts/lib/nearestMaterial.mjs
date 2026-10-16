// cspell:ignore ldpe -- a catalog material name, lowercased as the key.
// Materials catalog parts name that resolve to no density: neither the part's
// own file nor desktop's library defines them, or the file defines them at 0.
// Desktop weighs such a part at 0 g, which moves the CG and the flight, so the
// catalog gives it the nearest built-in material instead, under that material's
// own name. Keyed by type and lowercased name.
//
// A part that states its mass takes its density from that mass, so its material
// need not resolve. One that states none and names a material missing here goes
// out at density 0, and catalogPatch.kernel.test.ts fails on it, so a new name
// is decided rather than shipped weightless.
const NEAREST = new Map([
  ['BULK\u0000balsa, bulk, estes typical', 'Balsa'],
  ['BULK\u0000light ply', 'Plywood (birch)'],
  ['SURFACE\u0000paper', 'Paper (office)'],
  ['SURFACE\u0000polyethylene ldpe', 'Polyethylene (thin)'],
  ['SURFACE\u0000rip stop nylon', 'Ripstop nylon'],
]);

/**
 * The nearest built-in material for one that resolved to no density, or
 * undefined when none is listed. `densityOf(type, name)` looks a built-in
 * material up; the stand-in has to resolve there, or the sync stops.
 */
export function nearestMaterial(type, name, densityOf) {
  const nearest = NEAREST.get(`${type}\u0000${name.toLowerCase()}`);
  if (!nearest) return undefined;
  const density = densityOf(type, nearest);
  if (!(density > 0))
    throw new Error(`nearestMaterial: the stand-in "${nearest}" (${type}) is not a built-in material`);
  return { material: nearest, materialDensity: density };
}
