// Open a `.ork` we wrote in a real OpenRocket, and report what it made of it.
//
//   npm run check:ork -- <file.ork> [...]
//   npm run check:ork -- --jar <OpenRocket.jar> <file.ork>
//
// The only check that asks the thing we are trying to satisfy. Our own tests can
// prove the writer puts a part link or a motor digest into the file; they cannot
// prove the desktop ACCEPTS it, and for a long time it did not. Every `<preset>`
// was rejected for having no digest and every motor resolved to whichever entry
// came first, and both failures were invisible from this side of the boundary:
// they showed up as a warning dialog on somebody's screen.
//
// Prints every component that came back carrying a catalog part, every motor
// that resolved, and the loader's own warnings. Exits non-zero if there are any.
//
// Not part of the app build or `npm run verify`, because it needs a JDK and an
// installed OpenRocket. Run it after changing anything the `.ork` writer emits.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chooseBuild, runJava } from './openrocketJava.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const JAVA_SRC = resolve(HERE, 'ork-check/OrkCheck.java');

const files = process.argv.slice(2).filter((a, i, all) => {
  if (a.startsWith('--')) return false;
  return !all[i - 1]?.startsWith('--');
});

if (!files.length) {
  console.error('usage: npm run check:ork -- <file.ork> [...]');
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
