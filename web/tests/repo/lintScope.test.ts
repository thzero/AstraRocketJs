import { describe, it, expect, beforeAll } from 'vitest';
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';

/**
 * What the linter is pointed at, asked of the linter itself.
 *
 * Generated files (`public` and the vendored TeaVM bundle under
 * `src/engine/vendor`) must be ignored, not merely matched by no rule. Both are
 * already excluded by `.prettierignore` and by knip.
 *
 * Every config block is `files`-scoped to our own sources, so those files get zero
 * rules, but a config block added with no `files` key is the normal way to add a
 * project-wide rule, and the moment one appears it fires on every generated file
 * under `--max-warnings 0`.
 *
 * Driven through `ESLint.isPathIgnored` and `calculateConfigForFile`, not by
 * reading the config file as text: the question is what the resolver concludes,
 * and a `files`/`ignores` interaction is exactly the thing a regex over the source
 * gets wrong.
 */
const cwd = fileURLToPath(new URL('../..', import.meta.url));
const eslint = new ESLint({ cwd });

// The first query loads the whole config (typescript-eslint and every plugin):
// about half a second alone, and many times that while the full suite saturates
// the CPU. Loaded here, on its own budget, so it is not charged to whichever test
// happens to run first.
beforeAll(async () => {
  await eslint.calculateConfigForFile('src/main.tsx');
}, 30_000);

describe('the generated trees are outside the linter', () => {
  it.each(['src/engine/vendor/openrocket-engine.mjs', 'dist/sw.js'])('ignores %s', async (rel) => {
    expect(await eslint.isPathIgnored(rel)).toBe(true);
  });

  it('still lints our own sources', async () => {
    for (const rel of ['src/main.tsx', 'src/services/storage/storageKeys.ts', 'scripts/sync-motors.mjs']) {
      expect(await eslint.isPathIgnored(rel), rel).toBe(false);
    }
  });

  it('still lints the tests and the e2e specs', async () => {
    for (const rel of ['tests/repo/lintScope.test.ts', 'e2e/base.ts']) {
      expect(await eslint.isPathIgnored(rel), rel).toBe(false);
    }
  });
});

/**
 * A rule's resolved severity: 0 off, 1 warn, 2 error. A resolved rule is an
 * array whose first entry is the severity, so a rule turned off still comes back
 * as a truthy `[0, ...]`, and only the severity says whether it runs.
 */
const severity = (rules: Record<string, unknown> | undefined, rule: string): number => {
  const v = rules?.[rule];
  const level = Array.isArray(v) ? (v[0] as unknown) : v;
  return level === 'error' ? 2 : level === 'warn' ? 1 : typeof level === 'number' ? level : 0;
};

describe('the rules that are enabled are enabled on real files', () => {
  it('resolves the type-aware promise rules for a component', async () => {
    // `recommended` does not include these, and they need type information
    // (`parserOptions.project`). Without them, a click handler that drops a
    // rejected promise passes lint.
    const cfg = await eslint.calculateConfigForFile('src/components/layout/AppHeader.tsx');
    expect(severity(cfg.rules, '@typescript-eslint/no-floating-promises')).toBe(2);
    expect(severity(cfg.rules, '@typescript-eslint/no-misused-promises')).toBe(2);
  });

  it('resolves the hook rules as errors', async () => {
    const cfg = await eslint.calculateConfigForFile('src/components/layout/AppHeader.tsx');
    expect(severity(cfg.rules, 'react-hooks/rules-of-hooks')).toBe(2);
  });

  it('leaves the type-aware rules OFF for the plain .mjs scripts', async () => {
    // They have no TypeScript program, so a type-aware rule there is an error
    // about the tool rather than about the code.
    const cfg = await eslint.calculateConfigForFile('scripts/sync-motors.mjs');
    expect(severity(cfg.rules, '@typescript-eslint/no-floating-promises')).toBe(0);
  });
});
