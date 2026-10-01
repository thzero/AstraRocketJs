// Attach OpenRocket's own part digests to the component catalog.
//
//   npm run sync:preset-digests                     the installed OpenRocket
//   npm run sync:preset-digests -- --jar <path.jar>  a particular release
//   npm run sync:preset-digests -- --or <checkout>   a built source tree
//
// WHAT A DIGEST IS FOR. A `.ork` names a catalog part with
// `<preset type=… manufacturer=… partno=… digest=…/>`, and the digest is how the
// desktop decides whether the part in ITS library today is still the part the
// file was built with. An element without one is rejected outright ("Invalid
// ComponentPreset for component Body Tube, no digest specified") and the
// component opens unlinked, so a catalog row with no digest is a row whose link
// we deliberately leave out of the file (see ork/exportParts.presetXml).
//
// WHY IT SHELLS OUT TO JAVA. The digest is an MD5 over the preset's properties
// as `ComponentPresetFactory` leaves them, not as the `.orc` states them: a
// tube's wall is derived from its two diameters, a material density from a
// stated mass, and an integer property contributes its name and no value. A
// JavaScript reimplementation is a second copy of that logic, and a wrong digest
// is worse than no digest: the desktop then reports the part as CHANGED rather
// than missing. So `scripts/preset-digests/PresetDump.java` runs the real loader
// and asks each preset for its own digest, and this script only merges.
//
// POINT IT AT THE OPENROCKET PEOPLE ACTUALLY RUN. A part whose `.orc` row states
// a MASS has its material replaced by one looked up by density, so its digest
// depends on the material database that build ships. Measured on Estes PNC-50KA:
// the 24.12 release says b3b5899e… and the 26.xx source tree says d1a20a7d…,
// while the parts with no stated mass agree across both. A digest from the wrong
// build is a digest the desktop rejects, so `--jar` (a release, the usual case)
// is preferred over `--or` (a built source checkout, which also needs its TEST
// classes for the preferences bindings).
//
// Nothing here is part of the app build; this is a data step, run when the
// catalog is refreshed.
//
// WHICH DATABASES IT COVERS is whatever that build of OpenRocket ships on its
// classpath, because the dumper reads the application's own preset database
// rather than `.orc` files: the file loader and the app disagree for some types
// (Estes PK-12 came out cd19839d… from the files and e38b3873… from the app),
// and the app's value is the one the desktop compares against.
//
// It never regenerates the catalog, only adds `digest` to rows already in it,
// matched on manufacturer and part number. A row that build does not contain
// keeps no digest and is left alone.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chooseBuild, runDumper } from './openrocketJava.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CATALOG = resolve(HERE, '../public/data/components.generated.json');
const JAVA_SRC = resolve(HERE, 'preset-digests/PresetDump.java');

/** `TYPE	manufacturer	partNo	digest` for every preset that build holds. */
function dump(cp) {
  const rows = new Map();
  for (const [, mfr, partNo, digest] of runDumper({ cp, javaSrc: JAVA_SRC, className: 'PresetDump' })) {
    // One row per part; the database has already resolved any duplicates.
    const key = JSON.stringify([mfr, partNo]);
    if (!rows.has(key)) rows.set(key, digest);
  }
  return rows;
}

function main() {
  const { cp, label } = chooseBuild();
  console.log(`reading presets from ${label}`);
  console.log('dumping presets:');
  const digests = dump(cp);

  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
  const before = catalog.components.filter((c) => c.digest).length;
  let hit = 0;
  for (const row of catalog.components) {
    const d = digests.get(JSON.stringify([row.mfr, row.partNo]));
    if (d) {
      row.digest = d;
      hit++;
    } else {
      delete row.digest;
    }
  }
  // The same guard `sync-components.mjs` has, for the same reason: a run that
  // silently halves the coverage is a broken classpath, not a smaller database.
  if (hit < before) {
    throw new Error(`refusing to write: digests fell from ${before} to ${hit}. Nothing written.`);
  }
  writeFileSync(CATALOG, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`digests: ${hit} of ${catalog.count} catalog rows (was ${before})`);
}

main();
