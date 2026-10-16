import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';

/**
 * The one `arg()` every build-time script reads its flags with. A flag given
 * with no value stops the script rather than falling back to a default.
 */
describe('arg', () => {
  const lib = new URL('../../../scripts/lib/args.mjs', import.meta.url).href;
  const run = (...argv: string[]) =>
    spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const { arg } = await import(${JSON.stringify(lib)}); console.log(JSON.stringify(arg('jar') ?? null));`,
        '--',
        ...argv,
      ],
      { encoding: 'utf8' },
    );

  it('reads the value after the flag', () => {
    const r = run('--jar', 'x.jar');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('"x.jar"');
  });

  it('gives undefined for a flag not given', () => {
    const r = run('--or', 'tree');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('null');
  });

  it('stops on a flag with no value, last or followed by another flag', () => {
    for (const argv of [['--jar'], ['--jar', '--or', 'tree']]) {
      const r = run(...argv);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('--jar needs a value');
    }
  });
});
