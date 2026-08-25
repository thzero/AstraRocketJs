#!/usr/bin/env node
/**
 * build-engine.mjs — compile the engine to JS and vendor it into the web app, in one step.
 *
 * Runs `gradlew generateJavaScript` (TeaVM) and copies the output to
 * ../web/src/engine/vendor/openrocket-engine.mjs (the committed artifact the web app imports).
 * Needs a JDK (JAVA_HOME, or whatever the Gradle wrapper resolves) and Node 22+.
 *
 *   node build-engine.mjs            # build + vendor
 *   node build-engine.mjs --no-copy  # build only, don't touch the web vendor copy
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const engineRoot = dirname(fileURLToPath(import.meta.url));
const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const artifact = join(engineRoot, 'build', 'generated', 'teavm', 'js', 'fakerocket-engine.js');
const vendor = join(engineRoot, '..', 'web', 'src', 'engine', 'vendor', 'openrocket-engine.mjs');

// Only override JAVA_HOME if the caller set a valid one; else let Gradle resolve its own JVM.
const env = { ...process.env };
if (process.env.JAVA_HOME && !existsSync(process.env.JAVA_HOME)) delete env.JAVA_HOME;

console.error('build-engine: compiling with TeaVM (gradlew generateJavaScript) …');
execFileSync(join(engineRoot, gradlew), ['generateJavaScript', '--console=plain'], {
  cwd: engineRoot,
  env,
  stdio: ['ignore', 'inherit', 'inherit'],
  shell: process.platform === 'win32',
});

if (!existsSync(artifact)) {
  console.error(`build-engine: expected output not found: ${artifact}`);
  process.exit(1);
}
const kb = (statSync(artifact).size / 1024).toFixed(0);

if (process.argv.includes('--no-copy')) {
  console.log(`build-engine: built ${artifact} (${kb} kB). Skipped vendoring (--no-copy).`);
} else {
  copyFileSync(artifact, vendor);
  console.log(`build-engine: built + vendored ${kb} kB → web/src/engine/vendor/openrocket-engine.mjs`);
}
