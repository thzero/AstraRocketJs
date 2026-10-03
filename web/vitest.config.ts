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
      'virtual:pwa-register/react': fileURLToPath(new URL('./tests/testing/pwaRegisterStub.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
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
    // Reported AND enforced. `npm run verify:ci` (what both workflows run) fails
    // below these minimums; `npm run verify` and `npm test` do not collect coverage
    // at all and are unaffected, which is why instrumentation stays off the command
    // a developer types before pushing.
    //
    // The minimums sit UNDER the measurement on purpose. They exist to catch a
    // change that deletes a test file or a whole tested module, which drops the
    // percentage by whole points, not to make every PR raise a number. Raise them
    // when a higher reading has stayed put.
    coverage: {
      provider: 'v8',
      // `json-summary` is what gates.yml reads to put the totals in the job
      // summary; `text-summary` is the same numbers in the log, `lcov` the
      // per-line file it uploads.
      reporter: ['text-summary', 'json-summary', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      // Generated (the 2.9 MB TeaVM bundle), or not code under test.
      // The tests and their scaffolding are their own tree now, and coverage
      // only INCLUDES src, so neither needs excluding any more.
      exclude: ['src/engine/vendor/**', 'src/**/*.d.ts'],
      // Measured 2026-10-02 (`npm run verify:ci`, 3490 tests in 263 files): lines
      // 74.85%, statements 73.55%, branches 66.52%, functions 66%. Earlier readings:
      // 70.93% lines on 2026-09-25 at 2532 tests, 62.03% on 2026-09-20 at 1655, and
      // 58% in the audit before that.
      //
      // Each minimum is about five points under its measurement. `lines: 55` against
      // 74.85% was twenty points of slack - roughly a fifth of the suite could be
      // deleted and still pass - while five points absorbs the ordinary wobble of a
      // refactor that moves code between files.
      //
      // Branches and functions are enforced too, where they used to be printed in
      // the job summary and checked by nothing. A number nothing enforces is
      // decoration, and these two are where coverage actually erodes: a new `if`
      // with no test for its other side moves branches and leaves lines alone.
      thresholds: { lines: 70, branches: 62, functions: 61, statements: 69 },
    },
  },
});
