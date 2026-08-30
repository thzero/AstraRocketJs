import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end config. Playwright auto-starts the Vite dev server on a fixed
 * port (strictPort so it fails loudly rather than drifting to 5174…), drives a
 * headless Chromium, and tears the server down when the run ends. The
 * SwiftShader flags software-render WebGL so the 3D views don't come up blank
 * on a headless/CI box with no GPU.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5180',
    trace: 'on-first-retry',
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader'] },
  },
  projects: [
    {
      name: 'chromium',
      // Desktop width so the split-pane layout (stats footer + Simulations
      // panel) renders — the mobile layout hides both behind tabs.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1500, height: 950 } },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5180 --strictPort',
    url: 'http://localhost:5180',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
