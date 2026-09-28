/**
 * run.mjs - the differential gate: fly one fixture on BOTH engines and compare.
 *
 *   node reference/run.mjs                      # every fixture in fixtures/
 *   node reference/run.mjs --fixture <path>     # another one
 *   node reference/run.mjs --show               # print both sides' lines
 *
 * Exits non-zero on any disagreement, so it is usable as a gate.
 *
 * WHAT THIS CATCHES THAT test/parity DOES NOT. Parity compiles ONE source tree
 * (src/java = upstream + patches/) to three targets and checks they agree, so it
 * catches a TeaVM miscompile and nothing else. A file missing from
 * extract/manifest.txt, or a patch that changed behavior rather than just
 * placating TeaVM, is invisible to it: all three targets are wrong together.
 * This compares the shipped engine against PRISTINE upstream instead.
 *
 * TOLERANCE, and why it is not zero. Upstream core is NOT reproducible run to
 * run: three consecutive reference runs of the staged fixture gave sustainer
 * apogees of 564.4375367648913, 564.4375711325278 and 564.4375719594328, a
 * spread of ~6e-8 relative, with the same seed and the same inputs. Our engine
 * does not drift that way, and the likely reason is in patches/LEDGER.md - the
 * TeaVM patches replace ConcurrentHashMap and ConcurrentLinkedQueue with plain
 * collections, which pins an iteration order that upstream leaves free. So the
 * numeric comparison is a relative tolerance an order of magnitude above
 * upstream's own spread, and the things that must match EXACTLY are the ones
 * that carry the staging semantics: branch count, branch names, and each
 * branch's full event sequence with its source component. A separation firing
 * one event too early is an exact-match failure, not a tolerance one.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { provision } from './provision.mjs';
import { gradleArgv, javaExe } from '../gradle-exec.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = join(here, '..');
const repoRoot = join(engineRoot, '..');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

/*
 * Every fixture by default, so DROPPING a fixture in the directory gates it. The
 * alternative was a list in this file, which is a second place to forget.
 */
const fixtureDir = join(here, 'fixtures');
const named = opt('--fixture', null);
const fixturePaths = named
  ? [resolve(named)]
  : readdirSync(fixtureDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => join(fixtureDir, f));
if (fixturePaths.length === 0) fail(`no fixtures in ${fixtureDir}`);
/** Relative tolerance on apogee. See the note above on upstream's own spread. */
const ALTITUDE_REL_TOL = Number(opt('--altitude-tol', '1e-5'));
/** Absolute tolerance on event times, in seconds. */
const TIME_ABS_TOL = Number(opt('--time-tol', '1e-6'));

const fail = (m) => {
  console.error(`reference: ${m}`);
  process.exit(1);
};

// ---------------------------------------------------------------- upstream side

