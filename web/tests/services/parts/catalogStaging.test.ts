import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  stagedPath,
  STAGED_COMPONENTS,
  STAGED_MOTORS,
  // @ts-expect-error - a plain .mjs build script helper, no types
} from '../../../scripts/lib/catalogStaging.mjs';

/**
 * A catalog staged between its two sync steps sits in the OS temp directory,
 * which every checkout on the machine shares. A digest step must read only the
 * catalog its own checkout staged, or it writes another checkout's catalog over
 * this one's public/data.
 */
describe('staged catalog names', () => {
  const web = fileURLToPath(new URL('../../..', import.meta.url));

  it('stages in the OS temp directory', () => {
    expect(dirname(STAGED_COMPONENTS)).toBe(tmpdir());
    expect(dirname(STAGED_MOTORS)).toBe(tmpdir());
  });

  it('names this checkout', () => {
    expect(STAGED_COMPONENTS).toBe(stagedPath('components', web));
    expect(STAGED_MOTORS).toBe(stagedPath('motors', web));
    expect(STAGED_COMPONENTS).not.toBe(STAGED_MOTORS);
  });

  it('gives another checkout another name', () => {
    expect(stagedPath('components', `${web}/../../other-checkout/web`)).not.toBe(STAGED_COMPONENTS);
    expect(stagedPath('motors', `${web}/../../other-checkout/web`)).not.toBe(STAGED_MOTORS);
  });
});
