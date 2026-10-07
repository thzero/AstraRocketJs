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
 * know that `sync-motors.mjs` is reached by a line in a GitHub workflow.
 *
 * So the question is asked here instead: is each script named by a `package.json`
 * script, by a workflow, or by another script? A `.mjs` nothing runs is worse than
 * ordinary dead code, because these are the programs that write the catalogs the
 * live app reads, and one that has quietly stopped being called looks exactly like
 * one that is working.
 *
 * Nothing is failing today - this is a floor, not a repair.
 */

const web = fileURLToPath(new URL('..', import.meta.url));
const repo = fileURLToPath(new URL('../..', import.meta.url));
const read = (p: string) => readFileSync(p, 'utf8');

/** Top-level programs: the `.mjs` files directly in `scripts`. `scripts/lib` holds
 *  the modules they import. */
const scripts = readdirSync(`${web}scripts`).filter((f) => f.endsWith('.mjs'));

/** Shared modules under `scripts/lib`, which ARE imported rather than run. */
const libs = readdirSync(`${web}scripts/lib`).filter((f) => f.endsWith('.mjs'));

/**
 * Everywhere a script could be named: the package manifest, every workflow, and
 * the other scripts (one driving another is a real pattern here).
 */
const haystack = (): string => {
  const parts = [read(`${web}package.json`)];
  const wf = `${repo}/.github/workflows`;
  for (const f of readdirSync(wf)) parts.push(read(`${wf}/${f}`));
  for (const f of scripts) parts.push(read(`${web}scripts/${f}`));
  for (const f of libs) parts.push(read(`${web}scripts/lib/${f}`));
  return parts.join('\n');
};

describe('no orphan build script', () => {
  const text = haystack();

  it('finds a caller for every scripts/*.mjs', () => {
    const orphans = scripts.filter((f) => {
      // Its own file is in the haystack, so match the name as a PATH reference -
      // `scripts/sync-motors.mjs` - rather than the bare filename, which every
      // script trivially contains in its own header comment.
      const asPath = new RegExp(`scripts/${f.replace('.', '\\.')}\\b`);
      return !asPath.test(text);
    });
    expect(orphans).toEqual([]);
  });

  it('finds an importer for every scripts/lib module', () => {
    // These are not entries: nothing runs them, so an unimported one is plain dead
    // code that knip also cannot see, for the same reason.
    const orphans = libs.filter((f) => !new RegExp(`lib/${f.replace('.', '\\.')}\\b`).test(text));
    expect(orphans).toEqual([]);
  });

  it('scans a plausible number of scripts, so an empty glob cannot pass', () => {
    // 13 programs and 3 shared modules. It was 14 and 2: `openrocketJava.mjs` sat
    // among the programs while being a library three of them import, which is what
    // writing this test turned up, and `scripts/lib` is where the other two already
    // lived.
    expect(scripts.length).toBeGreaterThanOrEqual(13);
    expect(libs.length).toBeGreaterThanOrEqual(3);
  });
});