const referenceLines = (fixturePath) => {
  provision();
  // Through the repo's own wrapper launcher: execFile cannot start a .bat, and
  // `shell: true` is deprecated precisely because it concatenates the argument
  // array into a command line - the fixture path here can contain spaces.
  let out;
  try {
    out = execFileSync(
      javaExe(),
      gradleArgv(engineRoot, [
        '-p', 'reference',
        'reference',
        '--console=plain',
        '-q',
        `-PrefArgs=${fixturePath}`,
      ]),
      { cwd: engineRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (e) {
    console.error(e.stdout || '');
    console.error(e.stderr || '');
    fail('the upstream reference run failed (see above)');
  }
  // Gradle -q still prints javac notes; results are the prefixed lines only.
  const lines = out.split(/\r?\n/).filter((l) => l.startsWith('staged.'));
  if (lines.length === 0) fail('the upstream reference produced no result lines');
  return lines;
};

// ------------------------------------------------------------- shipped-JS side

const shippedLines = async (fixturePath) => {
  // TeaVM's module installs stdout sinks on import; without these it writes the
  // engine's own chatter straight to our stdout.
  globalThis.$rt_putStdoutCustom ??= () => {};
  globalThis.$rt_putStderrCustom ??= () => {};
  const engine = await import(
    pathToFileURL(join(repoRoot, 'web', 'src', 'engine', 'vendor', 'openrocket-engine.mjs')).href
  );

  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const handle = engine.buildRocket(JSON.stringify(fixture.design));

  for (const m of fixture.motors ?? []) {
    engine.setMotorById(
      handle,
      m.mount,
      m.designation,
      m.diameter,
      m.length,
      m.times,
      m.thrusts,
      m.masses,
      m.cgX,
      m.ejectionDelay,
    );
  }
  for (const ig of fixture.ignition ?? []) {
    engine.setMotorIgnitionById(handle, ig.mount, ig.event, ig.delay);
  }

  const result = JSON.parse(engine.simulateJson(handle, JSON.stringify(fixture.options)));
  const branches = result.branches;
  if (!Array.isArray(branches)) fail('the shipped engine returned no branches');

  const lines = [`staged.branches|${branches.length}|${branches.map((b) => b.name).join('|')}`];
  branches.forEach((b, i) => {
    const events = (b.events ?? [])
      .map((e) => (e.source == null ? e.type : `${e.type}@${e.source}`))
      .join('|');
    lines.push(`staged.b${i}.events|${events}`);

    // The reference reports the branch's peak altitude; take it the same way
    // rather than trusting either side's summary field, so the two numbers are
    // the same quantity computed the same way.
    const altitude = b.series?.altitude ?? [];
    let maxAltitude = 0;
    for (const v of altitude) {
      if (typeof v === 'number' && Number.isFinite(v) && v > maxAltitude) maxAltitude = v;
    }
    const separation = (b.events ?? []).find((e) => e.type === 'STAGE_SEPARATION');
    lines.push(`staged.b${i}|${maxAltitude}|${separation ? separation.time : NaN}`);
  });
  return lines;
};

// -------------------------------------------------------------------- compare

const keyOf = (line) => line.slice(0, line.indexOf('|'));

/** A numeric result line: `staged.bN|<maxAltitude>|<separationTime>`. */
const numeric = (line) => {
  const parts = line.split('|');
  return { maxAltitude: Number(parts[1]), separation: Number(parts[2]) };
};

const close = (a, b, relTol) => {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  const scale = Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE);
  return Math.abs(a - b) / scale <= relTol;
};

const closeAbs = (a, b, absTol) => {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  return Math.abs(a - b) <= absTol;
};

const compareFixture = async (fixturePath) => {
  const label = basename(fixturePath);
  const reference = referenceLines(fixturePath);
  const shipped = await shippedLines(fixturePath);

  if (flag('--show')) {
    console.log(`--- ${label}: pristine upstream ---`);
    reference.forEach((l) => console.log(l));
    console.log(`--- ${label}: shipped engine ---`);
    shipped.forEach((l) => console.log(l));
    console.log('---');
  }

  const refByKey = new Map(reference.map((l) => [keyOf(l), l]));
  const shipByKey = new Map(shipped.map((l) => [keyOf(l), l]));
  const failures = [];

  /*
   * A bracketed machine key as an event source means the fixture left that
   * component unnamed, so it fell back to its type's default name - and the two
   * sides render THAT differently on purpose: upstream translates it ("Inner
   * Tube") while the shipped engine installs a bare DebugTranslator and emits
   * "[InnerTube.InnerTube]" for the web layer to localize (see the note on
   * getTranslator in src/shims/.../startup/Application.java - deliberate, and
   * marked do-not-fix).
   *
   * Normalizing the two would mean this comparison silently stopped checking
   * event sources, which is how a recovery device deploying off the WRONG
   * component would slip through. So it fails, and names the fix.
   */
  for (const [key, line] of shipByKey) {
    if (!key.endsWith('.events')) continue;
    const unnamed = [...new Set(line.match(/@\[[^\]]+\]/g) ?? [])].map((u) => u.slice(1));
    if (unnamed.length > 0) {
      failures.push(
        `${key}: event source(s) ${unnamed.join(', ')} are untranslated machine keys,`
          + ' which means the fixture did not name those components.'
          + ' Give each one a "name" - comparing a default component name across the two'
          + ' sides tests the translator, not the flight.',
      );
    }
  }

  for (const [key, refLine] of refByKey) {
    const shipLine = shipByKey.get(key);
    if (shipLine === undefined) {
      failures.push(`${key}: upstream produced this line and the shipped engine did not`);
      continue;
    }
    if (!/^staged\.b\d+$/.test(key)) {
      // Branch names and event sequences: exact. These carry the staging
      // semantics, and a tolerance would be meaningless on a string.
      if (refLine !== shipLine) {
        failures.push(`${key}: exact mismatch
    upstream: ${refLine}
    shipped:  ${shipLine}`);
      }
      continue;
    }
    const r = numeric(refLine);
    const sh = numeric(shipLine);
    if (!close(r.maxAltitude, sh.maxAltitude, ALTITUDE_REL_TOL)) {
      const rel = Math.abs(r.maxAltitude - sh.maxAltitude) / Math.max(Math.abs(r.maxAltitude), 1e-300);
      failures.push(
        `${key}: apogee ${r.maxAltitude} vs ${sh.maxAltitude}`
          + ` (${rel.toExponential(2)} relative, tolerance ${ALTITUDE_REL_TOL})`,
      );
    }
    if (!closeAbs(r.separation, sh.separation, TIME_ABS_TOL)) {
      failures.push(
        `${key}: separation time ${r.separation} vs ${sh.separation} (tolerance ${TIME_ABS_TOL} s)`,
      );
    }
  }

  for (const key of shipByKey.keys()) {
    if (!refByKey.has(key)) {
      failures.push(`${key}: the shipped engine produced this line and upstream did not`);
    }
  }

  return { label, lines: refByKey.size, failures };
};

let failed = 0;
for (const fixturePath of fixturePaths) {
  const { label, lines, failures } = await compareFixture(fixturePath);
  if (failures.length > 0) {
    failed += 1;
    console.error(`
reference: ${label} - ${failures.length} disagreement(s) with pristine upstream:
`);
    failures.forEach((f) => console.error(`  ${f}`));
    console.error('');
  } else {
    console.log(`reference: ${label} - agrees with pristine upstream on ${lines} line(s)`);
  }
}

if (failed > 0) {
  console.error(`reference: ${failed} of ${fixturePaths.length} fixture(s) disagree`);
  process.exit(1);
}
console.log(
  `reference: ${fixturePaths.length} fixture(s) agree`
    + ` (apogee within ${ALTITUDE_REL_TOL} relative, event sequences exact)`,
);
