#!/usr/bin/env node
/**
 * Parity test: run parity.ParityMain on the JVM and under each TeaVM target in Node, and require
 * BIT-IDENTICAL output (modulo a small ULP tolerance for JS Math transcendentals). Any real
 * diff is a fidelity break: a TeaVM miscompile, a semantics divergence, or an unported dep.
 *
 * BOTH targets are checked by default, because both are shipped: openRocketEngine.ts loads
 * WASM-GC where the browser supports it and falls back to JS. Checking one alone leaves the
 * other's fidelity unproven, and the two do NOT fail together (a miscompile is per backend).
 * They share the JVM reference, so the pair costs barely more than one: parityJvm measured 22s
 * of a 35s run, where a TeaVM build is 6s once its outputs are cached. Checking one target
 * alone is the special case, behind a flag.
 *
 * Self-contained: builds the parity engine variant (-Pparity) and the JVM reference itself.
 * Needs a JDK (JAVA_HOME, or whatever the Gradle wrapper already resolves) and Node 22+.
 *
 *   node test/parity/parity.mjs           # BOTH targets vs ONE JVM reference (default)
 *   node test/parity/parity.mjs --js      # TeaVM-JS only
 *   node test/parity/parity.mjs --wasm    # TeaVM WASM-GC only
 *   node test/parity/parity.mjs --golden  # rewrite golden.txt from this run (deliberate changes only)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Neither flag (or both) means both targets, the default that has to be right (see above).
// --js / --wasm narrow it to one, for bisecting a divergence that only one backend shows.
// Both go against the same JVM reference and the same tolerances: WASM f64 tracks the JVM's
// IEEE-754 at least as closely as JS Math does. `--both` is still accepted, as an explicit
// spelling of the default.
const wantJs = process.argv.includes('--js');
const wantWasm = process.argv.includes('--wasm');
const targets = wantJs === wantWasm ? ['js', 'wasm'] : wantJs ? ['js'] : ['wasm'];
const writeGolden = process.argv.includes('--golden');

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(here, '..', '..');
const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
// Only override JAVA_HOME if the caller set a valid one; otherwise let Gradle resolve its JVM.
const gradleEnv = { ...process.env };
if (process.env.JAVA_HOME && !existsSync(process.env.JAVA_HOME)) delete gradleEnv.JAVA_HOME;

// CI runs with NO GRADLE DAEMON, on the command line.
//
// The daemon is a long-lived `java` process that inherits this process's stdio.
// When this script exits, the daemon keeps that pipe open, the CI runner never
// sees EOF on the step's output, and the STEP HANGS — the verdicts print, then
// the job sits idle until something cancels it, reporting a PASSING check as a
// failure. Cleanup logs it: "Terminate orphan process: pid (NNNN) (java)".
//
// It has to be the command line. Gradle's precedence for `org.gradle.daemon` is
// (highest first) command line, GRADLE_USER_HOME/gradle.properties, the project
// gradle.properties, then GRADLE_OPTS. Setting it via GRADLE_OPTS in the
// workflow did NOT work: engine-java/gradle.properties says daemon=true and
// outranks it. `--no-daemon` cannot be overridden.
//
// Local runs keep the daemon, where a warm JIT across invocations is worth
// having and nothing is watching a pipe for EOF.
const NO_DAEMON = process.env.CI ? ['--no-daemon'] : [];

const gradle = (args) => execFileSync(join(engineRoot, gradlew), args, {
  cwd: engineRoot,
  env: gradleEnv,
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

// --- build the parity engine (harness as mainClass) + capture the JVM reference ---
const GRADLE_TASK = { js: 'generateJavaScript', wasm: 'buildWasmGC' };
for (const target of targets) {
  console.error(`parity: building parity engine (-Pparity${target === 'wasm' ? ', WASM-GC' : ''}) …`);
  gradle([GRADLE_TASK[target], '-Pparity', '--quiet', '--console=plain', ...NO_DAEMON]);
}
// ONCE, however many targets are compared: the reference is the JVM running the
// same harness, which does not depend on which TeaVM target it is checked against.
console.error('parity: running JVM reference (parityJvm) …');
const jvmRaw = gradle(['parityJvm', '-Pparity', '--quiet', '--console=plain', ...NO_DAEMON]);

// --- TeaVM target output: run the parity main() and capture stdout ---
const teavmDir = join(engineRoot, 'build', 'generated', 'teavm');
const jsPath = join(teavmDir, 'js', 'astrarrocketjs-engine.js');
const wasmPath = join(teavmDir, 'wasm-gc', 'astrarrocketjs-engine.wasm');
const wasmRuntimePath = join(teavmDir, 'wasm-gc', 'astrarrocketjs-engine.wasm-runtime.js');

/**
 * Run one TeaVM target's parity main() and return everything it printed.
 *
 * stdout is captured rather than piped because the target writes through
 * console.log in-process; the capture is restored in a `finally` so a throw
 * cannot leave the harness mute for the remaining target.
 */
