import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import playwright from 'eslint-plugin-playwright';
import vitest from '@vitest/eslint-plugin';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results'] },
  {
    // The build/sync scripts and this config itself are plain ESM .js/.mjs, so
    // the TypeScript block below (files: **/*.{ts,tsx}) never matched them —
    // 547 lines linted by nothing, including sync-motors.mjs and
    // sync-components.mjs, which are the payload of a scheduled workflow
    // holding `contents: write` against the data branch the live app reads.
    files: ['scripts/**/*.mjs', '*.js', '*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser, ...globals.worker },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // The two hook rules the project has always enforced, plus the
      // React-Compiler lint set that v7 folded into "recommended". Each of the
      // compiler rules is listed by name rather than spreading
      // reactHooks.configs.recommended, so a future plugin bump that adds a
      // rule is a decision here and not a surprise in CI. They are `error`
      // because the code was cleaned up to pass them: the fetch-status
      // effects (useCatalog, ComponentPicker) and the aero sweep now derive
      // their pending flag from state instead of setting it in an effect, and
      // no render helper receives a ref object as an argument.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/set-state-in-effect': 'error',
      'react-hooks/refs': 'error',
      'react-hooks/purity': 'error',
      'react-hooks/immutability': 'error',
      'react-hooks/memo-dependencies': 'error',
      'react-hooks/preserve-manual-memoization': 'error',
      'react-hooks/globals': 'error',
      'react-hooks/error-boundaries': 'error',
      'react-hooks/static-components': 'error',
      'react-hooks/component-hook-factories': 'error',
      'react-hooks/use-memo': 'error',
      'react-hooks/set-state-in-render': 'error',
      // New in ESLint 10's recommended set; requires `cause` on every rethrow.
      // Deferred with the same reasoning — enable when we do the cleanup pass.
      'preserve-caught-error': 'off',
      // tsc's noUnusedLocals/noUnusedParameters already covers unused vars in
      // src; defer to it (with the leading-underscore escape hatch) rather than
      // double-reporting.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Tests and Node-side config run outside the browser sandbox.
    files: ['**/*.test.{ts,tsx}', '**/*.config.{ts,js}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // The Playwright specs. The recommended set is mostly "you forgot to
    // await": an un-awaited `expect(locator).toBeVisible()` passes every time
    // (the promise is dropped), and `page.waitForTimeout` is the hard sleep
    // that base.ts and library.spec.ts spent a day each replacing with polls.
    // Nothing checked either before this.
    files: ['e2e/**/*.ts'],
    extends: [playwright.configs['flat/recommended']],
    rules: {
      // A spec that is `.only` or `.skip` on the branch passes CI while
      // testing nothing. `forbidOnly` in playwright.config.ts catches `.only`
      // under CI, at run time; this catches both, before the push.
      'playwright/no-focused-test': 'error',
      'playwright/no-skipped-test': 'error',
      // `page.waitForTimeout` is a guess about the machine. The one remaining
      // use (smoke.spec.ts, an rAF baseline) says why it is there; anything
      // new has to say so as loudly.
      'playwright/no-wait-for-timeout': 'error',
    },
  },
  {
    // The unit tests. Only the three rules that catch a test that is not
    // running: a focused or disabled test ships the suite with a hole in it,
    // and a test with no `expect` is green whatever the code does. The rest
    // of the plugin's recommended set is style, and Prettier plus the
    // TypeScript rules above already own that.
    files: ['**/*.test.{ts,tsx}'],
    plugins: { vitest },
    rules: {
      'vitest/no-focused-tests': 'error',
      'vitest/no-disabled-tests': 'error',
      // Testing Library's `getBy*` queries THROW when nothing matches, so a
      // component test that only calls `screen.getByRole(...)` is asserting
      // presence (UpdateToast.test.tsx does exactly that). Without this the
      // rule read those as tests with no assertion.
      'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'screen.getBy*', 'within.getBy*'] }],
    },
  },
  // Must be last: turns off any ESLint rules that would conflict with Prettier's
  // formatting, so the two tools don't fight. Prettier owns layout; ESLint owns
  // correctness.
  prettier,
);
