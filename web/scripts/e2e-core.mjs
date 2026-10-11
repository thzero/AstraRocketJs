#!/usr/bin/env node
/**
 * Runs the core end-to-end specs (CORE_SPECS in playwright.config.ts), passing
 * any further arguments through to Playwright. Setting E2E_SCOPE here rather
 * than in the npm script keeps it working in every shell, cmd.exe included.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

// Playwright's CLI run by this same node, with no shell: a shell joins the
// arguments unquoted, so `-g "two words"` would split, and Windows refuses to
// spawn npx.cmd without one.
const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');

const result = spawnSync(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, E2E_SCOPE: 'core' },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
