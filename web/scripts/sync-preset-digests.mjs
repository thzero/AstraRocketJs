// Attach OpenRocket's own part digests to the component catalog.
//
//   npm run sync:preset-digests                     the installed OpenRocket
//   npm run sync:preset-digests -- --jar <path.jar>  a particular release
//   npm run sync:preset-digests -- --or <checkout>   a built source tree
//
// What a digest is for. A `.ork` names a catalog part with
// `<preset type=… manufacturer=… partno=… digest=…/>`, and the digest is how the
// desktop decides whether the part in its library today is still the part the
// file was built with. An element without one is rejected outright ("Invalid
// ComponentPreset for component Body Tube, no digest specified") and the
// component opens unlinked, so a catalog row with no digest is a row whose link
// we deliberately leave out of the file (see ork/exportParts.presetXml).
//
// Why it shells out to Java. The digest is an MD5 over the preset's properties
// as `ComponentPresetFactory` leaves them, not as the `.orc` states them: a
// tube's wall is derived from its two diameters, a material density from a
// stated mass, and an integer property contributes its name and no value. A
// JavaScript reimplementation is a second copy of that logic, and a wrong digest
// is worse than no digest: the desktop then reports the part as changed rather
// than missing. So `scripts/preset-digests/PresetDump.java` runs the real loader
// and asks each preset for its own digest, and this script only merges.
//
// Point it at the OpenRocket people actually run. A part whose `.orc` row states
// a mass has its material replaced by one looked up by density, so its digest
// depends on the material database that build ships. Measured on Estes PNC-50KA:
// the 24.12 release says b3b5899e… and the 26.xx source tree says d1a20a7d…,
// while the parts with no stated mass agree across both. A digest from the wrong
// build is a digest the desktop rejects, so `--jar` (a release, the usual case)
// is preferred over `--or` (a built source checkout, which also needs its test
// classes for the preferences bindings).
//
// Nothing here is part of the app build; this is a data step, run when the
// catalog is refreshed.
//
// Which databases it covers is whatever that build of OpenRocket ships on its
// classpath, because the dumper reads the application's own preset database
// rather than `.orc` files: the file loader and the app disagree for some types
// (Estes PK-12 came out cd19839d… from the files and e38b3873… from the app),
// and the app's value is the one the desktop compares against.
//
// It never regenerates the catalog, only adds `digest` to rows already in it,
// matched on type, manufacturer, part number and description. The library
// holds parts that share a part number and differ in size (a legacy file and
// the database both list it), and the desktop tells them apart by digest, so
// matching on the part number alone would hand one of them the other's digest.
// A row whose description does not match falls back to type, manufacturer and
// part number when only one part has those. A row that build does not contain
// has any digest removed, and is otherwise left alone.
//
// It also carries a stated mass the way the desktop applies it, with the mass
// read from the same loader. `ComponentPresetFactory` turns the mass of a tube,
// ring, bulkhead, engine block, nose cone or transition into its material's
// density (the mass spread over the part's volume), so the part weighs what the
// catalog says. The volume is measured in the app's own engine
// (lib/presetVolume.mjs), not taken from the desktop's density, because builds
// disagree on it; the result replaces the row's `materialDensity`, and the mass
// stays on the row as `mass`. `Parachute.loadPreset` instead takes the mass as
// a mass override, which the app applies from `mass`. A streamer's mass is not
// applied by the desktop and is not carried.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeDataManifest } from './lib/dataManifest.mjs';
import { chooseBuild, runDumper } from './lib/openrocketJava.mjs';
import { presetVolumes } from './lib/presetVolume.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CATALOG = resolve(HERE, '../public/data/components.generated.json');
const JAVA_SRC = resolve(HERE, 'preset-digests/PresetDump.java');

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

/** `ComponentPreset.Type` as the catalog spells it: `NOSE_CONE` → `nosecone`. */
const appType = (kernelType) => kernelType.toLowerCase().replace(/_/g, '');

/**
 * Digest and stated mass for every preset that build holds, findable by the
 * full key and, where it identifies one part, by type, maker and part number.
 */
function dump(cp) {
  const exact = new Map();
  const byPart = new Map();
  for (const [type, mfr, partNo, digest, mass, desc = ''] of runDumper({
    cp,
    javaSrc: JAVA_SRC,
    className: 'PresetDump',
  })) {
    const n = (v) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
    const preset = { digest, mass: n(mass) };
    const key = JSON.stringify([appType(type), mfr, partNo, desc.replace(/\s+/g, ' ').trim()]);
    if (!exact.has(key)) exact.set(key, preset);
    const part = JSON.stringify([appType(type), mfr, partNo]);
    byPart.set(part, byPart.has(part) ? null : preset);
  }
  return (row) =>
    exact.get(JSON.stringify([row.type, row.mfr, row.partNo, row.desc.replace(/\s+/g, ' ').trim()])) ??
    byPart.get(JSON.stringify([row.type, row.mfr, row.partNo])) ??
    undefined;
}

async function main() {
  const { cp, label } = chooseBuild();
  console.log(`reading presets from ${label}`);
  console.log('dumping presets:');
  const presetFor = dump(cp);
  const volumeOf = await presetVolumes();

  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
  const before = catalog.components.filter((c) => c.digest).length;
  let hit = 0;
  let massed = 0;
  for (const row of catalog.components) {
    const p = presetFor(row);
    if (p?.digest) {
      row.digest = p.digest;
      hit++;
    } else {
      delete row.digest;
    }
    // A rail button's mass is the button, screw and nut, which sync-components
    // reads from the part file itself; every other stated mass is set here.
    if (row.type !== 'railbutton') delete row.mass;
    const volume = p?.mass && DENSITY_FROM_MASS.has(row.type) ? volumeOf(row) : null;
    if (p?.mass && volume) {
      row.materialDensity = p.mass / volume;
      row.mass = p.mass;
      massed++;
    } else if (p?.mass && row.type === 'parachute') {
      row.mass = p.mass;
      massed++;
    }
  }
  // The same guard `sync-components.mjs` has, for the same reason: a run that
  // silently loses coverage is a broken classpath, not a smaller database.
  if (hit < before) {
    throw new Error(`refusing to write: digests fell from ${before} to ${hit}. Nothing written.`);
  }
  writeFileSync(CATALOG, `${JSON.stringify(catalog, null, 2)}\n`);
  // The catalog changed, so its cache-bust hash has to as well.
  writeDataManifest(dirname(CATALOG));
  console.log(`digests: ${hit} of ${catalog.count} catalog rows (was ${before}); stated masses applied: ${massed}`);
}

await main();
