// Desktop's built-in materials, for the build-time scripts.
import { fileURLToPath } from 'node:url';
import { runDumper } from './openrocketJava.mjs';

const key = (type, name) => `${type}\u0000${name.toLowerCase()}`;

/**
 * The bulk, surface and line densities of the built-in materials the build on
 * `cp` ships, which a catalog part falls back to when its own file does not
 * define its material. Read from that build's own `Databases`
 * (preset-digests/MaterialDump.java), not from the material catalog: that
 * catalog comes from the source tree the engine is extracted from, which has
 * materials the release does not, and a part naming one of those weighs
 * nothing on desktop.
 *
 * Returns `densityOf(type, name)`, undefined for a material the build lacks.
 * The name is compared ignoring case, as `Databases.findMaterial` compares it.
 */
export function builtInMaterials(cp) {
  const rows = runDumper({
    cp,
    javaSrc: fileURLToPath(new URL('../preset-digests/MaterialDump.java', import.meta.url)),
    className: 'MaterialDump',
  });
  const density = new Map(rows.map(([type, name, d]) => [key(type, name), Number(d)]));
  return (type, name) => density.get(key(type, name));
}
