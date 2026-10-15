// Build-time motor catalog sync from the ThrustCurve.org API.
//
// Ships the full motor: factual specs (impulse, burn, mass, dimensions) and the
// thrust-curve samples, plus the length + propellant weight needed to build a
// simulatable motor. Everything is in the catalog file, so a picked motor
// resolves offline and instantly, with no runtime thrustcurve.org call.
//
// Run manually or in CI (never inside `vite build`):  node scripts/sync-motors.mjs
// Data © thrustcurve.org contributors and the certifying bodies (NAR/TRA/CAR).

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGED_MOTORS } from './lib/catalogStaging.mjs';
import { motorRow } from './lib/motorRow.mjs';
import { collidingRowKeys } from './lib/motorRowKey.mjs';

const API = 'https://www.thrustcurve.org/api/v1';
// public/data is served as-is (not bundled) so the catalog can be refreshed
// without rebuilding the app; see src/services/app/remoteData.ts.
const DATA_DIR = fileURLToPath(new URL('../public/data', import.meta.url));
const OUT = resolve(DATA_DIR, 'motors.generated.json');

async function post(path, body) {
  const res = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

/** Code-unit order, which no locale changes. */
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const chunk = (arr, size) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

/** Fetch thrust-curve files for a batch of motorIds → Map<motorId, file[]>.
 *  `data: 'both'` also returns the raw file (base64) so we can read the loaded
 *  mass and CG straight from it: the values OpenRocket uses (see below). */
async function fetchSamples(ids) {
  const out = new Map();
  const { results: files = [] } = await post('download.json', { motorIds: ids, data: 'both', maxResults: 4000 });
  for (const f of files) {
    if (!f.samples || f.samples.length < 2) continue;
    // The curves' final tie-break (lib/rankCurves.mjs). Without it the default
    // curve would follow the order the API returned the files in.
    if (!f.simfileId) throw new Error(`download.json: a file for motor ${f.motorId} has no simfileId`);
    if (!out.has(f.motorId)) out.set(f.motorId, []);
    out.get(f.motorId).push({
      simfileId: f.simfileId,
      source: f.source,
      format: f.format,
      samples: f.samples,
      data: f.data,
    });
  }
  return out;
}

// The search API pages at this many results. Hitting it exactly means the list
// was cut off, not that the catalog happens to be this size.
const MAX_RESULTS = 5000;

/**
 * Refuse to publish a catalog that is much smaller than the last one.
 *
 * This script runs on a schedule with write access to the branch the live app
 * reads, and the publish step only checks that the file changed. An API glitch
 * that returned 200 with an empty list, or a schema change that made every
 * row fail the `totImpulseNs > 0` filter, would have gone live to every user
 * on their next open and emptied the motor picker. The app validates row
 * shape, not catalog size, so the floor has to be here.
 *
 * Row-key collisions are refused here for the same reason: a check that only
 * warns, or that runs after the publish, lets a colliding pair reach every
 * user's motor picker with a green workflow. A collision makes two distinct
 * motors select, check and highlight as one, and it is a property of the
 * upstream data, so it is checked on every sync rather than assumed.
 */
async function assertSane(catalog, withCurves) {
  const problems = [];
  if (catalog.length === 0) problems.push('catalog is empty');
  const collisions = collidingRowKeys(catalog);
  if (collisions.length)
    problems.push(
      `${collisions.length} row-key collision(s) (manufacturer|designation|diameter|code): ${collisions.join(', ')}`,
    );
  if (catalog.length && withCurves / catalog.length < 0.8)
    problems.push(`only ${withCurves}/${catalog.length} motors have a bundled curve`);
  // The shrink floor compares against whatever is on disk at `OUT`, and which copy
  // that is differs by caller. In the weekly workflow it is the live published
  // catalog: the "Seed from the published catalogs" step clones the `data` branch
  // over this file first, precisely so the floor measures against what users are
  // actually being served. Run locally, with no seeding step, it is the committed
  // copy, which can be months behind.
  //
  // Both are legitimate baselines, and the difference matters enough that the run
  // says which one it used: a floor measured against a stale baseline is weaker
  // than it looks.
  try {
    const prev = JSON.parse(await readFile(OUT, 'utf8'));
    if (Array.isArray(prev) && prev.length) {
      console.log(`Shrink floor: comparing ${catalog.length} against the ${prev.length} currently in ${OUT}.`);
      if (catalog.length < 0.9 * prev.length)
        problems.push(`catalog shrank from ${prev.length} to ${catalog.length} motors (baseline: ${OUT})`);
    }
  } catch {
    // No previous catalog to compare against (first run, or unreadable). Said out
    // loud, because it means the shrink floor did not run at all.
    console.log(`Shrink floor: SKIPPED, no readable baseline at ${OUT}.`);
  }
  if (problems.length) throw new Error(`Refusing to write motors.generated.json: ${problems.join('; ')}`);
}

async function main() {
  // Every motor, in production or not, as desktop OpenRocket's motor database
  // carries them: its chooser hides the ones out of regular production behind a
  // checkbox rather than leaving them out, so a motor someone still has on the
  // shelf can be flown.
  console.log('Fetching motors…');
  const { results: motors = [] } = await post('search.json', { availability: 'all', maxResults: MAX_RESULTS });
  console.log(`  ${motors.length} motors`);
  if (motors.length >= MAX_RESULTS)
    throw new Error(`search.json returned ${motors.length} motors, the page cap; raise MAX_RESULTS or page the query`);

  console.log('Fetching thrust curves…');
  const sampleMap = new Map();
  const batches = chunk(
    motors.map((m) => m.motorId),
    100,
  );
  let done = 0;
  for (const ids of batches) {
    const got = await fetchSamples(ids);
    for (const [id, v] of got) sampleMap.set(id, v);
    done += ids.length;
    process.stdout.write(`\r  ${done}/${motors.length} motors, ${sampleMap.size} with curves`);
  }
  console.log('');

  const catalog = motors
    .filter((m) => m.totImpulseNs > 0 && m.burnTimeS > 0)
    .map((m) => motorRow(m, sampleMap.get(m.motorId)))
    // Ties broken down to the row key (lib/motorRowKey.mjs), which assertSane
    // holds unique, so the order never depends on the order the API returned:
    // a reordered response would otherwise change the file and its manifest hash
    // with no motor changed.
    .sort(
      (a, b) =>
        a.impulse - b.impulse ||
        a.designation.localeCompare(b.designation) ||
        cmp(a.manufacturer, b.manufacturer) ||
        a.diameter - b.diameter ||
        cmp(a.code ?? '', b.code ?? '') ||
        cmp(a.designation, b.designation),
    );

  const withCurves = catalog.filter((m) => m.curves).length;
  const noCurve = catalog.filter((m) => m.noCurve);
  await assertSane(catalog, withCurves);
  // Staged, not written to public/data: these rows have no digests yet, and
  // sync-motor-digests adds them and writes the finished catalog
  // (lib/catalogStaging.mjs).
  await writeFile(STAGED_MOTORS, JSON.stringify(catalog) + '\n');
  console.log(`\nStaged ${catalog.length} motors (${withCurves} with bundled curves) in ${STAGED_MOTORS}`);
  console.log('Run `npm run sync:motor-digests` to add their digests and write public/data/motors.generated.json.');
  if (noCurve.length) {
    console.log(`  ${noCurve.length} have NO bundled thrust curve (flagged noCurve):`);
    console.log(`    ${noCurve.map((m) => `${m.manufacturer} ${m.designation}`).join(', ')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
