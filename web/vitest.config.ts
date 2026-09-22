import { fileURLToPath } from 'node:url';
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
// Use them where behavior lives in the component rather than in a service —
// a rule the component itself enforces, say — and leave whole-app journeys and
// anything needing a real engine or layout to Playwright.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
    __HELP_URL__: JSON.stringify('https://example.test/docs'),
    __CONTRIBUTORS_URL__: JSON.stringify('https://example.test/graphs/contributors'),
    // A stand-in pin, like the version above. The REAL one is checked straight
    // out of engine-java/extract/UPSTREAM by appInfo.test.ts, which is where it
    // means something; baking it in here would only assert that two copies of
    // the same parse agree.
    __UPSTREAM__: JSON.stringify({
      ref: '0'.repeat(40),
      shortRef: '0'.repeat(9),
      date: '2000-01-01',
      commitUrl: `https://example.test/openrocket/commit/${'0'.repeat(40)}`,
    }),
  },
  resolve: {
    alias: {
      // `vite-plugin-pwa` synthesizes this specifier during the app build and
      // is not in the Vitest pipeline, so the import fails at RESOLUTION time -
      // before `vi.mock` gets a chance - and `UpdateToast` could not be
      // rendered in a test at all. The stub is the quiet default; a test that
      // cares mocks the specifier as usual.
      'virtual:pwa-register/react': fileURLToPath(new URL('./src/testing/pwaRegisterStub.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    // Vitest isolates one worker per FILE, and this suite is over a hundred of
    // them (measured 2026-09; the count only grows) — on a 32-core box that is
    // one worker per file at ~9.5 s of startup each. Under that load
    // engineBoundary.test.ts (the one file that drives the REAL TeaVM kernel)
    // blew the 5 s default timeout on a flight sim that takes 1.07 s unloaded:
    // `npm run test:coverage` — a CI gate — failed while `npm test` passed.
    // Capping the pool fixes that and is ~4× faster: 46 s → 11.8 s with
    // coverage.
    maxWorkers: 4,
    // Reported AND floored. `npm run test:coverage` (what CI runs) fails below
    // the floor; `npm test` does not collect coverage and is unaffected. The
    // floor is deliberately well under the measurement, not at it: it exists
    // to catch a change that deletes a test file or a whole tested module,
    // which drops lines by whole points, not to make every PR raise the
    // number. Raise it when the measurement moves up and stays there.
    coverage: {
      provider: 'v8',
      // `json-summary` is what gates.yml reads to put the totals in the job
      // summary; `text-summary` is the same numbers in the log, `lcov` the
      // per-line file it uploads.
      reporter: ['text-summary', 'json-summary', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      // Generated (the 2.9 MB TeaVM bundle), or not code under test.
      exclude: ['src/engine/vendor/**', 'src/**/*.test.*', 'src/testing/**', 'src/**/*.d.ts'],
      // 62.03% lines measured 2026-09-20 (`npm run test:coverage`, 1655 tests
      // in 142 files); the audit a few days earlier read 58%. The floor is
      // under both so an ordinary refactor does not trip it.
      thresholds: { lines: 55 },
    },
  },
});
