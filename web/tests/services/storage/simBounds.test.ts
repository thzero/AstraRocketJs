import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, SIM_BOUNDS } from '../../../src/services/storage/settings';

/**
 * The solver bounds, and the reason they are a shared constant.
 *
 * `maxTime / timeStep` is the RK4 iteration count, so both ends need a cap on
 * every surface that can set them. Uncapped, `1000000` asks for tens of millions
 * of steps with nothing to interrupt it. The global Settings row and the
 * per-simulation override read one shared bound (simBoundsFields.test.tsx).
 */
describe('SIM_BOUNDS', () => {
  it('brackets every default it governs', () => {
    const s = DEFAULT_SETTINGS.simulation;
    for (const k of ['timeStep', 'maxTime', 'maxAngleStep'] as const) {
      expect(s[k], k).toBeGreaterThanOrEqual(SIM_BOUNDS[k].min);
      expect(s[k], k).toBeLessThanOrEqual(SIM_BOUNDS[k].max);
    }
  });

  it('keeps the iteration count finite at the worst legal combination', () => {
    // The whole point of capping both ends: the product has to stay somewhere a
    // browser can actually finish.
    expect(SIM_BOUNDS.maxTime.max / SIM_BOUNDS.timeStep.min).toBeLessThanOrEqual(10_000_000);
  });
});
