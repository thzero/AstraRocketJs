import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Every script in `web/scripts` is invoked by something.
 *
 * knip cannot answer this. `knip.json` makes every `.mjs` under
 * `scripts` an `entry`, which
 * is correct - each one is a program, not a module someone imports - and an entry
 * is by definition reachable, so an orphan script is invisible to it. Narrowing the
 * pattern is not the fix either: they really are entries, and knip has no way to
 * know that `sync-motors.mjs` is reached through a `package.json` script that a
 * GitHub workflow runs.
 *
 * So the question is asked here instead: is each script named by a `package.json`
 * script, by a workflow, or by another script? A `.mjs` nothing runs is worse than
 * ordinary dead code, because these are the programs that write the catalogs the
 * live app reads, and one that has quietly stopped being called looks exactly like
 * one that is working.
 */

const web = fileURLToPath(new URL('../..', import.meta.url));
const repo = fileURLToPath(new URL('../../..', import.meta.url));
const read = (p: string) => readFileSync(p, 'utf8');

/** Top-level programs: the `.mjs` files directly in `scripts`. `scripts/lib` holds
 *  the modules they import. */
const scripts = readdirSync(`${web}scripts`).filter((f) => f.endsWith('.mjs'));

/** Shared modules under `scripts/lib`, which are imported rather than run. */
const libs = readdirSync(`${web}scripts/lib`).filter((f) => f.endsWith('.mjs'));

/** A file that can name a script, keyed by its path from `web`. */
interface Source {
  path: string;
  text: string;
}

/**
 * Everywhere a script could be named: the package manifest, every workflow, and
 * the other scripts (one driving another is a real pattern here).
 */
const sources = (): Source[] => {
  const wf = `${repo}/.github/workflows`;
  return [
    { path: 'package.json', text: read(`${web}package.json`) },
    ...readdirSync(wf).map((f) => ({ path: `../.github/workflows/${f}`, text: read(`${wf}/${f}`) })),
    ...scripts.map((f) => ({ path: `scripts/${f}`, text: read(`${web}scripts/${f}`) })),
    ...libs.map((f) => ({ path: `scripts/lib/${f}`, text: read(`${web}scripts/lib/${f}`) })),
  ];
};

/**
 * The files under `dir` that no source but their own names. A script's header
 * often names its own path, so its own file is never a caller.
 */
const orphansIn = (dir: 'scripts' | 'scripts/lib', files: string[], from: Source[]): string[] =>
  files.filter((f) => {
    const self = `${dir}/${f}`;
    const asPath = new RegExp(`${dir === 'scripts' ? 'scripts' : 'lib'}/${f.replace('.', '\\.')}\\b`);
    return !from.some((s) => s.path !== self && asPath.test(s.text));
  });

describe('no orphan build script', () => {
  const all = sources();

  it('finds a caller for every scripts/*.mjs', () => {
    expect(orphansIn('scripts', scripts, all)).toEqual([]);
  });

  it('finds an importer for every scripts/lib module', () => {
    // These are not programs: nothing runs them, so an unimported one is plain dead
    // code. knip's entry glob covers them too, so it cannot see one either.
    expect(orphansIn('scripts/lib', libs, all)).toEqual([]);
  });

  it('does not count a script naming itself as its caller', () => {
    // `gen-icons.mjs` and `lib/dataManifest.mjs` name their own paths.
    const own = (path: string) => all.filter((s) => s.path === path);
    expect(own('scripts/gen-icons.mjs')[0]?.text).toMatch(/scripts\/gen-icons\.mjs/);
    expect(orphansIn('scripts', ['gen-icons.mjs'], own('scripts/gen-icons.mjs'))).toEqual(['gen-icons.mjs']);
    expect(own('scripts/lib/dataManifest.mjs')[0]?.text).toMatch(/lib\/dataManifest\.mjs/);
    expect(orphansIn('scripts/lib', ['dataManifest.mjs'], own('scripts/lib/dataManifest.mjs'))).toEqual([
      'dataManifest.mjs',
    ]);
  });

  it('scans a plausible number of scripts, so an empty glob cannot pass', () => {
    // At least 13 programs and 3 shared modules (`openrocketJava.mjs`, the library
    // several programs import, lives in `scripts/lib` with the other shared
    // modules).
    expect(scripts.length).toBeGreaterThanOrEqual(13);
    expect(libs.length).toBeGreaterThanOrEqual(3);
  });
});
