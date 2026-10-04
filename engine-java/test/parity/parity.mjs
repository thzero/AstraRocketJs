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
 * Self-contained: builds and vendors the engine (build-engine.mjs, the same step as `npm run
 * build`), then runs the VENDORED .mjs and .wasm - the exact files the app loads - through their
 * runParity() export, against the JVM running the same scenarios. Needs a JDK (JAVA_HOME, or
 * whatever the Gradle wrapper already resolves) and Node 22+.
 *
 *   node test/parity/parity.mjs           # BOTH targets vs ONE JVM reference (default)
 *   node test/parity/parity.mjs --js      # TeaVM-JS only
 *   node test/parity/parity.mjs --wasm    # TeaVM WASM-GC only
 *   node test/parity/parity.mjs --golden  # rewrite golden.txt from this run (deliberate changes only)
 *   node test/parity/parity.mjs --expect-lines 356  # also require exactly this many golden values
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGET_COMPLETE, writeStdoutSync } from './stdout-sync.mjs';
import { gradleArgv, javaExe } from '../../gradle-exec.mjs';

// Every VERDICT this script prints goes through a synchronous write, never
// console.log, so that nothing is still buffered when the process.exit() at the
// bottom of this file runs. stdout-sync.mjs explains why that matters and why
// it cannot hang. Diagnostics keep using console.error: that is stderr, a
// different fd, so the two cannot interleave.
const say = (line) => writeStdoutSync(line + '\n');

