import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';

/**
 * A built source tree is never the pinned release, so `--or` gives digests the
 * desktop rejects. It runs only when OPENROCKET_UNPINNED=1 says so, and then
 * with the same "do not commit" warning another jar gets.
 */
describe('checkSourceTree', () => {
  const lib = new URL('../../../scripts/lib/openrocketRelease.mjs', import.meta.url).href;
  const run = (unpinned: boolean) => {
    const env = { ...process.env };
    delete env.OPENROCKET_UNPINNED;
    if (unpinned) env.OPENROCKET_UNPINNED = '1';
    return spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const m = await import(${JSON.stringify(lib)}); m.checkSourceTree('some-checkout'); console.log('ran');`,
      ],
      { env, encoding: 'utf8' },
    );
  };

  it('refuses a source tree when the run is pinned', () => {
    const r = run(false);
    expect(r.status).toBe(2);
    expect(r.stdout).not.toContain('ran');
    expect(r.stderr).toContain('some-checkout is a source tree');
  });

  it('lets it through with the unpinned warning', () => {
    const r = run(true);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('ran');
    expect(r.stderr).toContain('Do not commit or publish');
  });
});
