#!/usr/bin/env node
/**
 * extract.mjs — (re)generate engine-java/src/java/ from an OpenRocket source tree.
 *
 * "Extraction" copies only the physics/simulation subset of OpenRocket's core that the browser
 * engine needs (see extract/manifest.txt), then overlays the TeaVM-compat patches from
 * engine-java/patches/ (documented in patches/LEDGER.md). This is a deliberate step you run
 * only when adopting a new upstream OpenRocket version — the extracted output is committed so the
 * normal build never needs it.
 *
 * Unlike the upstream tool this replaced, it hardcodes no machine paths and can point at any
 * source layout.
 *
 *   node extract/extract.mjs --src <openrocket-source>        # regenerate src/java/
 *   node extract/extract.mjs --check --src <openrocket-source> # verify only; no writes
 *   OPENROCKET_SRC=<path> node extract/extract.mjs
 *
 * <openrocket-source> may be a repo checkout (…/core/src/main/java/…), a plain source tree,
 * or an extracted -sources.jar — the core java root is auto-detected.
 */
import {
  readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = join(here, '..');
const extractedRoot = join(engineRoot, 'src', 'java');
const patchesRoot = join(engineRoot, 'patches');
const manifestPath = join(here, 'manifest.txt');

const die = (msg) => { console.error(`extract: ${msg}`); process.exit(1); };

// ---- args ----
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?/, '').replace(/^ \* ?/gm, ''));
  process.exit(0);
}
const check = args.includes('--check');
const srcArg = (() => {
  const i = args.indexOf('--src');
  if (i >= 0 && args[i + 1]) return args[i + 1];
  return process.env.OPENROCKET_SRC || null;
})();
if (!srcArg) die('need an OpenRocket source: --src <path> or OPENROCKET_SRC=<path>');
if (!existsSync(srcArg)) die(`source path does not exist: ${srcArg}`);

// ---- locate the core java root under the source ----
const layouts = ['core/src/main/java', 'src/main/java', '.'];
const coreJavaRoot = layouts
  .map((c) => join(srcArg, c))
  .find((p) => existsSync(join(p, 'info', 'openrocket', 'core')));
if (!coreJavaRoot) die(`no info/openrocket/core under ${srcArg} (looked in: ${layouts.join(', ')})`);

// ---- load manifest + patches ----
const manifest = readFileSync(manifestPath, 'utf8')
  .split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
const manifestSet = new Set(manifest);

const walk = (dir) => (existsSync(dir) ? readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
}) : []);
const patches = walk(patchesRoot)
  .filter((p) => p.endsWith('.java'))
  .map((p) => relative(patchesRoot, p).replace(/\\/g, '/'));
const patchSet = new Set(patches);

// Guardrail: a patch whose path isn't in the manifest would silently never apply.
const orphans = patches.filter((p) => !manifestSet.has(p));
if (orphans.length) die(`patch(es) with no matching manifest entry:\n  ${orphans.join('\n  ')}`);

// ---- extract / check ----
const norm = (s) => s.replace(/\r\n/g, '\n');
const missing = [];
const drift = [];
let patched = 0;
let verbatim = 0;

for (const rel of manifest) {
  const upstream = join(coreJavaRoot, rel);
  if (!existsSync(upstream)) { missing.push(rel); continue; }
  // Desired extracted content = the patch if one exists, else verbatim upstream.
  const want = readFileSync(patchSet.has(rel) ? join(patchesRoot, rel) : upstream, 'utf8');
  const dest = join(extractedRoot, rel);
  if (check) {
    const have = existsSync(dest) ? readFileSync(dest, 'utf8') : null;
    if (have === null || norm(have) !== norm(want)) drift.push(rel);
  } else {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, want);
  }
  if (patchSet.has(rel)) patched++; else verbatim++;
}

// Warn about extracted files not in the manifest (stale after a manifest shrink).
const stale = walk(extractedRoot)
  .map((p) => relative(extractedRoot, p).replace(/\\/g, '/'))
  .filter((p) => p.endsWith('.java') && !manifestSet.has(p));

console.log(`extract: source = ${coreJavaRoot}`);
console.log(`extract: ${manifest.length} manifest files (${patches.length} patched), from OpenRocket source.`);
if (missing.length) {
  console.error(`extract: ${missing.length} manifest file(s) NOT FOUND upstream (version mismatch — update manifest/patches):`);
  missing.forEach((m) => console.error(`  - ${m}`));
}
if (stale.length) {
  console.warn(`extract: ${stale.length} extracted file(s) not in manifest (stale):`);
  stale.forEach((s) => console.warn(`  ? ${s}`));
}
if (check) {
  console.log(`extract --check: ${drift.length} extracted file(s) differ from upstream(+patch)${drift.length ? ':' : '.'}`);
  drift.forEach((d) => console.log(`  ~ ${d}`));
  process.exit(missing.length ? 1 : 0);
}
console.log(`extract: wrote ${patched + verbatim} files (${patched} patched, ${verbatim} verbatim).`);
process.exit(missing.length ? 1 : 0);
