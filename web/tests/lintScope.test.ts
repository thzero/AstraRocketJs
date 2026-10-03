import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';

/**
 * What the linter is pointed at, asked of the linter itself.
 *
 * `eslint .` walked 70 GENERATED files - `public` and the 2.9 MB vendored TeaVM
 * bundle under `src/engine/vendor` - to apply zero rules to them, because every
 * config block is `files`-scoped to our own sources. Both are already excluded by
 * `.prettierignore` and by knip.
 *
 * Zero rules today was the hazard rather than the cost. A config block added with
 * NO `files` key is the normal way to add a project-wide rule, and the moment one
 * appears it fires on every generated file under `--max-warnings 0`.
 *
 * Driven through `ESLint.isPathIgnored` and `calculateConfigForFile`, not by
 * reading the config file as text: the question is what the resolver concludes,
 * and a `files`/`ignores` interaction is exactly the thing a regex over the source
 * gets wrong.
 */
const cwd = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({ cwd });

describe('the generated trees are outside the linter', () => {
  it.each(['src/engine/vendor/openrocket-engine.mjs', 'public/sw.js'])('ignores %s', async (rel) => {
    expect(await eslint.isPathIgnored(rel)).toBe(true);
  });

  it('still lints our own sources', async () => {
    for (const rel of ['src/main.tsx', 'src/services/storage/storageKeys.ts', 'scripts/sync-motors.mjs']) {
      expect(await eslint.isPathIgnored(rel), rel).toBe(false);
    }
  });

  it('still lints the tests and the e2e specs', async () => {
    for (const rel of ['tests/lintScope.test.ts', 'e2e/base.ts']) {
      expect(await eslint.isPathIgnored(rel), rel).toBe(false);
    }
  });
});

describe('the rules that are enabled are enabled on real files', () => {
  it('resolves the type-aware promise rules for a component', async () => {
    // T6: these never ran. `recommended` does not include them and no
    // `projectService` was configured, so `no-floating-promises` was off
    // everywhere - a click handler that drops a rejected promise was invisible.
    const cfg = await eslint.calculateConfigForFile('src/components/layout/AppHeader.tsx');
    expect(cfg.rules?.['@typescript-eslint/no-floating-promises']).toBeTruthy();
    expect(cfg.rules?.['@typescript-eslint/no-misused-promises']).toBeTruthy();
  });

  it('resolves the hook rules the project has always enforced', async () => {
    const cfg = await eslint.calculateConfigForFile('src/components/layout/AppHeader.tsx');
    expect(cfg.rules?.['react-hooks/rules-of-hooks']).toBeTruthy();
  });

  it('leaves the type-aware rules OFF for the plain .mjs scripts', async () => {
    // They have no TypeScript program, so a type-aware rule there is an error
    // about the tool rather than about the code.
    const cfg = await eslint.calculateConfigForFile('scripts/sync-motors.mjs');
    expect(cfg.rules?.['@typescript-eslint/no-floating-promises']).toBeFalsy();
  });
});
