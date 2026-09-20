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
 *   node extract/extract.mjs --check   # verify only; fetches the pinned upstream itself
 *   node extract/extract.mjs --bless   # re-record extract/DIVERGENCE.txt and SHIMS.txt
 *   node extract/extract.mjs --src <openrocket-source>   # regenerate src/java/ (WRITES)
 *   OPENROCKET_SRC=<path> node extract/extract.mjs       # explicit source instead
 *
 * You do NOT need to clone OpenRocket by hand. With no --src and no
 * OPENROCKET_SRC, this clones the exact repo and ref named in extract/UPSTREAM
 * into engine-java/.openrocket-src (gitignored, sparse, blobless: a few
 * seconds and ~15 MB) and reuses it on every later run. Pass --src to point at
 * your own checkout, and --refresh to force the cache back to the pinned ref.
 *
 * extract/DIVERGENCE.txt is the committed, reviewed answer to "how far is each
 * patch from upstream". --check recomputes it and FAILS on any difference. That
 * is the only thing standing between the repo and an undocumented edit to the
 * kernel: the core invariant here is "src/java == upstream + patches", and the
 * patches are an INPUT to that equation, so a coordinated patches/ + src/java
 * edit satisfies it by construction. Changing a patch therefore means running
 * --bless and explaining the new number in review.
 *
 * <openrocket-source> may be a repo checkout (…/core/src/main/java/…), a plain source tree,
 * or an extracted -sources.jar — the core java root is auto-detected.
 */
import {
  readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = join(here, '..');
const extractedRoot = join(engineRoot, 'src', 'java');
const patchesRoot = join(engineRoot, 'patches');
const shimsRoot = join(engineRoot, 'src', 'shims', 'java');
const manifestPath = join(here, 'manifest.txt');

const die = (msg) => { console.error(`extract: ${msg}`); process.exit(1); };

// ---- args ----
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?/, '').replace(/^ \* ?/gm, ''));
  process.exit(0);
}
const check = args.includes('--check');
const bless = args.includes('--bless');
// --bless only re-records the baseline. It must NOT rewrite src/java: the
// extractor writes upstream's bytes verbatim, so on a CRLF checkout an
// incidental extraction rewrites all 272 files to LF. Blessing a number is a
// review action, not a regeneration.
const readOnly = check || bless;
const refresh = args.includes('--refresh');

/** repo + ref, parsed out of extract/UPSTREAM - the single source of truth. */
const readPin = () => {
  const text = readFileSync(join(here, 'UPSTREAM'), 'utf8');
  const field = (name) => {
    const m = new RegExp(`^${name}\\s*=\\s*(\\S+)`, 'm').exec(text);
    return m ? m[1] : null;
  };
  const repo = field('repo');
  const ref = field('ref');
  if (!repo || !ref) die('extract/UPSTREAM is missing a repo or ref line');
  return { repo, ref };
};

const git = (cwd, ...argv) =>
  execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/**
 * The pinned upstream, fetched on demand.
 *
 * Requiring a hand-made clone made the one gate that compares us to OpenRocket
 * the one gate nobody could run without a setup ritual - so it only ever ran in
 * CI, which is exactly backwards for a check whose whole job is to catch a
 * local edit before it lands. Sparse (core/src/main/java only) and blobless, so
 * it is seconds and megabytes, and it is keyed to the ref: if the pin moves,
 * the cache is re-pointed rather than silently reused at the old commit.
 */
