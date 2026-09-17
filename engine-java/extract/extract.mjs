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
// A src/java file that was hand-edited but has no patches/ counterpart is
// INVISIBLE to this tool: a regeneration silently reverts it to upstream. That
// is how three TeaVM-compat fixes the build cannot run without (java.nio.file
// and Locale.Category are absent from TeaVM's classlib; the ArrayList.clone()
// rewrite is the WASM-GC ClassCastException at build.gradle:81-82) came to sit
// one `extract --src` away from being wiped.
const unpatched = walk(extractedRoot)
  .map((p) => relative(extractedRoot, p).replace(/\\/g, '/'))
  .filter((p) => p.endsWith('.java') && !patchSet.has(p))
  .filter((p) => readFileSync(join(extractedRoot, p), 'utf8').includes('PATCH(astrarrocketjs'));

// For a PATCHED file the comparison above is src/java vs the patch, so it can
// never see upstream moving underneath. Report that separately, or a patch sits
// hundreds of lines behind upstream while --check calls it clean — which is
// exactly what happened to FinSetCalc (871 lines, and a whole NACA Report 1307
// fin-body interference model that was never extracted at all).
const behind = [];
for (const rel of manifest) {
  if (!patchSet.has(rel)) continue;
  const up = join(coreJavaRoot, rel);
  if (!existsSync(up)) continue;
  const a = norm(readFileSync(join(patchesRoot, rel), 'utf8')).split('\n');
  const b = norm(readFileSync(up, 'utf8')).split('\n');
  const aSet = new Set(a), bSet = new Set(b);
  const delta = a.filter((l) => l.trim() && !bSet.has(l)).length + b.filter((l) => l.trim() && !aSet.has(l)).length;
  if (delta) behind.push({ rel, delta });
}
behind.sort((x, y) => y.delta - x.delta);

if (unpatched.length) {
  console.error(`extract: ${unpatched.length} extracted file(s) carry a PATCH( marker but have NO patches/ file:`);
  unpatched.forEach((u) => console.error(`  ! ${u}`));
  console.error('extract:   a regeneration would silently revert these to upstream.');
}
if (behind.length) {
  console.warn(`extract: ${behind.length} patch(es) differ from current upstream (the override, drift, or both):`);
  behind.forEach(({ rel, delta }) => console.warn(`  > ${rel}  (~${delta} line(s))`));
  console.warn('extract:   review each — a large number means upstream has moved on without us.');
}

// Every one of these is a reason the extracted tree is not reproducible, so
// every one has to fail the check. Only `missing` used to, which is what made a
// single bogus manifest entry load-bearing: delete it and --check went green
// over 16 drifted and 13 unmanaged files.
const problems = missing.length + drift.length + stale.length + unpatched.length;
if (check) {
  console.log(`extract --check: ${drift.length} extracted file(s) differ from upstream(+patch)${drift.length ? ':' : '.'}`);
  drift.forEach((d) => console.log(`  ~ ${d}`));
  console.log(
    problems
      ? `extract --check: FAILED (${missing.length} missing, ${drift.length} drifted, ${stale.length} unmanaged, ${unpatched.length} unpatched)`
      : 'extract --check: OK - src/java is exactly upstream(+patches).',
  );
  process.exit(problems ? 1 : 0);
}
console.log(`extract: wrote ${patched + verbatim} files (${patched} patched, ${verbatim} verbatim).`);
process.exit(problems ? 1 : 0);
