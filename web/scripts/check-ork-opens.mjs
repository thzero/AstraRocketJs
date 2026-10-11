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
// The gates workflow does both against the pinned release.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chooseBuild, runJava } from './lib/openrocketJava.mjs';

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
process.exit(runJava({ cp, javaSrc: JAVA_SRC, className: 'OrkCheck', args: files.map((f) => resolve(f)) }));
