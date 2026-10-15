// Attach OpenRocket's own motor digests to the motor catalog.
//
//   npm run sync:motor-digests                      the installed OpenRocket
//   npm run sync:motor-digests -- --jar <path.jar>   a particular release
//   npm run sync:motor-digests -- --or <checkout>    a built source tree, with OPENROCKET_UNPINNED=1
//
// What the digest is for. A `.ork` names a motor by manufacturer, designation,
// diameter and length, and the desktop's database holds several entries behind
// one of those names: Estes C6 is three, a plugged one and two copies of the
// delayed one, loaded from different source files. With nothing to choose
// between them `DatabaseMotorFinder` takes the first and says so, as "Multiple
// motors with designation 'C6' for manufacturer 'Estes' found, one chosen
// arbitrarily". The `<digest>` element is the only field that names which entry,
// which is why the desktop writes one into every `<motor>` block it saves.
//
// Why the digest is copied rather than computed. It is an MD5 over the motor's
// time, mass, CG and thrust series at fixed precision, so it describes the
// samples in that database rather than the motor as a product. Our curves come
// from thrustcurve.org and the desktop's from a database serialized at its
// release; the same motor, not always the same samples. A digest we computed
// from our own curve would therefore name no entry at all, and a digest that
// matches nothing is worse than none: where there is only one candidate the
// desktop reports the motor as changed instead of resolving it quietly.
//
// Which entry a row gets. All of them that the key matches, each with the
// delays that entry offers, because a plugged C6 and a delayed C6 are different
// motors with different digests and the design knows which one it seated. The
// writer picks by delay (`exportMotors.ts`), and where the delay does not
// separate them it takes the first, so they are ordered closest to the motor
// the app flies first: launch mass, then the curve (`lib/digestRank.mjs`).
//
// Matching is on manufacturer, designation and diameter to the tenth of a
// millimeter (lib/motorDigestKey.mjs), with length as a tolerance check. Both
// of the desktop's names are tried, because its designation is the maker's
// full code ("D24T") and its common name the impulse one ("D24"), and a row
// synced from thrustcurve.org carries whichever that motor published. The
// manufacturer has to go through `Manufacturer.getAllNames`
// because our catalog names a maker by thrustcurve.org's abbreviation, where the
// desktop holds the full name, and that class is the only place that knows "AT"
// and "AeroTech" are one maker.
//
// Nothing here is part of the app build; this is a data step, run when the motor
// catalog is refreshed. It never regenerates the catalog, only adds `digests` to
// rows already in it.
//
// It reads the catalog sync-motors staged (lib/catalogStaging.mjs), or, with
// none staged, the catalog in public/data, and writes the finished catalog to
// public/data.
import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGED_MOTORS, writeFileAtomic } from './lib/catalogStaging.mjs';
import { writeDataManifest } from './lib/dataManifest.mjs';
import { digestChanges, goneSection, motorProblems } from './lib/digestCoverage.mjs';
import { digestKey } from './lib/motorDigestKey.mjs';
import { motorRowKey } from './lib/motorRowKey.mjs';
import { rankEntries } from './lib/digestRank.mjs';
import { chooseBuild, runDumper } from './lib/openrocketJava.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CATALOG = resolve(HERE, '../public/data/motors.generated.json');
const JAVA_SRC = resolve(HERE, 'motor-digests/MotorDump.java');

/** How far the two databases' stated lengths for one motor may differ, in millimeters. */
const LENGTH_TOLERANCE_MM = 2;

