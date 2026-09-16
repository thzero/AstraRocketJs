import { defineConfig } from 'vitest/config';

// Unit tests run under Vitest (Vite-native, so it reuses vite.config's `define`
// for __APP_VERSION__ / __HELP_URL__ and the same module resolution). Playwright
// e2e stays in ./e2e and is NOT picked up here.
//
// Default environment is 'node' (fast, for the pure services). The few DOM-coupled
// tests (orkFile import, xmlUtil.xmlText, schematicExport) opt in per-file with a
//   // @vitest-environment jsdom
// comment at the top of the file.
//
// `.test.tsx` files are COMPONENT tests, rendered with React Testing Library.
// They always need a DOM, so they declare the jsdom environment the same way.
// Use them where behaviour lives in the component rather than in a service —
// a rule the component itself enforces, say — and leave whole-app journeys and
// anything needing a real engine or layout to Playwright.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
    __HELP_URL__: JSON.stringify('https://example.test/docs'),
    __CONTRIBUTORS_URL__: JSON.stringify('https://example.test/graphs/contributors'),
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    // Reported, not enforced. 800-odd tests said nothing about WHICH of the
    // ~200 source modules they touch; a threshold before anyone has read the
    // baseline would just be a number someone games. `npm run test:coverage`.
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      // Generated (the 2.9 MB TeaVM bundle), or not code under test.
      exclude: ['src/engine/vendor/**', 'src/**/*.test.*', 'src/testing/**', 'src/**/*.d.ts'],
    },
  },
});
