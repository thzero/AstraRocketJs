// Every web check CI does not run, in one command:
//
//   npm run audit                          (uses an installed OpenRocket)
//   npm run audit -- --jar <OpenRocket.jar>
//
// Run it for every audit, and after changing what the .ork or .rkt writers
// emit. The last three steps need a JDK and the pinned OpenRocket release
// (scripts/data/openrocket-release.json). Stops at the first failing step and
// names it.
//
//   format      Prettier, cspell, knip and jscpd: formatting, US spelling,
//   spell       dead exports and unimported modules, and copied blocks over
//   knip        src. Housekeeping, so here rather than in CI.
//   dupes
//   coverage    The unit suite with coverage, against the floors in
//               vitest.config.ts.
//   repo        The repository convention checks under tests/repo: comment
//               wording, no em dash, CI triggers, every script and src export
//               reached, lint scope, docs footer.
//   samples     The default design, every bundled example and a design with
//               every part type, saved as .ork and .rkt the way the app saves
//               them, each beside what the app's kernel flies for its parts.
//   desktop     Those files open in desktop OpenRocket with no loader warning.
//   fields      Desktop reads every part of those files back with the values
//               the app's kernel flies (scripts/check-desktop-fields.mjs).
//   helpers     The Java helpers under scripts/ (the catalog dumpers and the
//               .ork checks) compile against the release.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chooseBuild } from './lib/openrocketJava.mjs';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const VITEST = join(WEB, 'node_modules/vitest/vitest.mjs');
/** An npm script, through the npm that launched this one: `npm.cmd` cannot be spawned without a shell. */
const npmRun = (script) => run(process.execPath, [process.env.npm_execpath ?? 'npm', 'run', script]);
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
  ['format', () => npmRun('format:check')],
  ['spell', () => npmRun('spell')],
  ['knip', () => npmRun('knip')],
  ['dupes', () => npmRun('dupes')],
  ['coverage', () => run(process.execPath, [VITEST, 'run', '--coverage'])],
  ['repo', () => run(process.execPath, [VITEST, 'run', 'tests/repo'], { REPO_CHECKS: '1' })],
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
  ['fields', () => run(process.execPath, ['scripts/check-desktop-fields.mjs', ...passthrough, samples])],
  [
    'helpers',
    () =>
      run('javac', [
        '-cp',
        chooseBuild().cp,
        '-d',
        join(work, 'classes'),
        ...filesIn(join(WEB, 'scripts'), '.java'),
        // OrkFields reads parts through the bridge's own field list.
        join(WEB, '../engine-java/src/api/java/api/ComponentFields.java'),
      ]),
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
