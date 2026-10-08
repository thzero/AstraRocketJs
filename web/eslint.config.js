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
    // `public` and `src/engine/vendor` are GENERATED, and both `.prettierignore`
    // and knip already exclude them. Without these two entries `eslint .` walked
    // 70 generated files - the 2.9 MB vendored TeaVM bundle included - to apply
    // zero rules to them, because every block below is `files`-scoped.
    //
    // Zero rules today is the hazard, not the cost. A config block added WITHOUT a
    // `files` key is the normal way to add a project-wide rule, and the moment one
    // appears it fires on all 70 under `--max-warnings 0`. That is a gate failure
    // nobody will read as "the generated bundle is not our code".
    ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'public', 'src/engine/vendor'],
  },
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
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser, ...globals.worker },
      // The TYPE-AWARE parser. Without a program, the whole class of rules that
      // needs to know whether an expression is a Promise is silently inert:
      // `no-floating-promises`, `no-misused-promises`, `await-thenable` and the
      // `no-unsafe-*` family were all off, and nothing said so.
      //
      // ALL THREE tsconfigs, named explicitly rather than through
      // `projectService`. The service auto-discovers the nearest `tsconfig.json`
      // and nothing else, and this project deliberately has three: `tsconfig.json`
      // for src+tests, `tsconfig.e2e.json` for the Playwright specs, and
      // `tsconfig.node.json` for the config files that decide what ships. Under the
      // service, every e2e spec and every root config came back "was not found by
      // the project service" - 31 parse errors, which is a louder failure than the
      // one being fixed. These are the same three `npm run typecheck` runs.
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.e2e.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
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
      // The two rules the type-aware parser above exists for.
      //
      // `no-floating-promises` is the one with teeth. Every one of the three it
      // found was safe only by CONVENTION - the store action it called caught
      // internally - so a new action that forgets to is a click that silently does
      // nothing, with every gate green.
      '@typescript-eslint/no-floating-promises': 'error',
      // `checksVoidReturn: { attributes: false }` because a JSX handler prop is
      // DECLARED `() => void` and React has never awaited one: `onClick={async
      // () => ...}` is the ordinary way to write an async handler and flagging all
      // 26 of them would be flagging React. The other `checksVoidReturn` cases,
      // where a void-returning position is a real mistake, stay on.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      // The rest comes from `recommendedTypeChecked` above. It used to be held
      // back because the `no-unsafe-*` family fired on every cast at the kernel
      // seam; the vendored engine has a declaration file now
      // (src/engine/openrocket-engine.d.ts), and in src that family finds next
      // to nothing.
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
