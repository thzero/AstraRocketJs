#!/usr/bin/env node
/**
 * Runs the core end-to-end specs (CORE_SPECS in playwright.config.ts), passing
 * any further arguments through to Playwright. Setting E2E_SCOPE here rather
 * than in the npm script keeps it working in every shell, cmd.exe included.
 */
import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, E2E_SCOPE: 'core' },
});
process.exit(result.status ?? 1);
