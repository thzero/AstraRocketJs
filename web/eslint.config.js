import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import playwright from 'eslint-plugin-playwright';
import vitest from '@vitest/eslint-plugin';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    // `public` and `src/engine/vendor` are generated, and both `.prettierignore`
    // and knip already exclude them. Without these entries `eslint .` walks every
    // generated file, the vendored TeaVM bundle included.
    //
    // Every block below is `files`-scoped, so no rule reaches them today; the
    // hazard is the next block. A config block added without a `files` key is the
    // normal way to add a project-wide rule, and it would fire on all of them
    // under `--max-warnings 0`: a gate failure nobody will read as "the generated
    // bundle is not our code".
    ignores: [
      'dist',
      'coverage',
      'playwright-report',
      'test-results',
      'public',
      'src/engine/vendor',
      'openrocket-database',
    ],
  },
  {
    // The build/sync scripts and this config itself are plain ESM .js/.mjs, which
    // the TypeScript block below (files: **/*.{ts,tsx}) does not match. They
    // include sync-motors.mjs and sync-components.mjs, the payload of a scheduled
    // workflow holding `contents: write` against the data branch the live app reads.
    files: ['scripts/**/*.mjs', '*.js', '*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser, ...globals.worker },
      // The type-aware parser. Without a program, the whole class of rules that
      // needs to know whether an expression is a Promise is silently inert:
      // `no-floating-promises`, `no-misused-promises`, `await-thenable` and the
      // `no-unsafe-*` family would all be off, and nothing would say so.
      //
      // All three tsconfigs, named explicitly rather than through
      // `projectService`. The service auto-discovers the nearest `tsconfig.json`
      // and nothing else, and this project deliberately has three: `tsconfig.json`
      // for src+tests, `tsconfig.e2e.json` for the Playwright specs, and
      // `tsconfig.node.json` for the config files that decide what ships. Under the
      // service, every e2e spec and every root config fails to parse with "was not
      // found by the project service". These are the same three `npm run typecheck` runs.
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.e2e.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // The two classic hook rules, plus the React-Compiler lint set that v7
      // includes in "recommended". Each of the compiler rules is listed by name
      // rather than spreading reactHooks.configs.recommended, so a plugin bump
      // that adds a rule is a decision here and not a surprise in CI. They are
      // `error` and the code passes them: the fetch-status effects (useCatalog,
      // ComponentPicker) and the aero sweep derive their pending flag from state
      // instead of setting it in an effect, and no render helper receives a ref
      // object as an argument.
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
      // In ESLint 10's recommended set; requires `cause` on every rethrow. Off
      // because existing rethrows do not attach one.
      'preserve-caught-error': 'off',
      // tsc's noUnusedLocals/noUnusedParameters already covers unused vars in
      // src; defer to it (with the leading-underscore escape hatch) rather than
      // double-reporting.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // The two rules the type-aware parser above exists for.
      //
      // `no-floating-promises` is the one with teeth. An un-awaited call that relies
      // on the store action catching internally is safe only by convention, so a
      // new action that forgets to catch is a click that silently does nothing,
      // with every gate green.
      '@typescript-eslint/no-floating-promises': 'error',
      // `checksVoidReturn: { attributes: false }` because a JSX handler prop is
      // declared `() => void` and React never awaits one: `onClick={async
      // () => ...}` is the ordinary way to write an async handler and flagging
      // every one of them would be flagging React. The other `checksVoidReturn` cases,
      // where a void-returning position is a real mistake, stay on.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      // The rest comes from `recommendedTypeChecked` above. The vendored engine
      // has a declaration file (src/engine/openrocket-engine.d.ts), so the
      // `no-unsafe-*` family does not fire on casts at the kernel seam, and in
      // src it finds next to nothing.
    },
  },
  {
    // Accessibility in the app's JSX: labels, roles, keyboard reach for
    // clickable elements. The es-tooling fork of eslint-plugin-jsx-a11y, the
    // same rules; the original's peer range stops at ESLint 9. It reads JSX
    // only, so what it cannot see (contrast, focus order, names that come
    // from i18n at run time) is the axe scan's job in e2e/a11y.spec.ts.
    files: ['src/**/*.tsx'],
    extends: [jsxA11y.configs.recommended],
    rules: {
      // Every autoFocus here is the first field of a modal dialog, and moving
      // focus into a dialog that opens is what the ARIA dialog pattern asks
      // for. The rule is about a page that grabs focus on load, which this app
      // has no form for.
      'jsx-a11y-x/no-autofocus': 'off',
      // NumberInput renders an <input>, so a label wrapping it is labeled.
      'jsx-a11y-x/label-has-associated-control': ['error', { controlComponents: ['NumberInput'], depth: 3 }],
    },
  },
  {
    // Tests and Node-side config run outside the browser sandbox.
    files: ['**/*.test.{ts,tsx}', '**/*.config.{ts,js}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // What the type-checked rules mean in a test, as against the app.
    files: ['tests/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      // A mock written `async () => value` stands in for a function that
      // returns a promise; it has nothing to await, and that is the point.
      '@typescript-eslint/require-await': 'off',
      // The kernel tests drive the real engine and read its JSON envelopes,
      // which arrive untyped by design: the test is the type check.
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // Testing Library's queries are generic and infer their element type
      // from a cast around them, so the rule reads `getByRole(...) as
      // HTMLInputElement` as already HTMLInputElement and calls the cast
      // needless; removing it leaves HTMLElement and breaks the test.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
  },
  {
    // The Playwright specs. The recommended set is mostly "you forgot to
    // await": an un-awaited `expect(locator).toBeVisible()` passes every time
    // (the promise is dropped), and `page.waitForTimeout` is a hard sleep where
    // the specs poll instead (see `autosaved` in base.ts).
    files: ['e2e/**/*.ts'],
    extends: [playwright.configs['flat/recommended']],
    rules: {
      // A spec that is `.only` or `.skip` on the branch passes CI while
      // testing nothing. `forbidOnly` in playwright.config.ts catches `.only`
      // under CI, at run time; this catches both, before the push.
      'playwright/no-focused-test': 'error',
      'playwright/no-skipped-test': 'error',
      // `page.waitForTimeout` is a guess about the machine. A use that is truly
      // needed has to disable this rule on its line and say why.
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
      // Testing Library's `getBy*` queries throw when nothing matches, so a
      // component test that only calls `screen.getByRole(...)` is asserting
      // presence (UpdateToast.test.tsx does exactly that). Without this the
      // rule would read those as tests with no assertion.
      'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'screen.getBy*', 'within.getBy*'] }],
    },
  },
  // Must be last: turns off any ESLint rules that would conflict with Prettier's
  // formatting, so the two tools don't fight. Prettier owns layout; ESLint owns
  // correctness.
  prettier,
);
