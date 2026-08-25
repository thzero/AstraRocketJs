#!/usr/bin/env node
/**
 * Parity test: run parity.ParityMain on the JVM and under TeaVM-JS in Node, and require
 * BIT-IDENTICAL output (modulo a small ULP tolerance for JS Math transcendentals). Any real
 * diff is a fidelity break — a TeaVM miscompile, a semantics divergence, or an unported dep.
 *
 * Self-contained: builds the parity engine variant (-Pparity) and the JVM reference itself.
 * Needs a JDK (JAVA_HOME, or whatever the Gradle wrapper already resolves) and Node 22+.
 *
 *   node test/parity/parity.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
console.error('parity: building parity engine (-Pparity) …');
gradle(['generateJavaScript', '-Pparity', '--quiet', '--console=plain']);
console.error('parity: running JVM reference (parityJvm) …');
const jvmRaw = gradle(['parityJvm', '-Pparity', '--quiet', '--console=plain']);

// --- TeaVM-JS output: import the parity module and call main(), capturing stdout ---
const jsPath = join(engineRoot, 'build', 'generated', 'teavm', 'js', 'fakerocket-engine.js');
if (!existsSync(jsPath)) {
  console.error(`parity: TeaVM output missing: ${jsPath}`);
  process.exit(1);
}
let jsCaptured = '';
const origLog = console.log;
const origWrite = process.stdout.write.bind(process.stdout);
console.log = (msg) => { jsCaptured += String(msg) + '\n'; };
process.stdout.write = (chunk) => { jsCaptured += String(chunk); return true; };
try {
  const mod = await import(pathToFileURL(jsPath).href);
  mod.main();
} finally {
  console.log = origLog;
  process.stdout.write = origWrite;
}

// --- compare (bit-identical, except a small relative tolerance for JS Math ULP noise) ---
const norm = (s) => s.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
const jvm = norm(jvmRaw);
const js = norm(jsCaptured);

const REL_TOL_DEFAULT = 1e-13;
const REL_TOL_FLIGHT = 1e-9;     // per-step ULP noise compounds over thousands of RK4 steps
const ABS_TOL_FLIGHT = 1e-12;
const REL_TOL_TURBULENT = 1e-5;  // chaotic wind feedback amplifies ULP noise exponentially
const ABS_SLACK_SERIESLENS = 2;  // adaptive stepping may reach the cutoff in ±1 step

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
