#!/usr/bin/env node
/**
 * Parity test: run parity.ParityMain on the JVM and under TeaVM-JS in Node, and require
 * BIT-IDENTICAL output (modulo a small ULP tolerance for JS Math transcendentals). Any real
 * diff is a fidelity break — a TeaVM miscompile, a semantics divergence, or an unported dep.
 *
 * Self-contained: builds the parity engine variant (-Pparity) and the JVM reference itself.
 * Needs a JDK (JAVA_HOME, or whatever the Gradle wrapper already resolves) and Node 22+.
 *
 *   node test/parity/parity.mjs           # TeaVM-JS vs JVM (default)
 *   node test/parity/parity.mjs --wasm    # TeaVM WASM-GC vs JVM
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// --wasm compares the TeaVM WASM-GC build against the JVM (default is TeaVM-JS). Same JVM reference,
// same tolerances — WASM f64 tracks the JVM's IEEE-754 at least as closely as JS Math does.
const useWasm = process.argv.includes('--wasm');

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(here, '..', '..');
const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
// Only override JAVA_HOME if the caller set a valid one; otherwise let Gradle resolve its JVM.
const gradleEnv = { ...process.env };
if (process.env.JAVA_HOME && !existsSync(process.env.JAVA_HOME)) delete gradleEnv.JAVA_HOME;

const gradle = (args) => execFileSync(join(engineRoot, gradlew), args, {
  cwd: engineRoot,
  env: gradleEnv,
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

// --- build the parity engine (harness as mainClass) + capture the JVM reference ---
console.error(`parity: building parity engine (-Pparity${useWasm ? ', WASM-GC' : ''}) …`);
gradle([useWasm ? 'buildWasmGC' : 'generateJavaScript', '-Pparity', '--quiet', '--console=plain']);
console.error('parity: running JVM reference (parityJvm) …');
const jvmRaw = gradle(['parityJvm', '-Pparity', '--quiet', '--console=plain']);

// --- TeaVM target output: run the parity main() and capture stdout ---
const teavmDir = join(engineRoot, 'build', 'generated', 'teavm');
const jsPath = join(teavmDir, 'js', 'astrarrocketjs-engine.js');
const wasmPath = join(teavmDir, 'wasm-gc', 'astrarrocketjs-engine.wasm');
const wasmRuntimePath = join(teavmDir, 'wasm-gc', 'astrarrocketjs-engine.wasm-runtime.js');
const needed = useWasm ? [wasmPath, wasmRuntimePath] : [jsPath];
for (const p of needed) {
  if (!existsSync(p)) {
    console.error(`parity: TeaVM output missing: ${p}`);
    process.exit(1);
  }
}
let jsCaptured = '';
const origLog = console.log;
const origWrite = process.stdout.write.bind(process.stdout);
console.log = (msg) => { jsCaptured += String(msg) + '\n'; };
process.stdout.write = (chunk) => { jsCaptured += String(chunk); return true; };
try {
  if (useWasm) {
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

// --- compare (bit-identical, except a small relative tolerance for JS Math ULP noise) ---
const norm = (s) => s.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
const jvm = norm(jvmRaw);
const js = norm(jsCaptured);

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

let failures = 0;
let ulpLines = 0;
let exactLines = 0;
const n = Math.max(jvm.length, js.length);
for (let i = 0; i < n; i++) {
  const m = linesMatch(jvm[i], js[i]);
  if (m === 'exact') exactLines++;
  else if (m === 'ulp') ulpLines++;
  else {
    if (failures < 10) {
      console.error(`DIFF line ${i + 1}:\n  jvm: ${jvm[i] ?? '<missing>'}\n  js : ${js[i] ?? '<missing>'}`);
    }
    failures++;
  }
}

if (failures) {
  console.error(`\nPARITY FAILURE: ${failures} mismatched line(s) of ${n}.`);
  process.exit(1);
}
console.log(`parity ok: ${n} lines (${exactLines} bit-identical, ${ulpLines} within ULP tolerance)`);
