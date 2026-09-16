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
    // Vitest isolates one worker per FILE, and this suite has 82 of them — on a
    // 32-core box that is 82 workers at ~9.5 s of startup each. Under that load
    // engineBoundary.test.ts (the one file that drives the REAL TeaVM kernel)
    // blew the 5 s default timeout on a flight sim that takes 1.07 s unloaded:
    // `npm run test:coverage` — a CI gate — failed while `npm test` passed.
    // Capping the pool fixes that and is ~4× faster: 46 s → 11.8 s with coverage.
    maxWorkers: 4,
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
