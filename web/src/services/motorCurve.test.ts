import { describe, it, expect } from 'vitest';
import { hasUsableCurve, MIN_CURVE_SAMPLES } from './motorCurve';
import { hasThrustCurve } from './runnability';
import { hasCurve, type CatalogMotor } from './motorDb';
import { isThrustSampleArray } from './motorStore';
import { buildRocketTree, C6 } from '../engine/api';
import { __setEngineForTests, type MotorSpec, type RocketTree } from '../engine/openRocketEngine';

/**
 * ONE threshold for "this motor can fly". Four modules used to each decide it
 * for themselves (any length, >= 2, >= 2, > 0), so a one-sample motor was
 * flyable to the Run button and empty at the mount.
 */
const one: MotorSpec = { ...C6, times: [0], thrusts: [5], masses: [0.02] };

describe('hasUsableCurve', () => {
  it('accepts a real motor', () => {
    expect(hasUsableCurve(C6)).toBe(true);
  });

  it('rejects a one-sample motor', () => {
    expect(MIN_CURVE_SAMPLES).toBe(2);
    expect(hasUsableCurve(one)).toBe(false);
  });

  it('rejects an absent, empty or lockstep-broken curve, and non-finite samples', () => {
    expect(hasUsableCurve(undefined)).toBe(false);
    expect(hasUsableCurve(null)).toBe(false);
    expect(hasUsableCurve({ ...C6, times: [] })).toBe(false);
    expect(hasUsableCurve({ ...C6, thrusts: [] })).toBe(false); // the store test strips thrusts to mean "no motor"
    expect(hasUsableCurve({ ...C6, masses: C6.masses.slice(1) })).toBe(false);
    expect(hasUsableCurve({ ...C6, thrusts: [0, NaN, 5, 5, 0] })).toBe(false);
    expect(hasUsableCurve({ ...C6, times: 'nope' as unknown as number[] })).toBe(false);
  });
});

describe('a one-sample motor is rejected everywhere', () => {
  it('by the Run button (runnability.hasThrustCurve)', () => {
    expect(hasThrustCurve(one)).toBe(false);
    expect(hasThrustCurve(C6)).toBe(true);
  });

  it('by the catalog (motorDb.hasCurve)', () => {
    const row = (samples: [number, number][]): CatalogMotor =>
      ({
        designation: 'X',
        manufacturer: 'M',
        class: 'C',
        diameter: 18,
        impulse: 5,
        burn: 1,
        mass: 20,
        curves: [{ src: 's', samples }],
      }) as CatalogMotor;
    expect(hasCurve(row([[0, 5]]))).toBe(false);
    expect(
      hasCurve(
        row([
          [0, 5],
          [1, 0],
        ]),
      ),
    ).toBe(true);
  });

  it('by the custom-motor store (motorStore.isThrustSampleArray)', () => {
    expect(isThrustSampleArray([{ time: 0, thrust: 5 }])).toBe(false);
    expect(
      isThrustSampleArray([
        { time: 0, thrust: 5 },
        { time: 1, thrust: 0 },
      ]),
    ).toBe(true);
  });

  it('by the builder (engine/api.buildRocketTree leaves the mount empty)', () => {
    const seated: unknown[] = [];
    __setEngineForTests({
      buildRocket: () => 1,
      reset: () => undefined,
      setMotorById: (...args: unknown[]) => {
        seated.push(args);
      },
    } as never);
    try {
      const tree = { components: [] } as unknown as RocketTree;
      buildRocketTree(tree, one, 'mount');
      expect(seated).toHaveLength(0);
      buildRocketTree(tree, C6, 'mount');
      expect(seated).toHaveLength(1);
    } finally {
      __setEngineForTests(null);
    }
  });
});