// Neither flag (or both) means both targets, the default that has to be right (see above).
// --js / --wasm narrow it to one, for bisecting a divergence that only one backend shows.
// Both go against the same JVM reference and the same tolerances: WASM f64 tracks the JVM's
// IEEE-754 at least as closely as JS Math does. `--both` is still accepted, as an explicit
// spelling of the default.
const wantJs = process.argv.includes('--js');
const wantWasm = process.argv.includes('--wasm');
const targets = wantJs === wantWasm ? ['js', 'wasm'] : wantJs ? ['js'] : ['wasm'];
const writeGolden = process.argv.includes('--golden');
// The golden can be SHRUNK as well as moved: drop emissions from ParityMain,
// re-record, and every remaining value still matches, so the gate reports "ok"
// while the dropped physics goes unchecked. CI passes the expected count, so a
// shrink (or a growth) has to be argued in the workflow diff, the way
// validation's --expect-gates pins its anchor set.
const expectLinesAt = process.argv.indexOf('--expect-lines');
const expectLines = expectLinesAt === -1 ? null : Number(process.argv[expectLinesAt + 1]);
if (expectLines !== null && !(Number.isInteger(expectLines) && expectLines > 0)) {
  console.error(`parity: --expect-lines needs a positive whole number, got ${process.argv[expectLinesAt + 1]}`);
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(here, '..', '..');
// Only override JAVA_HOME if the caller set a valid one; otherwise let Gradle resolve its JVM.
const gradleEnv = { ...process.env };
if (process.env.JAVA_HOME && !existsSync(process.env.JAVA_HOME)) delete gradleEnv.JAVA_HOME;

// CI runs with NO GRADLE DAEMON, on the command line.
//
// The daemon is a long-lived `java` process that inherits this process's stdio.
// When this script exits, the daemon keeps that pipe open, the CI runner never
// sees EOF on the step's output, and the STEP HANGS, which cleanup reports as
// "Terminate orphan process: pid (NNNN) (java)".
//
// This is a separate matter from the WASM-GC exit problem; see the exit note at
// the bottom of this file for that one.
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

const gradle = (args) =>
  execFileSync(javaExe(gradleEnv), gradleArgv(engineRoot, args, gradleEnv), {
    cwd: engineRoot,
    env: gradleEnv,
    encoding: 'utf8',
  });

// --- build + vendor the SHIPPED engine, then capture the JVM reference ---
//
// The binary parity checks is the binary users get: build-engine.mjs builds
// both targets with the production configuration and copies them into web/,
// and the targets below are run from THOSE copies. A separate harness build
// had its own entry point and a larger reachable set, and TeaVM links by
// reachability, so it validated a sibling of what shipped.
console.error(`parity: building and vendoring the engine (${targets.join(' + ')}) …`);
execFileSync(process.execPath, [join(engineRoot, 'build-engine.mjs'), ...targets.map((t) => `--${t}`)], {
  cwd: engineRoot,
  env: gradleEnv,
  stdio: ['ignore', process.stderr, 'inherit'],
});
// ONCE, however many targets are compared: the reference is the JVM running the
// same scenarios, which does not depend on which TeaVM target it is checked against.
console.error('parity: running JVM reference (parityJvm) …');
const jvmRaw = gradle(['parityJvm', '--quiet', '--console=plain', ...NO_DAEMON]);

// --- the vendored engine: run its runParity() and capture stdout ---
const webRoot = resolve(engineRoot, '..', 'web');
const jsPath = join(webRoot, 'src', 'engine', 'vendor', 'openrocket-engine.mjs');
const wasmPath = join(webRoot, 'public', 'engine', 'openrocket-engine.wasm');
const wasmRuntimePath = join(webRoot, 'public', 'engine', 'openrocket-engine.wasm-runtime.js');
const runnerPath = join(here, 'run-target.mjs');

// Purely a backstop. A target run is 1-4 seconds and run-target.mjs SIGKILLs
// itself the moment it has printed, so this only matters if a future target
// wedges BEFORE printing - in which case the run should fail in a couple of
// minutes with a clear message rather than sit until the workflow's step cap.
const TARGET_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Run one TeaVM target's parity main() in a CHILD PROCESS and return everything
 * it printed.
 *
 * A child, not this process, and that is what keeps this script able to exit: on
 * Linux a process that has instantiated the WASM-GC module can never exit again, by
 * any means, and its event loop stops turning with it. run-target.mjs carries the
 * target instead, prints, and dies by signal; nothing here ever touches a TeaVM
 * target. The measurements are at the bottom of run-target.mjs.
 *
 * Because the child leaves by SIGKILL it has no exit status to report with, so
 * SUCCESS IS THE SENTINEL, not the status. Anything else is a failed target and
 * says which way it failed. A crash still reports the ordinary way: node prints
 * the stack to stderr (forwarded below), no sentinel arrives, this fails.
 *
 * It also needs no console.log monkey-patching to capture in-process output: a
 * child's stdout is captured by the pipe.
 */
function runTarget(target) {
  const needed = target === 'wasm' ? [wasmPath, wasmRuntimePath] : [jsPath];
  for (const p of needed) {
    if (!existsSync(p)) {
      console.error(`parity: TeaVM output missing: ${p}`);
      process.exit(1);
    }
  }

  const r = spawnSync(process.execPath, [runnerPath, target], {
    cwd: engineRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: TARGET_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });

  // The child's stderr is diagnostics - the engine's own log lines, and a stack
  // trace if it threw. Pass it through rather than swallowing it.
  if (r.stderr) process.stderr.write(r.stderr);

  const lines = (r.stdout ?? '').split(/\r?\n/);
  const end = lines.lastIndexOf(TARGET_COMPLETE);
  if (end !== -1) return lines.slice(0, end).join('\n');

  // No sentinel: the child never reached the end of its own script.
  if (r.error && r.error.code === 'ETIMEDOUT') {
    console.error(`parity: the ${target} target produced no result within ${TARGET_TIMEOUT_MS / 1000}s.`);
  } else if (r.error) {
    console.error(`parity: could not run the ${target} target: ${r.error.message}`);
  } else if (r.signal) {
    console.error(`parity: the ${target} target died on ${r.signal} before finishing.`);
  } else {
    console.error(`parity: the ${target} target exited ${r.status} without finishing.`);
  }
  process.exit(1);
}

// --- compare (bit-identical, except a small relative tolerance for JS Math ULP noise) ---
const norm = (s) => s.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
const jvm = norm(jvmRaw);

// An empty reference must not compare equal to an empty target: Math.max(0, 0) is
// 0, the loop below never runs, and the script reports `parity ok: 0 lines`. Only
// golden.txt would catch that, making the physics gate load-bearing for a fidelity
// failure it is not meant to cover.
if (!jvm.length) {
  console.error('PARITY FAILURE: the JVM reference produced no output at all.');
  console.error('  Nothing was compared. This is a harness or build failure, not a pass.');
  process.exit(1);
}

const REL_TOL_DEFAULT = 1e-13;   // static/instantaneous calcs stay bit-identical (JS Math ULP only)
// Flight (time-integrated) tolerances. The adaptive RK4 step-size picks min(dt[i]); a ~1e-15
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

// The golden comparison does NOT need the cross-platform headroom.
//
// Those tolerances exist so a golden recorded on one OS does not trip on
// another over ULP noise in the integrated flight, and the worst drift ever
// observed is 1.9e-3. But golden is a same-machine comparison of the JVM run
// against a committed file, and reusing 5e-3 for it left a measured blind band:
// apogee could move 1.65 m, flight time 0.51 s and every event time 0.5%, all
// silently. Measured, not estimated - perturbing a golden copy by +0.49%
// passed and +0.6% failed.
//
// 3e-3 is still above the worst observed cross-platform drift, so a golden
// recorded elsewhere is not going to start failing; it just halves the band a
// real regression can hide in. Same reasoning for the turbulent lines.
const GOLDEN_TOL_SCALE = 0.6; // 5e-3 -> 3e-3, 5e-2 -> 3e-2

function linesMatch(a, b, forGolden = false) {
  if (a === b) return 'exact';
  if (a === undefined || b === undefined) return false;
  const fa = a.split('|');
  const fb = b.split('|');
  if (fa.length !== fb.length || fa[0] !== fb[0]) return false;
  const isFlight = fa[0].startsWith('flight.');
  // Against the golden, a line that is not time-integrated has no drift to
  // excuse: the JVM reproduces every one of them bit for bit (measured, all 356
  // golden values, flights included, on the recording machine). Only the
  // integrated flight lines keep a band, for a golden recorded on another
  // platform, and the run reports how many needed it.
  if (forGolden && !isFlight) return false;
  const isTurbulent = fa[0].startsWith('flight.conditions');
  const isSeriesLens = fa[0] === 'flight.conditions.serieslens';
  const scale = forGolden ? GOLDEN_TOL_SCALE : 1;
  const relTol = (isTurbulent ? REL_TOL_TURBULENT : isFlight ? REL_TOL_FLIGHT : REL_TOL_DEFAULT) * scale;
  // The absolute escape is NOT scaled away for series lengths (a chaotic wind
  // flight genuinely differs in sample count) but IS for ordinary flight
  // fields, where 1e-4 absolute on a descent acceleration of ~5.9e-4 was a 17%
  // free change and `flight.sample.0` - all zeros - was unconstrained entirely.
  const absTol = isSeriesLens ? ABS_SLACK_SERIESLENS : isFlight ? ABS_TOL_FLIGHT * scale : 0;
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
  const out = norm(runTarget(target));
  let failures = 0;
  let ulpLines = 0;
  let exactLines = 0;
  const n = Math.max(jvm.length, out.length);
  if (n === 0) {
    console.error(`PARITY FAILURE${label(target)}: no output from either side.`);
    process.exit(1);
  }
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
  say(`parity ok${label(target)}: ${n} lines (${exactLines} bit-identical, ${ulpLines} within ULP tolerance)`);
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
//
// This is the ONLY check here that looks at the source rather than the compile.
// Parity proves TeaVM translated our Java faithfully; three targets agreeing on
// a wrong coefficient is still three targets agreeing. So this file is what
// stands between a changed number and a green build, and it is protected
// accordingly:
//
//   - a MISSING golden.txt fails, rather than warning and exiting 0, which would
//     let `git rm`ing it switch the physics gate off with CI still green;
//   - the header carries a sha256 of the data lines, re-verified on every run,
//     so hand-editing one value to make a regression pass fails instead;
//   - --golden compares BEFORE it overwrites and prints what it is about to
//     change, so the regeneration transcript names the movement.
const goldenPath = join(here, 'golden.txt');
const GOLDEN_MAGIC = '# golden v1';

const goldenDigest = (lines) => createHash('sha256').update(lines.join('\n') + '\n').digest('hex');

const readGolden = () => {
  const all = readFileSync(goldenPath, 'utf8').split(/\r?\n/).map((l) => l.trimEnd());
  return {
    header: all.find((l) => l.startsWith(GOLDEN_MAGIC)) ?? null,
    data: all.filter((l) => l && !l.startsWith('#')),
  };
};

// Returns the number of moved values, printing the first 10.
const compareGolden = (golden, what) => {
  let moved = 0;
  let banded = 0;
  const gn = Math.max(golden.length, jvm.length);
  for (let i = 0; i < gn; i++) {
    const m = linesMatch(golden[i], jvm[i], true);
    if (m === 'ulp') banded++;
    if (!m) {
      if (moved < 10) {
        console.error(`${what} line ${i + 1}:`);
        console.error(`  expected: ${golden[i] ?? '<missing>'}`);
        console.error(`  actual  : ${jvm[i] ?? '<missing>'}`);
      }
      moved++;
    }
  }
  return { moved, gn, banded };
};

// Where the golden was recorded, so a flight line that stops matching exactly can
// be traced to a platform change rather than read as a regression.
const platform = () => {
  // `java -version` writes to stderr.
  const r = spawnSync(javaExe(gradleEnv), ['-version'], { encoding: 'utf8' });
  const java = `${r.stderr ?? ''}${r.stdout ?? ''}`.split(/\r?\n/)[0] || 'unknown';
  return `${process.platform}-${process.arch} ${java.trim().replace(/\s+/g, '_')}`;
};

if (writeGolden) {
  // Say what is being overwritten before overwriting it.
  if (existsSync(goldenPath)) {
    const { data } = readGolden();
    const { moved, gn } = compareGolden(data, 'GOLDEN MOVED');
    say(moved
      ? `parity: --golden is overwriting ${moved} moved value(s) of ${gn}. Say WHY in the commit message.`
      : 'parity: --golden rewrote an unchanged golden (no values moved).');
  }
  let commit = 'unknown';
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: engineRoot, encoding: 'utf8' }).trim();
  } catch { /* not a checkout, or no git: provenance degrades, the sha256 does not */ }
  const header = [
    `${GOLDEN_MAGIC} sha256=${goldenDigest(jvm)} lines=${jvm.length} generated=${new Date().toISOString()} commit=${commit}`,
    `# recorded on: ${platform()}`,
    '# The JVM reference output, recorded deliberately with `npm run parity:golden`.',
    '# parity.mjs re-verifies the sha256 above on every run, so a hand-edited value',
    '# here fails the gate instead of quietly becoming the new truth.',
    '',
  ].join('\n');
  writeFileSync(goldenPath, `${header}${jvm.join('\n')}\n`);
  say(`parity: wrote ${jvm.length} golden line(s) -> test/parity/golden.txt`);
} else if (!existsSync(goldenPath)) {
  console.error('PARITY FAILURE: test/parity/golden.txt is missing.');
  console.error('  The physics gate cannot run. If this is a first-time setup, create it');
  console.error('  with `npm run parity:golden`; otherwise restore it, because deleting it');
  console.error('  is indistinguishable from switching the gate off.');
  process.exit(1);
} else {
  const { header, data } = readGolden();
  if (!header) {
    console.error('PARITY FAILURE: golden.txt has no provenance header.');
    console.error('  Re-record it with `npm run parity:golden`.');
    process.exit(1);
  }
  const claimed = /sha256=([0-9a-f]{64})/.exec(header);
  if (!claimed) {
    console.error(`PARITY FAILURE: golden.txt header carries no sha256:\n  ${header}`);
    process.exit(1);
  }
  const actual = goldenDigest(data);
  if (actual !== claimed[1]) {
    console.error('PARITY FAILURE: golden.txt does not match its own sha256.');
    console.error(`  header: ${claimed[1]}`);
    console.error(`  actual: ${actual}`);
    console.error('  The file was edited by hand. Re-record it with `npm run parity:golden`');
    console.error('  so the change is a deliberate, reviewable regeneration.');
    process.exit(1);
  }
  if (expectLines !== null && data.length !== expectLines) {
    console.error(`GOLDEN FAILURE: expected ${expectLines} reference value(s), golden.txt holds ${data.length}.`);
    console.error('  The set of checked values changed shape. If that was deliberate, update');
    console.error('  --expect-lines in .github/workflows/gates.yml and say why in review.');
    process.exit(1);
  }
  const { moved, gn, banded } = compareGolden(data, 'GOLDEN');
  if (moved) {
    console.error(`GOLDEN FAILURE: ${moved} value(s) of ${gn} moved.`);
    console.error('The physics changed. If that was deliberate, re-run with --golden and');
    console.error('say in the commit message WHY the numbers moved.');
    process.exit(1);
  }
  say(`golden ok: ${data.length} reference value(s) unchanged (${data.length - banded} bit-identical, ${banded} flight line(s) within tolerance)`);
  if (banded) {
    const rec = readFileSync(goldenPath, 'utf8').match(/^# recorded on: (.*)$/m);
    say(`  the golden was recorded on ${rec ? rec[1] : 'an unrecorded platform'}; this run is ${platform()}`);
  }
}

// --- exit: nothing from here up may need the event loop ---------------------
//
// Measured on Ubuntu 26.04 / node 22.23.2:
//
//   ONCE A PROCESS HAS INSTANTIATED THE WASM-GC MODULE IT CANNOT EXIT, and its
//   event loop stops turning. Falling off the end hangs, process.exit() hangs,
//   waiting first hangs, and timers armed beforehand never fire, so a timeout
//   fallback cannot help either. Only a signal ends it. Loading the module is
//   enough; main() need not run. The JS target is fine. It does not reproduce on
//   Windows, so it shows up only in CI.
//
// The rule is therefore not "flush carefully" or "exit explicitly": it is that
// THIS script must never load a TeaVM target. run-target.mjs does it in a process
// built to be killed, and this one stays ordinary - every verdict goes out through
// a synchronous write (see `say` at the top) so nothing is buffered here, and the
// exit below is a bare statement.
process.exit(0);