const provisionUpstream = () => {
  const { repo, ref } = readPin();
  const cache = join(engineRoot, '.openrocket-src');
  const at = () => {
    try {
      return git(cache, 'rev-parse', 'HEAD');
    } catch {
      return null;
    }
  };
  if (existsSync(cache) && !refresh && at() === ref) return cache;
  try {
    if (!existsSync(join(cache, '.git'))) {
      mkdirSync(cache, { recursive: true });
      git(cache, 'init', '-q');
      git(cache, 'remote', 'add', 'origin', repo);
      git(cache, 'config', 'core.sparseCheckout', 'true');
      git(cache, 'sparse-checkout', 'set', '--no-cone', 'core/src/main/java');
    }
    console.log(`extract: fetching pinned upstream ${ref.slice(0, 9)} from ${repo}`);
    console.log('extract:   (one-time, into engine-java/.openrocket-src; --refresh to redo)');
    git(cache, 'fetch', '--depth', '1', '--filter=blob:none', 'origin', ref);
    git(cache, 'checkout', '-q', 'FETCH_HEAD');
  } catch (e) {
    die(`could not fetch the pinned upstream (${repo} @ ${ref.slice(0, 9)}).\n`
      + `  ${e.message ? e.message.split('\n')[0] : e}\n`
      + '  Needs git and network. Offline? Pass --src <your-openrocket-checkout>.');
  }
  const got = at();
  if (got !== ref) die(`upstream cache is at ${got}, expected ${ref}`);
  return cache;
};

const srcArg = (() => {
  const i = args.indexOf('--src');
  if (i >= 0 && args[i + 1]) return args[i + 1];
  if (process.env.OPENROCKET_SRC) return process.env.OPENROCKET_SRC;
  return provisionUpstream();
})();
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
  if (readOnly) {
    const have = existsSync(dest) ? readFileSync(dest, 'utf8') : null;
    if (have === null || norm(have) !== norm(want)) drift.push(rel);
  } else {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, want);
  }
  if (patchSet.has(rel)) patched++; else verbatim++;
}

// Warn about extracted files not in the manifest (stale after a manifest shrink).
// No .java filter: "src/java is exactly upstream(+patches)" should be true of
// the DIRECTORY, not just of its Java files. A stray notes.txt compiles into
// nothing and cannot reach the engine, but it also is not something an
// extraction would ever produce, and the check claims otherwise.
const stale = walk(extractedRoot)
  .map((p) => relative(extractedRoot, p).replace(/\\/g, '/'))
  .filter((p) => !manifestSet.has(p));

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
  // Any PATCH( tag, not just PATCH(astrarrocketjs. Four of the 28 markers in
  // src/java use other tags (PATCH(teavm-uuid) x2, PATCH(teavm-format-g),
  // PATCH(drogue-low-speed)), so the narrow match missed them. `drift` caught
  // them anyway - a marker-bearing file with no patch necessarily differs from
  // upstream - so this was never a hole, only a worse diagnostic: you got
  // "differs from upstream(+patch)" instead of "a regeneration would silently
  // revert this". README.md and LEDGER.md disagreed about which behavior was
  // intended; the broad one is.
  .filter((p) => /PATCH\(/.test(readFileSync(join(extractedRoot, p), 'utf8')));

// For a PATCHED file the comparison above is src/java vs the patch, so it can
// never see upstream moving underneath. Report that separately, or a patch sits
// hundreds of lines behind upstream while --check calls it clean - which is
// exactly what happened to FinSetCalc (871 lines, and a whole NACA Report 1307
// fin-body interference model that was never extracted at all).
//
// This used to be a line-MULTISET count (`a.filter(l => !bSet.has(l))`), which
// is not a diff: a change made only of deletions, or of reorderings, scored 0
// whenever the moved lines' exact text occurred elsewhere in the file. Deleting
// the `count++;` from MathUtil.average() scored 0 - the identical line also
// appears in stddev() - so the patch vanished from the report entirely while
// average() started dividing by zero. It is a real LCS diff now.
const changedLines = (a, b) => {
  // Trim the common prefix/suffix first: a patch shares almost all of its text
  // with upstream, so this leaves the DP a few dozen lines in the usual case.
  let lo = 0;
  let aHi = a.length;
  let bHi = b.length;
  while (lo < aHi && lo < bHi && a[lo] === b[lo]) lo++;
  while (aHi > lo && bHi > lo && a[aHi - 1] === b[bHi - 1]) { aHi--; bHi--; }
  const x = a.slice(lo, aHi);
  const y = b.slice(lo, bHi);
  if (!x.length || !y.length) return x.length + y.length;
  // Longest common subsequence length, rolling row (O(min) memory).
  const [s1, s2] = x.length >= y.length ? [x, y] : [y, x];
  let prev = new Int32Array(s2.length + 1);
  let cur = new Int32Array(s2.length + 1);
  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      cur[j] = s1[i - 1] === s2[j - 1]
        ? prev[j - 1] + 1
        : (prev[j] >= cur[j - 1] ? prev[j] : cur[j - 1]);
    }
    const t = prev; prev = cur; cur = t;
    cur.fill(0);
  }
  const lcs = prev[s2.length];
  return (x.length - lcs) + (y.length - lcs);
};