async function runTarget(target) {
  const needed = target === 'wasm' ? [wasmPath, wasmRuntimePath] : [jsPath];
  for (const p of needed) {
    if (!existsSync(p)) {
      console.error(`parity: TeaVM output missing: ${p}`);
      process.exit(1);
    }
  }
  let captured = '';
  const origLog = console.log;
  const origWrite = process.stdout.write.bind(process.stdout);
  console.log = (msg) => { captured += String(msg) + '\n'; };
  process.stdout.write = (chunk) => { captured += String(chunk); return true; };
  try {
    if (target === 'wasm') {
      // The runtime is an IIFE that installs globalThis.TeaVM.wasmGC.{load,…}.
      (0, eval)(readFileSync(wasmRuntimePath, 'utf8'));
      const teavm = await globalThis.TeaVM.wasmGC.load(wasmPath);
      teavm.exports.main([]);
    } else {
      const mod = await import(pathToFileURL(jsPath).href);
      mod.main();
    }
  } finally {
    console.log = origLog;
    process.stdout.write = origWrite;
  }
  return captured;
}

// --- compare (bit-identical, except a small relative tolerance for JS Math ULP noise) ---
const norm = (s) => s.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
const jvm = norm(jvmRaw);

const REL_TOL_DEFAULT = 1e-13;   // static/instantaneous calcs stay bit-identical (JS Math ULP only)
// Flight (time-integrated) tolerances — full diagnosis in
// ../../../docs/flight-parity-determinism.md (summary in engine-java/README.md
// "Cross-platform flight determinism"). The adaptive RK4 step-size picks min(dt[i]); a ~1e-15
// cross-platform Math difference can flip which limit wins, drifting the timestep,
// which the (deliberately under-damped) apogee turn amplifies. On the smooth
// reference flight this reaches ~1.9e-3 relative by apogee (≈0.2 mm of 330 m, ~1 ms
// of 7 s) — physically negligible. NOT a bug: the JVM is byte-identical run-to-run,
// and every static calc matches to 1e-13. Raised from 1e-9 during the OpenRocket
// unstable migration (a new per-step damping term made the flight more ULP-sensitive).
const REL_TOL_FLIGHT = 5e-3;     // smooth-flight cross-platform drift (worst observed 1.9e-3)
const ABS_TOL_FLIGHT = 1e-4;     // near-zero flight quantities (small velocities/accels near apogee)
const REL_TOL_TURBULENT = 5e-2;  // chaotic gusty wind: platforms take different valid trajectories (worst ~3.2e-2)
const ABS_SLACK_SERIESLENS = 25; // chaotic wind flights differ in sample count (worst 517 vs 534)

function linesMatch(a, b) {
  if (a === b) return 'exact';
  if (a === undefined || b === undefined) return false;
  const fa = a.split('|');
  const fb = b.split('|');
  if (fa.length !== fb.length || fa[0] !== fb[0]) return false;
  const isFlight = fa[0].startsWith('flight.');
  const isTurbulent = fa[0].startsWith('flight.conditions');
  const isSeriesLens = fa[0] === 'flight.conditions.serieslens';
  const relTol = isTurbulent ? REL_TOL_TURBULENT : isFlight ? REL_TOL_FLIGHT : REL_TOL_DEFAULT;
  const absTol = isSeriesLens ? ABS_SLACK_SERIESLENS : isFlight ? ABS_TOL_FLIGHT : 0;
  let ulp = false;
  for (let i = 1; i < fa.length; i++) {
    if (fa[i] === fb[i]) continue;
    const na = Number(fa[i]);
    const nb = Number(fb[i]);
    if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
    const absDiff = Math.abs(na - nb);
    const denom = Math.max(Math.abs(na), Math.abs(nb));
    if (absDiff > absTol && absDiff / denom > relTol) return false;
    ulp = true;
  }
  return ulp ? 'ulp' : false;
}

