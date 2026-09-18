#!/usr/bin/env node
/**
 * build-engine.mjs - compile the engine and vendor it into the web app, in one step.
 *
 * BOTH targets are shipped, so building both is the default. `gradlew generateJavaScript` gives
 * the TeaVM-JS engine, copied to ../web/src/engine/vendor/openrocket-engine.mjs; `gradlew
 * buildWasmGC` gives the TeaVM WASM-GC engine, whose `.wasm` and JS loader runtime go to
 * ../web/public/engine/ (openrocket-engine.wasm + openrocket-engine.wasm-runtime.js).
 *
 * Both are live production artifacts, NOT one plus an experiment: openRocketEngine.ts defaults to
 * backend 'auto', which loads WASM-GC where the browser supports it (Chrome 119+/FF 120+/Safari
 * 18+) and falls back to JS otherwise. So WASM-GC is the path most browsers actually take. This is
 * why the default is both, and why it used to be a trap: rebuilding only JS refreshed the FALLBACK,
 * left the .wasm stale, and the browser then ran the old physics silently, with nothing to see.
 * Build one alone only when you know why you want to.
 * Needs a JDK (JAVA_HOME, or whatever the Gradle wrapper resolves) and Node 22+.
 *
 *   node build-engine.mjs             # build + vendor BOTH engines (default)
 *   node build-engine.mjs --js        # JS only
 *   node build-engine.mjs --wasm      # WASM-GC only (+ its runtime loader)
 *   node build-engine.mjs [--js|--wasm] --no-copy   # build only, don't touch the web vendor copy
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { gradleArgv, javaExe } from './gradle-exec.mjs';

const engineRoot = dirname(fileURLToPath(import.meta.url));
// Neither flag (or both) means both targets, which is the case that has to be right by default:
// the two artifacts are a matched pair and a half-rebuilt pair is silently wrong at runtime.
// `--both` is still accepted, as an explicit spelling of the default.
const wantJs = process.argv.includes('--js');
const wantWasm = process.argv.includes('--wasm');
const targets = wantJs === wantWasm ? ['js', 'wasm'] : wantJs ? ['js'] : ['wasm'];
const noCopy = process.argv.includes('--no-copy');
const vendorDir = join(engineRoot, '..', 'web', 'src', 'engine', 'vendor');
// WASM + its loader go in web/public/ so Vite serves them verbatim (a .js in src/ gets
// run through import-analysis, which warns on the loader's internal dynamic imports).
const publicEngineDir = join(engineRoot, '..', 'web', 'public', 'engine');

// Only override JAVA_HOME if the caller set a valid one; else let Gradle resolve its own JVM.
const env = { ...process.env };
if (process.env.JAVA_HOME && !existsSync(process.env.JAVA_HOME)) delete env.JAVA_HOME;

// Per target: the Gradle task that produces it, and the (source artifact -> committed vendor
// copy) pairs to place once it has.
const teavmOut = join(engineRoot, 'build', 'generated', 'teavm');
const TARGETS = {
  js: {
    label: 'JS',
    gradleTask: 'generateJavaScript',
    destRel: 'web/src/engine/vendor/',
    copies: [[join(teavmOut, 'js', 'astrarrocketjs-engine.js'), join(vendorDir, 'openrocket-engine.mjs')]],
  },
  wasm: {
    label: 'WASM-GC',
    gradleTask: 'buildWasmGC',
    destRel: 'web/public/engine/',
    copies: [
      [join(teavmOut, 'wasm-gc', 'astrarrocketjs-engine.wasm'), join(publicEngineDir, 'openrocket-engine.wasm')],
      [join(teavmOut, 'wasm-gc', 'astrarrocketjs-engine.wasm-runtime.js'), join(publicEngineDir, 'openrocket-engine.wasm-runtime.js')],
    ],
  },
};

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

// Compile every requested target BEFORE vendoring any of them. Copying as each one finished
// would let a failing second compile leave web/ carrying a new JS engine beside a stale .wasm,
// which is exactly the mismatch the both-by-default behavior exists to prevent.
for (const target of targets) {
  const { gradleTask } = TARGETS[target];
  console.error(`build-engine: compiling with TeaVM (gradlew ${gradleTask}) …`);
  execFileSync(javaExe(env), gradleArgv(engineRoot, [gradleTask, '--console=plain', ...NO_DAEMON], env), {
    cwd: engineRoot,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

for (const target of targets) {
  for (const [src] of TARGETS[target].copies) {
    if (!existsSync(src)) {
      console.error(`build-engine: expected output not found: ${src}`);
      process.exit(1);
    }
  }
}

for (const target of targets) {
  const { label, destRel, copies } = TARGETS[target];
  const totalKb = (copies.reduce((n, [src]) => n + statSync(src).size, 0) / 1024).toFixed(0);

  if (noCopy) {
    console.log(`build-engine: built ${label} engine (${totalKb} kB). Skipped vendoring (--no-copy).`);
  } else {
    for (const [src, dest] of copies) { mkdirSync(dirname(dest), { recursive: true }); copyFileSync(src, dest); }
    const names = copies.map(([, d]) => d.split(/[\\/]/).pop()).join(' + ');
    console.log(`build-engine: built + vendored ${totalKb} kB → ${destRel}${names}`);
  }
}