// EVERY patch, including delta 0. A patch identical to upstream is the
// "leftover" LEDGER.md describes: it does nothing until someone runs extract,
// at which point it silently swaps itself in. Zero is information, not noise.
const divergence = [];
for (const rel of manifest) {
  if (!patchSet.has(rel)) continue;
  const up = join(coreJavaRoot, rel);
  if (!existsSync(up)) continue;
  const ours = norm(readFileSync(join(patchesRoot, rel), 'utf8')).split('\n');
  const theirs = norm(readFileSync(up, 'utf8')).split('\n');
  divergence.push({ rel, delta: changedLines(theirs, ours) });
}
divergence.sort((x, y) => y.delta - x.delta || x.rel.localeCompare(y.rel));

// ---- the blessed baseline ----
const divergencePath = join(here, 'DIVERGENCE.txt');
const hasBaseline = existsSync(divergencePath);
const baseline = new Map();
if (hasBaseline) {
  for (const raw of readFileSync(divergencePath, 'utf8').split('\n')) {
    const entry = raw.trim();
    if (!entry || entry.startsWith('#')) continue;
    const m = /^(\S+)\s+(\d+)$/.exec(entry);
    if (!m) die(`DIVERGENCE.txt: cannot parse line: ${entry}`);
    baseline.set(m[1], Number(m[2]));
  }
}

const unblessed = [];
if (hasBaseline) {
  for (const { rel, delta } of divergence) {
    if (!baseline.has(rel)) unblessed.push({ rel, was: null, now: delta });
    else if (baseline.get(rel) !== delta) unblessed.push({ rel, was: baseline.get(rel), now: delta });
  }
  const seen = new Set(divergence.map((d) => d.rel));
  for (const rel of baseline.keys()) {
    if (!seen.has(rel)) unblessed.push({ rel, was: baseline.get(rel), now: null });
  }
}

if (bless) {
  const header = [
    '# How far each patch has diverged from upstream, in changed lines (LCS diff).',
    '#',
    '# This file is the REVIEWED baseline. `extract --check` recomputes these',
    '# numbers and fails on any difference, because the invariant it checks',
    '# ("src/java == upstream + patches") treats the patches as an input and so',
    '# can never question them. A coordinated patches/ + src/java edit passes',
    '# that invariant by construction; it does not pass this file.',
    '#',
    '# Regenerate deliberately with `npm run extract:bless -- --src <openrocket>`',
    '# and say in review WHY a number moved. A delta of 0 means the patch is',
    '# byte-identical to upstream: that is a leftover, and patches/LEDGER.md says',
    '# to delete it rather than bless it.',
    '#',
    '',
    '',
  ].join('\n');
  const body = divergence.map(({ rel, delta }) => `${rel} ${delta}`).join('\n');
  writeFileSync(divergencePath, `${header}${body}\n`);
  console.log(`extract: blessed ${divergence.length} patch divergence(s) -> extract/DIVERGENCE.txt`);
}

