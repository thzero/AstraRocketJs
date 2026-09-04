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
      ...reactHooks.configs.recommended.rules,
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
