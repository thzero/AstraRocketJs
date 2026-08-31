import { defineConfig } from 'vitest/config';

// Unit tests run under Vitest (Vite-native, so it reuses vite.config's `define`
// for __APP_VERSION__ / __HELP_URL__ and the same module resolution). Playwright
// e2e stays in ./e2e and is NOT picked up here.
//
// Default environment is 'node' (fast, for the pure services). The few DOM-coupled
// tests (orkFile import, xmlUtil.xmlText, schematicExport) opt in per-file with a
//   // @vitest-environment jsdom
// comment at the top of the file.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
    __HELP_URL__: JSON.stringify('https://example.test/wiki'),
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
