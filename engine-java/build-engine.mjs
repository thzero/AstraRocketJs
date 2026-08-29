#!/usr/bin/env node
/**
 * build-engine.mjs — compile the engine and vendor it into the web app, in one step.
 *
 * Default target is TeaVM-JS (`gradlew generateJavaScript`), copied to
 * ../web/src/engine/vendor/openrocket-engine.mjs (the committed artifact the web app imports).
 * With --wasm it builds the TeaVM WASM-GC target and copies BOTH the `.wasm` and its JS loader
 * runtime to ../web/public/engine/ (openrocket-engine.wasm + openrocket-engine.wasm-runtime.js).
 * WASM-GC needs a modern browser (Chrome 119+/FF 120+/Safari 18+) and async init via
 * TeaVM.wasmGC.load(...); it is a second, opt-in target — the JS build is the fallback default.
 * Needs a JDK (JAVA_HOME, or whatever the Gradle wrapper resolves) and Node 22+.
 *
 *   node build-engine.mjs             # build + vendor the JS engine
 *   node build-engine.mjs --wasm      # build + vendor the WASM-GC engine (+ its runtime loader)
 *   node build-engine.mjs [--wasm] --no-copy   # build only, don't touch the web vendor copy
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const engineRoot = dirname(fileURLToPath(import.meta.url));
const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const wasm = process.argv.includes('--wasm');
const noCopy = process.argv.includes('--no-copy');
// The JS engine is committed to web/src/engine/vendor/ (so the app builds without a JDK). The
// WASM + its loader go in web/public/engine/ so Vite serves them verbatim (a .js in src/ gets
// run through import-analysis, which warns on the loader's internal dynamic imports).
const vendorDir = join(engineRoot, '..', 'web', 'src', 'engine', 'vendor');
const publicEngineDir = join(engineRoot, '..', 'web', 'public', 'engine');
const teavmOut = join(engineRoot, 'build', 'generated', 'teavm');

// Only override JAVA_HOME if the caller set a valid one; else let Gradle resolve its own JVM.
const env = { ...process.env };
if (process.env.JAVA_HOME && !existsSync(process.env.JAVA_HOME)) delete env.JAVA_HOME;

const gradleTask = wasm ? 'buildWasmGC' : 'generateJavaScript';
console.error(`build-engine: compiling with TeaVM (gradlew ${gradleTask}) …`);
execFileSync(join(engineRoot, gradlew), [gradleTask, '--console=plain'], {
  cwd: engineRoot,
  env,
  stdio: ['ignore', 'inherit', 'inherit'],
  shell: process.platform === 'win32',
});

// (built artifact → vendored copy) pairs to place.
const copies = wasm
  ? [
      [join(teavmOut, 'wasm-gc', 'astrarrocketjs-engine.wasm'), join(publicEngineDir, 'openrocket-engine.wasm')],
      [join(teavmOut, 'wasm-gc', 'astrarrocketjs-engine.wasm-runtime.js'), join(publicEngineDir, 'openrocket-engine.wasm-runtime.js')],
    ]
  : [
      [join(teavmOut, 'js', 'astrarrocketjs-engine.js'), join(vendorDir, 'openrocket-engine.mjs')],
    ];

for (const [src] of copies) {
  if (!existsSync(src)) {
    console.error(`build-engine: expected output not found: ${src}`);
    process.exit(1);
  }
}
const totalKb = (copies.reduce((n, [src]) => n + statSync(src).size, 0) / 1024).toFixed(0);

if (noCopy) {
  console.log(`build-engine: built ${wasm ? 'WASM-GC' : 'JS'} engine (${totalKb} kB). Skipped vendoring (--no-copy).`);
} else {
  for (const [src, dest] of copies) { mkdirSync(dirname(dest), { recursive: true }); copyFileSync(src, dest); }
  const destRel = wasm ? 'web/public/engine/' : 'web/src/engine/vendor/';
  const names = copies.map(([, d]) => d.split(/[\\/]/).pop()).join(' + ');
  console.log(`build-engine: built + vendored ${totalKb} kB → ${destRel}${names}`);
}
