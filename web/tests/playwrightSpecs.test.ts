import { describe, it, expect } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Every spec glob in `playwright.config.ts` names a spec that exists.
 *
 * `CORE_SPECS` is the list the pull request e2e gate runs, and Playwright treats
 * a `testMatch` entry that matches nothing as nothing to run, not as an error.
 * A renamed core spec would drop out of the gate with the job still green.
 *
 * Read as text, not imported: the lists are module-local constants, and the
 * question is what the file says.
 */
const web = fileURLToPath(new URL('..', import.meta.url));
const config = readFileSync(`${web}playwright.config.ts`, 'utf8');

/** The quoted entries of `const <name> = [ ... ];`. */
const list = (name: string): string[] => {
  const body = config.match(new RegExp(`const ${name}\\s*=\\s*\\[([^\\]]*)\\]`))?.[1] ?? '';
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
};

/** Every quoted spec glob anywhere in the file, `testIgnore` included. */
const allGlobs = [...new Set([...config.matchAll(/'(\*\*\/[^']+\.spec\.ts)'/g)].map((m) => m[1]!))];

const matches = (glob: string): string[] => globSync(glob, { cwd: `${web}e2e` });

describe('playwright spec globs', () => {
  const core = list('CORE_SPECS');
  const mobile = list('MOBILE_SPECS');

  it('reads both lists, so an empty parse cannot pass', () => {
    expect(core.length).toBeGreaterThanOrEqual(10);
    expect(mobile.length).toBeGreaterThanOrEqual(3);
    expect(allGlobs.length).toBeGreaterThanOrEqual(core.length);
  });

  it.each([...new Set([...core, ...mobile, ...allGlobs])])('%s matches a spec in e2e/', (glob) => {
    expect(matches(glob)).not.toEqual([]);
  });
});
