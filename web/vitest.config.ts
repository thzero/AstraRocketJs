import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

// Unit tests run under Vitest. This file takes the place of vite.config.ts for
// them: Vitest reads one config, so nothing in vite.config.ts (its `define`,
// plugins or resolution) applies here. The build-time constants the app reads
// are defined below with test stand-ins, and the one virtual module a test
// imports is aliased to a stub. Playwright e2e stays in ./e2e and is not picked
// up here.
//
// Default environment is 'node' (fast, for the pure services). Tests that need a
// DOM opt in per-file with a
//   // @vitest-environment jsdom
// comment at the top of the file.
//
// `.test.tsx` files are component tests, rendered with React Testing Library.
// They always need a DOM, so they declare the jsdom environment the same way.
// Use them where behavior lives in the component rather than in a service
// (a rule the component itself enforces, say), and leave whole-app journeys and
// anything needing a real engine or layout to Playwright.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('0.0.0-test'),
    __APP_CHANNEL__: JSON.stringify(''),
    __HELP_URL__: JSON.stringify('https://example.test/docs'),
    __CONTRIBUTORS_URL__: JSON.stringify('https://example.test/graphs/contributors'),
    // A stand-in pin, like the version above. The real one is checked straight
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
      // is not in the Vitest pipeline, so the import fails at resolution time -
      // before `vi.mock` gets a chance - and without this alias `UpdateToast`
      // cannot be rendered in a test at all. The stub is the quiet default; a
      // test that cares mocks the specifier as usual.
      'virtual:pwa-register/react': fileURLToPath(new URL('./tests/testing/pwaRegisterStub.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // `tests/repo` checks repository conventions (comment wording, em dashes, CI
    // triggers, orphan scripts and exports), not app behavior. `npm run audit`
    // runs them with REPO_CHECKS set; the unit suite and CI leave them out.
    exclude: process.env.REPO_CHECKS ? configDefaults.exclude : [...configDefaults.exclude, 'tests/repo/**'],
    environment: 'node',
    setupFiles: ['tests/testing/allLocales.ts'],
    // A passing test slower than this prints a yellow check instead of a green
    // one. The 300 ms default marks most component tests on a CI runner, so the
    // yellow stops pointing at anything.
    slowTestThreshold: 2000,
    // Vitest isolates one worker per file, and this suite has hundreds of them.
    // Uncapped, a 32-core box starts one worker per file at ~9.5 s of startup
    // each, and under that load a file that drives the real TeaVM kernel can blow
    // the 5 s default timeout on a flight sim that takes about 1 s unloaded.
    // Capping the pool avoids that and is faster overall.
    maxWorkers: 4,
    // CI runs the suite on a shared 4-vCPU runner, where tests run about ten
    // times slower than on a developer machine: a 500 ms test passes the 5 s
    // default there. On CI the default is a minute, which still
    // catches a hang; off CI it stays at vitest's 5 s, so a test that has
    // started taking seconds is noticed where it is written. Files that fly the
    // kernel still set KERNEL_TEST_TIMEOUT_MS, which is longer.
    ...(process.env.CI ? { testTimeout: 60_000, hookTimeout: 60_000 } : {}),
    // Reported and enforced by `npm run audit`, which is run by hand and fails
    // below these minimums. `npm run verify` and `npm test` do not collect
    // coverage, so instrumentation stays off the command a developer types
    // before pushing.
    //
    // The minimums sit under the measurement on purpose. They exist to catch a
    // change that deletes a test file or a whole tested module, which drops the
    // percentage by whole points, not to make every PR raise a number. Raise them
    // when a higher reading has stayed put.
    coverage: {
      provider: 'v8',
      // `text-summary` is the totals in the log of `npm run audit`;
      // `json-summary` the same numbers as a file; `lcov` the per-line report
      // for an editor or a coverage viewer.
      reporter: ['text-summary', 'json-summary', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      // Generated (the 2.9 MB TeaVM bundle), or not code under test.
      // The tests and their scaffolding live outside src, and coverage only
      // includes src, so neither needs excluding.
      exclude: ['src/engine/vendor/**', 'src/**/*.d.ts'],
      // Each minimum is five points under its measurement (`npx vitest
      // run --coverage`), rounded down to a whole number: enough to absorb the
      // ordinary wobble of a refactor that moves code between files, and little
      // enough that deleting a tested module still fails.
      //
      // Branches and functions are enforced as well as lines: they are where
      // coverage erodes. A new `if` with no test for its other side moves
      // branches and leaves lines alone.
      thresholds: { lines: 82, branches: 74, functions: 76, statements: 81 },
    },
  },
});
