// Every web check CI does not run, in one command:
//
//   npm run audit                          (uses an installed OpenRocket)
//   npm run audit -- --jar <OpenRocket.jar>
//
// Run it for every audit, and after changing what the .ork or .rkt writers
// emit. The last two steps need a JDK and the pinned OpenRocket release
// (scripts/data/openrocket-release.json). Stops at the first failing step and
// names it.
//
//   coverage    The unit suite with coverage, against the floors in
//               vitest.config.ts.
//   samples     The default design and every bundled example, saved as .ork
//               and .rkt the way the app saves them.
//   desktop     Those files open in desktop OpenRocket with no loader warning.
//   helpers     The Java helpers under scripts/ (the catalog dumpers and the
//               .ork check) compile against the release.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chooseBuild } from './lib/openrocketJava.mjs';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const VITEST = join(WEB, 'node_modules/vitest/vitest.mjs');
const work = mkdtempSync(join(tmpdir(), 'web-audit-'));
const samples = join(work, 'samples');

/** Run a command in web/ with its output shown; true when it exits 0. */
const run = (cmd, args, env = {}) =>
  spawnSync(cmd, args, { cwd: WEB, stdio: 'inherit', env: { ...process.env, ...env } }).status === 0;

/** Every file under `dir` whose name ends in `ext`. */
const filesIn = (dir, ext, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) filesIn(full, ext, out);
    else if (entry.endsWith(ext)) out.push(full);
  }
  return out;
};

const passthrough = process.argv.slice(2);

const STEPS = [
  ['coverage', () => run(process.execPath, [VITEST, 'run', '--coverage'])],
  [
    'samples',
    () =>
      run(process.execPath, [VITEST, 'run', 'tests/services/files/orkDesktopSamples.test.ts'], {
        ORK_SAMPLES_DIR: samples,
      }),
  ],
  [
    'desktop',
    () =>
      run(process.execPath, [
        'scripts/check-ork-opens.mjs',
        ...passthrough,
        ...filesIn(samples, '.ork'),
        ...filesIn(samples, '.rkt'),
      ]),
  ],
  [
    'helpers',
    () =>
      run('javac', ['-cp', chooseBuild().cp, '-d', join(work, 'classes'), ...filesIn(join(WEB, 'scripts'), '.java')]),
  ],
];

let failed = null;
for (const [name, step] of STEPS) {
  console.log(`\n=== audit: ${name} ===`);
  if (!step()) {
    failed = name;
    break;
  }
}
rmSync(work, { recursive: true, force: true });
if (failed) {
  console.error(`\naudit: ${failed} FAILED`);
  process.exit(1);
}
console.log(`\naudit: all ${STEPS.length} web checks passed.`);