// Compared one target at a time against the single JVM reference. A label is only added when
// there is more than one, so the default run says which target each verdict is for, while a
// narrowed --js / --wasm run stays unlabeled (there is nothing to disambiguate).
const label = targets.length > 1 ? (t) => ` [${t}]` : () => '';
for (const target of targets) {
  const out = norm(await runTarget(target));
  let failures = 0;
  let ulpLines = 0;
  let exactLines = 0;
  const n = Math.max(jvm.length, out.length);
  for (let i = 0; i < n; i++) {
    const m = linesMatch(jvm[i], out[i]);
    if (m === 'exact') exactLines++;
    else if (m === 'ulp') ulpLines++;
    else {
      if (failures < 10) {
        console.error(`DIFF${label(target)} line ${i + 1}:\n  jvm: ${jvm[i] ?? '<missing>'}\n  ${target.padEnd(3)}: ${out[i] ?? '<missing>'}`);
      }
      failures++;
    }
  }

  if (failures) {
    console.error(`\nPARITY FAILURE${label(target)}: ${failures} mismatched line(s) of ${n}.`);
    process.exit(1);
  }
  console.log(`parity ok${label(target)}: ${n} lines (${exactLines} bit-identical, ${ulpLines} within ULP tolerance)`);
}

// --- a flight that FAILED is not a flight that matched ---------------------
// ParityMain catches SimulationException and prints "EXCEPTION: ...". Thrown
// identically on both platforms it compared line-for-line and reported ok - so
// a change that broke every flight outright passed this harness.
const exceptions = jvm.filter((l) => l.includes('EXCEPTION:'));
if (exceptions.length) {
  console.error(`PARITY FAILURE: ${exceptions.length} scenario(s) threw instead of flying:`);
  exceptions.slice(0, 10).forEach((l) => console.error(`  ${l}`));
  process.exit(1);
}

// --- golden values: did the PHYSICS change? --------------------------------
const goldenPath = join(here, 'golden.txt');
if (writeGolden) {
  writeFileSync(goldenPath, jvm.join('\n') + '\n');
  console.log(`parity: wrote ${jvm.length} golden line(s) -> test/parity/golden.txt`);
} else if (!existsSync(goldenPath)) {
  console.warn('parity: no test/parity/golden.txt - run with --golden to create it.');
} else {
  const golden = norm(readFileSync(goldenPath, 'utf8'));
  // Same tolerances as the cross-platform comparison: a golden recorded on one
  // OS must not trip on another over ULP noise in the integrated flight.
  let moved = 0;
  const gn = Math.max(golden.length, jvm.length);
  for (let i = 0; i < gn; i++) {
    if (!linesMatch(golden[i], jvm[i])) {
      if (moved < 10) {
        console.error(`GOLDEN line ${i + 1}:`);
        console.error(`  expected: ${golden[i] ?? '<missing>'}`);
        console.error(`  actual  : ${jvm[i] ?? '<missing>'}`);
      }
      moved++;
    }
  }
  if (moved) {
    console.error(`GOLDEN FAILURE: ${moved} value(s) of ${gn} moved.`);
    console.error('The physics changed. If that was deliberate, re-run with --golden and');
    console.error('say in the commit message WHY the numbers moved.');
    process.exit(1);
  }
  console.log(`golden ok: ${golden.length} reference value(s) unchanged`);
}

// --- exit explicitly, and never block doing it ------------------------------
//
// Every FAILURE path above calls process.exit(1). Success used to fall off the
// end and rely on Node draining its event loop, which under --wasm it does not:
// the TeaVM WASM-GC runtime this script evals leaves a handle open. That is why
// the explicit exit is here.
//
// The exit ITSELF then became the hang. This was:
//
//     await new Promise((resolve) => process.stdout.write('', resolve));
//     process.exit(0);
//
// and on a GitHub runner that await did not always settle. Every verdict had
// printed, there was nothing left to do, and the step sat there until the
// runner gave up minutes later -- reporting a PASSING parity check as a failed
// job. Observed three times, stalling 3m31s, 5m47s and 7m19s, so it is not a
// fixed timeout being hit; it is a callback that never fires. It does NOT
// reproduce locally (Windows, stdout to a file OR to a pipe, both exit in 14s),
// so the mechanism is specific to the runner and is not worth chasing further.
//
// The flush is still attempted, because a truncated final line on a pipe is a
// real failure mode. It is just no longer able to hold the process: it races a
// timer, and the process leaves either way. Nothing below this comment may be
// capable of blocking indefinitely.
const FLUSH_GRACE_MS = 2000;
await Promise.race([
  new Promise((resolve) => process.stdout.write('', resolve)),
  new Promise((resolve) => setTimeout(resolve, FLUSH_GRACE_MS)),
]);
process.exit(0);