/** Every dumped entry, indexed under each name its manufacturer answers to. */
function dump(cp) {
  const index = new Map();
  for (const [
    ,
    allNames,
    designation,
    commonName,
    diameter,
    length,
    delays,
    impulse,
    burn,
    maxThrust,
    launchMass,
    digest,
  ] of runDumper({
    cp,
    javaSrc: JAVA_SRC,
    className: 'MotorDump',
  })) {
    const entry = {
      digest,
      delays: delays ? delays.split(',').map((d) => (d === 'P' ? 'P' : Number(d))) : [],
      lengthMm: Number(length) * 1000,
      impulse: Number(impulse),
      burn: Number(burn),
      maxThrust: Number(maxThrust),
      launchMass: Number(launchMass),
    };
    // Under both names: the desktop's designation is the maker's full code
    // ("D24T") and its common name the impulse one ("D24"), and a catalog row
    // synced from thrustcurve.org is keyed on whichever that motor published.
    for (const name of allNames.split('|')) {
      for (const d of new Set([designation, commonName])) {
        const k = digestKey(name, d, Number(diameter) * 1000);
        if (!index.has(k)) index.set(k, []);
        index.get(k).push(entry);
      }
    }
  }
  return index;
}

/**
 * The entries for one catalog row, each with the delays it offers, ranked
 * closest to what the app flies first (`lib/digestRank.mjs`).
 */
function entriesFor(index, row) {
  const found = index.get(digestKey(row.manufacturer, row.designation, row.diameter));
  if (!found) return null;
  const fits =
    row.length == null ? found : found.filter((e) => Math.abs(e.lengthMm - row.length) <= LENGTH_TOLERANCE_MM);
  return fits.length ? rankEntries(fits, row) : null;
}

/** A motor's row key and whether it carries a digest, for `digestChanges`. */
const digestState = (m) => ({ key: motorRowKey(m), digested: Boolean(m.digests?.length) });

function main() {
  const { cp, label } = chooseBuild();
  console.log(`reading motors from ${label}`);
  console.log('dumping motors:');
  const index = dump(cp);

  // The finished catalog now in public/data is the one this run is held to.
  const previous = existsSync(CATALOG) ? JSON.parse(readFileSync(CATALOG, 'utf8')) : null;
  const staged = existsSync(STAGED_MOTORS);
  const catalog = staged ? JSON.parse(readFileSync(STAGED_MOTORS, 'utf8')) : previous;
  if (!catalog) throw new Error(`nothing to add digests to: no ${STAGED_MOTORS} and no ${CATALOG}`);
  console.log(`catalog: ${staged ? 'staged by sync-motors' : CATALOG}`);
  // Taken before the loop below, which edits `catalog`, and `catalog` is
  // `previous` itself when nothing is staged.
  const baseline = (Array.isArray(previous) ? previous : catalog).map(digestState);
  const before = baseline.filter((m) => m.digested).length;
  let hit = 0;
  let ambiguous = 0;
  for (const row of catalog) {
    const entries = entriesFor(index, row);
    if (entries) {
      row.digests = entries;
      hit++;
      if (entries.length > 1) ambiguous++;
    } else {
      delete row.digests;
    }
  }
  // A motor that kept its row and lost its digest is a broken classpath or a
  // changed matcher: refuse it, and a catalog under the floor however it got
  // there. A motor thrustcurve.org deleted or merged took its digest with it,
  // which is reported and not refused.
  const { lost, gone } = digestChanges(baseline, catalog.map(digestState));
  const goneText = goneSection('Motors', gone);
  if (goneText) {
    console.log(goneText);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${goneText}\n`);
  }
  if (lost.length) {
    throw new Error(
      `refusing to write: ${lost.length} motors still in the catalog lost their digests (${lost.join(', ')}). Nothing written.`,
    );
  }
  const problems = motorProblems(catalog);
  if (problems.length) throw new Error(`refusing to write: ${problems.join('; ')}. Nothing written.`);
  // Compact, as sync-motors writes it: browsers download this file and keep it
  // for offline use, and indentation would triple its size.
  writeFileAtomic(CATALOG, `${JSON.stringify(catalog)}\n`);
  // The catalog changed, so its cache-bust hash has to as well.
  writeDataManifest(dirname(CATALOG));
  rmSync(STAGED_MOTORS, { force: true });
  console.log(
    `digests: ${hit} of ${catalog.length} catalog motors (was ${before}), ${ambiguous} needing the delay to choose`,
  );
}

main();
