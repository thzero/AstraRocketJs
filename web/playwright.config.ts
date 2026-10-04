import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end config. Playwright auto-starts the Vite dev server on a fixed
 * port (strictPort so it fails loudly rather than drifting to 5174…), drives a
 * headless Chromium, and tears the server down when the run ends. The
 * SwiftShader flags software-render WebGL so the 3D views don't come up blank
 * on a headless/CI box with no GPU.
 */

// The specs that exercise the phone layout. They set their own viewport, so
// under the desktop project they already ran at phone widths; what the Pixel
// project adds is the rest of a phone: touch events, a 2.6x device pixel
// ratio, `isMobile` viewport handling and a mobile user agent. The pane
// dividers and maximize specs are desktop-only by design and are not here.
const MOBILE_SPECS = ['**/layout-overflow.spec.ts', '**/sketch-rotation.spec.ts', '**/mobile-layout.spec.ts'];

// The specs every pull request and master push runs (`npm run e2e:core`): the
// paths a broken build breaks first. The app boots with and without the engine,
// a part is selected and edited, a motor is picked, a simulation runs, and the
// shell holds together on a phone and from the keyboard. The rest of the suite
// runs by hand (e2e-full.yml), and locally with `npm run e2e`.
const CORE_SPECS = [
  '**/smoke.spec.ts',
  '**/engine-boot.spec.ts',
  '**/wip-gate.spec.ts',
  '**/schematic.spec.ts',
  '**/schematic-interaction.spec.ts',
  '**/component-editor.spec.ts',
  '**/component-dialog.spec.ts',
  '**/motor-picker.spec.ts',
  '**/simulations-tab.spec.ts',
  '**/auto-run.spec.ts',
  '**/units.spec.ts',
  '**/a11y.spec.ts',
  '**/layout-overflow.spec.ts',
  '**/mobile-layout.spec.ts',
];
const core = process.env.E2E_SCOPE === 'core';

export default defineConfig({
  testDir: './e2e',
  // Files spread across workers; the tests inside one file stay in order. Four
  // locally runs the 213 tests in under 2 minutes with no failures. A GitHub
  // runner has 4 vCPUs that also host the dev server and software-render WebGL
  // for every browser, so CI runs two. Far more than that (16 on a 32-core box)
  // starved the one dev server and timed out.
  fullyParallel: false,
  workers: process.env.CI ? 2 : 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Under CI the `github` reporter annotates the PR, and the HTML report is
  // written beside it (never auto-opened: there is no browser to open it in)
  // so that a retry which passed on the second go is still visible as a flake
  // in the uploaded report. The `github` reporter alone shows only the final
  // verdict, which is how flaky specs went unnoticed.
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5180',
    trace: 'on-first-retry',
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader'] },
  },
  projects: [
    {
      name: 'chromium',
      // Desktop width so the split-pane layout (stats footer + Simulations
      // panel) renders — the mobile layout hides both behind tabs. Past `2xl`
      // (1536), which is what the Design tab's property column asks for: at
      // 1500 that column is a dialog instead (component-dialog.spec) and every
      // spec that drives the property editor would be driving the dialog.
      ...(core ? { testMatch: CORE_SPECS } : {}),
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 950 } },
    },
    {
      name: 'mobile-chromium',
      testMatch: core ? MOBILE_SPECS.filter((spec) => CORE_SPECS.includes(spec)) : MOBILE_SPECS,
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5180 --strictPort',
    url: 'http://localhost:5180',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
