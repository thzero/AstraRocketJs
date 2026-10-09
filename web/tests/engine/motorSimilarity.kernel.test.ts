import { describe, expect, it, vi } from 'vitest';
import { KERNEL_TEST_TIMEOUT_MS } from '../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * The kernel's MotorCorrelation through the bridge: what desktop's "Hide very
 * similar thrust curves" compares against 0.95.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- the TeaVM bundle is untyped */
const loadEngine = async (): Promise<any> => {
  (globalThis as any).$rt_putStdoutCustom ??= () => {};
  (globalThis as any).$rt_putStderrCustom ??= () => {};
  return import('../../src/engine/vendor/openrocket-engine.mjs' as string);
};

const times = [0, 0.1, 0.5, 1, 1.2];
const thrust = [0, 20, 15, 10, 0];

describe('getMotorSimilarity', () => {
  it('scores a curve against itself as 1 and a half-thrust copy as 0.5', async () => {
    const engine = await loadEngine();
    expect(engine.getMotorSimilarity(times, thrust, times, thrust)).toBeCloseTo(1, 9);
    expect(
      engine.getMotorSimilarity(
        times,
        thrust,
        times,
        thrust.map((f) => f / 2),
      ),
    ).toBeCloseTo(0.5, 6);
  });

  it('rejects a malformed curve with a message', async () => {
    const engine = await loadEngine();
    expect(() => engine.getMotorSimilarity([0], [1], times, thrust)).toThrow(/at least 2/);
  });
});
