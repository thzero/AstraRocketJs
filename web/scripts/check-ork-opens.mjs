// Open a `.ork` or `.rkt` we wrote in a real OpenRocket, and report what it
// made of it. The desktop's GeneralRocketLoader reads both formats.
//
//   npm run check:ork -- <file.ork|file.rkt> [...]
//   npm run check:ork -- --jar <OpenRocket.jar> <file.ork|file.rkt>
//
// The only check that asks the thing we are trying to satisfy. Our own tests can
// prove the writer puts a part link or a motor digest into the file; they cannot
// prove the desktop accepts it. The desktop rejects a `<preset>` with no digest,
// and resolves a motor with no digest to whichever entry comes first, and both
// failures are invisible from this side of the boundary: they show up
// as a warning dialog on somebody's screen.
//
// Prints how many components came back, every component carrying a catalog
// part, every motor that resolved, and the loader's own warnings. Exits non-zero
// if there are any warnings or no components.
//
// Not part of the app build or `npm run verify`, because it needs a JDK and the
// OpenRocket release jar (`--jar`, or an installed OpenRocket). Run it after
// changing anything the `.ork` or `.rkt` writer emits. To get the files the app
// saves, run tests/services/files/orkDesktopSamples.test.ts with ORK_SAMPLES_DIR
// set:
//
//   ORK_SAMPLES_DIR=<dir> npx vitest run tests/services/files/orkDesktopSamples.test.ts
//   npm run check:ork -- <dir>/*.ork <dir>/*.rkt
//
// `npm run audit` (scripts/audit.mjs) does both against the pinned release; CI
// does not run it.
//
// KNOWN lists loader warnings that are open findings in docs/AUDIT.md, by file
// and warning text. Anything else fails, and so does a KNOWN entry that no file
// it names produced, so a fix has to remove its entry.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chooseBuild } from './lib/openrocketJava.mjs';

/** Accepted warnings: the file they come from, the text they contain, and the finding. */
const KNOWN = [
  // The bundled example's nose cones carry part digests from the OpenRocket 26
  // build that wrote it, which the 24.12 release does not have; the app keeps a
  // loaded part link as it found it, so desktop warns on the source file too.
  {
    file: 'pods-powered-with-recovery-deployment.ork',
    warning: 'found matching Estes PNC-50YR',
    reason: 'the source file names a part 24.12 does not hold',
  },
  {
    file: 'pods-powered-with-recovery-deployment.ork',
    warning: 'found matching Estes PNC-20,',
    reason: 'the source file names a part 24.12 does not hold',
  },
  {
    file: 'every-part.ork',
    warning: "data: 'auto' - Parachute",
    reason: 'C36: desktop 24.12 has no automatic line length',
  },
  {
    file: 'every-part.ork',
    warning: "data: 'auto' - Shock Cord",
    reason: 'C36: desktop 24.12 has no automatic cord length',
  },
];

const HERE = fileURLToPath(new URL('.', import.meta.url));
const JAVA_SRC = resolve(HERE, 'ork-check/OrkCheck.java');

const files = process.argv.slice(2).filter((a, i, all) => {
  if (a.startsWith('--')) return false;
  return !all[i - 1]?.startsWith('--');
});

if (!files.length) {
  console.error('usage: npm run check:ork -- <file.ork|file.rkt> [...]');
  process.exit(2);
}
for (const f of files) {
  if (!existsSync(f)) {
    console.error(`no such file: ${f}`);
    process.exit(2);
  }
}

const { cp, label } = chooseBuild();
console.log(`opening in ${label}`);
const work = mkdtempSync(join(tmpdir(), 'or-check-'));
let out;
try {
  execFileSync('javac', ['-cp', cp, '-d', work, JAVA_SRC], { stdio: 'inherit' });
  try {
    out = execFileSync('java', ['-cp', `${cp}${delimiter}${work}`, 'OrkCheck', ...files.map((f) => resolve(f))], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    // OrkCheck exits 1 on any warning; its report is still on stdout.
    if (typeof e.stdout !== 'string') throw e;
    out = e.stdout;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.stdout.write(out);

const opened = new Set(files.map((f) => basename(f)));
const seen = new Set();
const unknown = [];
let file = '';
for (const line of out.split(/\r?\n/)) {
  if (line.startsWith('== ')) file = basename(line.slice(3).trim());
  const warning = line.match(/^\s+(WARNING: .*|FAILED: .*)$/)?.[1];
  if (!warning) continue;
  const known = KNOWN.find((k) => k.file === file && warning.includes(k.warning));
  if (known) seen.add(known);
  else unknown.push(`${file}: ${warning}`);
}
const stale = KNOWN.filter((k) => opened.has(k.file) && !seen.has(k));
for (const u of unknown) console.log(`NEW ${u}`);
for (const k of stale) console.log(`NO LONGER WARNS ${k.file}: ${k.warning} (${k.reason}): remove it from KNOWN`);
console.log(`${unknown.length} new warnings, ${seen.size} known, ${stale.length} stale entries`);
process.exit(unknown.length || stale.length ? 1 : 0);
