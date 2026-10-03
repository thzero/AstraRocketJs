// Attach OpenRocket's own motor digests to the motor catalog.
//
//   npm run sync:motor-digests                      the installed OpenRocket
//   npm run sync:motor-digests -- --jar <path.jar>   a particular release
//   npm run sync:motor-digests -- --or <checkout>    a built source tree
//
// WHAT THE DIGEST IS FOR. A `.ork` names a motor by manufacturer, designation,
// diameter and length, and the desktop's database holds SEVERAL entries behind
// one of those names: Estes C6 is three, a plugged one and two copies of the
// delayed one, loaded from different source files. With nothing to choose
// between them `DatabaseMotorFinder` takes the first and says so, as "Multiple
// motors with designation 'C6' for manufacturer 'Estes' found, one chosen
// arbitrarily". The `<digest>` element is the only field that names WHICH entry,
// which is why the desktop writes one into every `<motor>` block it saves.
//
// WHY THE DIGEST IS COPIED RATHER THAN COMPUTED. It is an MD5 over the motor's
// time, mass, CG and thrust series at fixed precision, so it describes the
// samples in THAT database rather than the motor as a product. Our curves come
// from thrustcurve.org and the desktop's from a database serialized at its
// release; the same motor, not always the same samples. A digest we computed
// from our own curve would therefore name no entry at all, and a digest that
// matches nothing is WORSE than none: where there is only one candidate the
// desktop reports the motor as CHANGED instead of resolving it quietly.
//
// WHICH ENTRY A ROW GETS. All of them that the key matches, each with the
// delays that entry offers, because a plugged C6 and a delayed C6 are different
// motors with different digests and the design knows which one it seated. The
// writer picks by delay (`exportMotors.ts`).
//
// MATCHING is on manufacturer, designation and diameter, with length as a
// tolerance check. Both of the desktop's names are tried, because its
// designation is the maker's full code ("D24T") and its common name the impulse
// one ("D24"), and a row synced from thrustcurve.org carries whichever that
// motor published. The manufacturer has to go through `Manufacturer.getAllNames`
// because our catalog names a maker by thrustcurve.org's abbreviation, where the
// desktop holds the full name, and that class is the only place that knows "AT"
// and "AeroTech" are one maker.
//
// Nothing here is part of the app build; this is a data step, run when the motor
// catalog is refreshed. It never regenerates the catalog, only adds `digests` to
// rows already in it.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chooseBuild, runDumper } from './lib/openrocketJava.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CATALOG = resolve(HERE, '../public/data/motors.generated.json');
const JAVA_SRC = resolve(HERE, 'motor-digests/MotorDump.java');

/** Manufacturer and designation compared the way a human reads them. */
const norm = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const key = (mfr, designation, diameterMm) => `${norm(mfr)}|${norm(designation)}|${Math.round(diameterMm)}`;

/** A motor's length may be stated to the tenth of a millimeter either side. */
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
    };
    // Under both names: the desktop's designation is the maker's full code
    // ("D24T") and its common name the impulse one ("D24"), and a catalog row
    // synced from thrustcurve.org is keyed on whichever that motor published.
    for (const name of allNames.split('|')) {
      for (const d of new Set([designation, commonName])) {
        const k = key(name, d, Number(diameter) * 1000);
        if (!index.has(k)) index.set(k, []);
        index.get(k).push(entry);
      }
    }
  }
  return index;
}

/**
 * How far one dumped entry's curve is from the one our catalog holds, as summed
 * relative error over total impulse, burn time and peak thrust.
 *
 * Only used to order candidates: where a name resolves to several entries and
 * the delay does not separate them, this is what decides, so the desktop flies
 * the motor the design was built with rather than a namesake. A row that states
 * none of the three scores zero, which leaves the digest order to decide.
 */
function distance(entry, row) {
  let sum = 0;
  for (const [ours, theirs] of [
    [row.impulse, entry.impulse],
    [row.burn, entry.burn],
    [row.maxThrust, entry.maxThrust],
  ]) {
    if (!Number.isFinite(ours) || !Number.isFinite(theirs) || ours === 0) continue;
    sum += Math.abs(theirs - ours) / Math.abs(ours);
  }
  return sum;
}

/**
 * The entries for one catalog row: deduplicated by digest, with the delays each
 * one offers merged, closest curve first, and ties broken on the digest so a
 * re-run writes the same bytes.
 */
function entriesFor(index, row) {
  const found = index.get(key(row.manufacturer, row.designation, row.diameter));
  if (!found) return null;
  const fits =
    row.length == null ? found : found.filter((e) => Math.abs(e.lengthMm - row.length) <= LENGTH_TOLERANCE_MM);
  if (!fits.length) return null;
  const byDigest = new Map();
  for (const e of fits) {
    const seen = byDigest.get(e.digest) ?? { delays: new Set(), distance: Infinity };
    for (const d of e.delays) seen.delays.add(d);
    seen.distance = Math.min(seen.distance, distance(e, row));
    byDigest.set(e.digest, seen);
  }
  return [...byDigest]
    .sort(([da, a], [db, b]) => a.distance - b.distance || (da < db ? -1 : 1))
    .map(([digest, { delays }]) => ({
      digest,
      delays: [...delays].sort((a, b) => (a === 'P' ? 1 : b === 'P' ? -1 : a - b)),
    }));
}

function main() {
  const { cp, label } = chooseBuild();
  console.log(`reading motors from ${label}`);
  console.log('dumping motors:');
  const index = dump(cp);

  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
  const before = catalog.filter((m) => m.digests).length;
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
  // The same guard the other sync steps have, for the same reason: a run that
  // silently halves the coverage is a broken classpath, not a smaller database.
  if (hit < before) {
    throw new Error(`refusing to write: motors with digests fell from ${before} to ${hit}. Nothing written.`);
  }
  writeFileSync(CATALOG, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(
    `digests: ${hit} of ${catalog.length} catalog motors (was ${before}), ${ambiguous} needing the delay to choose`,
  );
}

main();