// ---- shims that SHADOW an upstream class -----------------------------------
//
// A shim is the only provider of a fully-qualified name that upstream also
// defines, so a semantic gap between the two is invisible at compile time and
// wrong at runtime. Nothing here used to look at src/shims at all: --check
// walks src/java against the manifest, and gates.yml never mentions shims. The
// 2026-09-18 upstream bump re-extracted six drifted manifest files and did not
// look at a single shim.
//
// That is not hypothetical. ApplicationPreferences.getAverageWindModel() had
// stopped matching upstream - it returned a dead-calm wind model where the
// desktop seeds 2 m/s at 10% turbulence - and no gate in this repo could see
// it. See patches/LEDGER.md, "Two shims stopped matching upstream".
//
// A shim cannot be diffed against the class it replaces (that is the point of a
// shim: 162 lines standing in for 2089). What CAN be checked is whether the
// upstream class has MOVED since someone last read it. This records a hash of
// each shadowed upstream file; when upstream changes, --check fails and asks a
// human to re-read that class and confirm the shim still matches. It is the
// same bargain as DIVERGENCE.txt: the tool cannot judge the semantics, but it
// can refuse to let them change unobserved.
const shimFiles = walk(shimsRoot)
  .filter((f) => f.endsWith('.java'))
  .map((f) => relative(shimsRoot, f).replace(/\\/g, '/'))
  .sort();
const shadowing = shimFiles.filter((rel) => existsSync(join(coreJavaRoot, rel)));

const shimsPath = join(here, 'SHIMS.txt');
const hasShimBaseline = existsSync(shimsPath);
const shimBaseline = new Map();
if (hasShimBaseline) {
  for (const raw of readFileSync(shimsPath, 'utf8').split('\n')) {
    const entry = raw.trim();
    if (!entry || entry.startsWith('#')) continue;
    const m = /^(\S+)\s+([0-9a-f]{64})$/.exec(entry);
    if (!m) die(`SHIMS.txt: cannot parse line: ${entry}`);
    shimBaseline.set(m[1], m[2]);
  }
}

const upstreamHash = (rel) =>
  createHash('sha256').update(norm(readFileSync(join(coreJavaRoot, rel), 'utf8'))).digest('hex');

const shimMoved = [];
if (hasShimBaseline) {
  for (const rel of shadowing) {
    const now = upstreamHash(rel);
    if (!shimBaseline.has(rel)) shimMoved.push({ rel, why: 'not in SHIMS.txt' });
    else if (shimBaseline.get(rel) !== now) shimMoved.push({ rel, why: 'upstream changed since this shim was reviewed' });
  }
  const shadowSet = new Set(shadowing);
  for (const rel of shimBaseline.keys()) {
    if (!shadowSet.has(rel)) shimMoved.push({ rel, why: 'baseline entry has no shim (or upstream dropped the class)' });
  }
}

if (bless) {
  const header = [
    '# Upstream classes that a src/shims file SHADOWS, and what that upstream',
    '# file looked like when the shim was last reviewed (sha256, CRLF-normalized).',
    '#',
    '# A shim is the only provider of its fully-qualified name, so a gap between',
    '# it and the real class is invisible to the compiler and wrong at runtime.',
    '# It cannot be diffed (162 lines standing in for 2089), so this records',
    '# instead that upstream has not moved underneath it. When a hash changes,',
    '# `extract --check` fails: go read what changed in that upstream class,',
    '# decide whether the shim still matches, then re-bless.',
    '#',
    '# Shims with no entry here define a name upstream does not (LongUUID, Geo2D,',
    '# the RASAero calculators, the Guice stand-ins), so there is nothing to track.',
    '',
    '',
  ].join('\n');
  const body = shadowing.map((rel) => `${rel} ${upstreamHash(rel)}`).join('\n');
  writeFileSync(shimsPath, `${header}${body}\n`);
  console.log(`extract: blessed ${shadowing.length} shadowed shim(s) -> extract/SHIMS.txt`);
}

