import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results'] },
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
      // Pin the two hook rules the project has always enforced. Do NOT spread
      // reactHooks.configs.recommended: v7 folded the React-Compiler lint set
      // (set-state-in-effect, refs, immutability, purity, …) into "recommended",
      // which flags long-standing intentional patterns. Adopting those is a
      // separate code-cleanup task, not part of a tooling bump.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
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
  // Must be last: turns off any ESLint rules that would conflict with Prettier's
  // formatting, so the two tools don't fight. Prettier owns layout; ESLint owns
  // correctness.
  prettier,
);
