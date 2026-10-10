import { describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ n: 0 }));
vi.mock('../../../src/services/app/stableJson', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../src/services/app/stableJson')>();
  return {
    stableJson: (...args: Parameters<typeof real.stableJson>) => {
      calls.n++;
      return real.stableJson(...args);
    },
  };
});

const { resultKey } = await import('../../../src/services/flight/simulations');
const { newFlightConfig } = await import('../../../src/services/flight/flightConfigs');

/**
 * Every store update asks every row whether it is outdated. With unchanged
 * inputs the key must come from the cache, not from serializing the
 * configuration's thrust curves again.
 */
describe('resultKey caching', () => {
  const tree = { components: [{ type: 'nosecone', id: 'n', length: 0.1 }] } as never;
  const config = newFlightConfig();
  const sim = {
    id: 's',
    name: 'A',
    configId: config.id,
    launch: { launchRodLengthM: 1 },
    result: null,
  } as never as Parameters<typeof resultKey>[2];
  const globals = { timeStep: 0.01 } as never as Parameters<typeof resultKey>[3];

  it('serializes once for the same four inputs', () => {
    const first = resultKey(tree, config, sim, globals);
    const before = calls.n;
    expect(resultKey(tree, config, sim, globals)).toBe(first);
    expect(calls.n).toBe(before);
  });

  it('recomputes when any input object is replaced', () => {
    const base = resultKey(tree, config, sim, globals);
    const moved = { ...sim, launch: { ...sim.launch, launchRodLengthM: 2 } };
    expect(resultKey(tree, config, moved, globals)).not.toBe(base);
    expect(resultKey(tree, { ...config, motors: { m: {} as never } }, sim, globals)).not.toBe(base);
    expect(resultKey(tree, config, sim, { ...globals, timeStep: 0.02 })).not.toBe(base);
    expect(resultKey({ components: [] } as never, config, sim, globals)).not.toBe(base);
  });
});