console.log(`extract: ${shimFiles.length} shim(s), ${shadowing.length} shadowing an upstream class.`);
if (shimMoved.length) {
  console.error(`extract: ${shimMoved.length} shadowed shim(s) need review:`);
  shimMoved.forEach(({ rel, why }) => console.error(`  ! ${rel}  (${why})`));
  console.error('extract:   re-read the upstream class, confirm the shim still matches, then --bless.');
}
if (!hasShimBaseline) {
  console.error('extract: extract/SHIMS.txt is MISSING - shim drift is unchecked.');
  console.error('extract:   create it with --bless.');
}

if (unpatched.length) {
  console.error(`extract: ${unpatched.length} extracted file(s) carry a PATCH( marker but have NO patches/ file:`);
  unpatched.forEach((u) => console.error(`  ! ${u}`));
  console.error('extract:   a regeneration would silently revert these to upstream.');
}
if (divergence.length) {
  console.log(`extract: ${divergence.length} patch(es) vs current upstream (the override, drift, or both):`);
  divergence.forEach(({ rel, delta }) => console.log(
    `  > ${rel}  (${delta} line(s)${delta === 0 ? '  LEFTOVER: identical to upstream, delete it' : ''})`,
  ));
  console.log('extract:   a large number means upstream has moved on without us.');
}
if (unblessed.length) {
  console.error(`extract: ${unblessed.length} patch divergence(s) do NOT match extract/DIVERGENCE.txt:`);
  unblessed.forEach(({ rel, was, now }) => console.error(
    `  ! ${rel}  ${was === null ? 'not blessed' : `blessed ${was}`} -> ${now === null ? 'patch gone' : `now ${now}`}`,
  ));
  console.error('extract:   a patch changed without review. Re-run with --bless and say why.');
}
if (!hasBaseline) {
  console.error('extract: extract/DIVERGENCE.txt is MISSING - the patch baseline is unenforced.');
  console.error('extract:   create it with --bless.');
}

// Every one of these is a reason the extracted tree is not reproducible, so
// every one has to fail the check. Only `missing` used to, which is what made a
// single bogus manifest entry load-bearing: delete it and --check went green
// over 16 drifted and 13 unmanaged files.
// `unblessed` is counted for the reason DIVERGENCE.txt's own header gives: the
// other four counters all rest on "src/java == upstream + patches", which a
// coordinated edit to BOTH sides satisfies by construction. This counter is the
// only one that interrogates the patches themselves. A missing baseline counts
// too, so deleting the file is not a way to switch the check off.
const baselineMissing = hasBaseline ? 0 : 1;
const shimBaselineMissing = hasShimBaseline ? 0 : 1;
const problems = missing.length + drift.length + stale.length + unpatched.length
  + unblessed.length + baselineMissing
  + shimMoved.length + shimBaselineMissing;
if (check) {
  console.log(`extract --check: ${drift.length} extracted file(s) differ from upstream(+patch)${drift.length ? ':' : '.'}`);
  drift.forEach((d) => console.log(`  ~ ${d}`));
  console.log(
    problems
      ? `extract --check: FAILED (${missing.length} missing, ${drift.length} drifted, ${stale.length} unmanaged, ${unpatched.length} unpatched, ${unblessed.length} unblessed, ${shimMoved.length} shim(s) to review${baselineMissing ? ', no patch baseline' : ''}${shimBaselineMissing ? ', no shim baseline' : ''})`
      : 'extract --check: OK - src/java is exactly upstream(+patches).',
  );
  process.exit(problems ? 1 : 0);
}
if (!readOnly) {
  console.log(`extract: wrote ${patched + verbatim} files (${patched} patched, ${verbatim} verbatim).`);
}
process.exit(problems ? 1 : 0);
