import { describe, it, expect } from 'vitest';
import { hasUsableCurve, MIN_CURVE_SAMPLES } from '../../../src/services/motors/motorCurve';
import { hasThrustCurve } from '../../../src/services/flight/runnability';
import { hasCurve, type CatalogMotor } from '../../../src/services/motors/motorDb';
import { isThrustSampleArray } from '../../../src/services/motors/motorStore';
import { C6 } from '../../../src/engine/api';
import { buildConfiguredRocket } from '../../../src/services/design/buildRocket';
import { newFlightConfig } from '../../../src/services/flight/flightConfigs';
import { __setEngineForTests, type MotorSpec, type RocketTree } from '../../../src/engine/openRocketEngine';

/**
 * One threshold for "this motor can fly". Decided per module (any length, >= 2,
 * >= 2, > 0), a one-sample motor is flyable to the Run button and empty at the
 * mount.
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

  it('by the builder (buildConfiguredRocket leaves the mount empty)', () => {
    const seated: unknown[] = [];
    __setEngineForTests({
      buildRocket: () => 1,
      reset: () => undefined,
      setMotorById: (...args: unknown[]) => {
        seated.push(args);
      },
    } as never);
    try {
      const tree = { components: [{ type: 'bodytube', id: 'mount', motorMount: true }] } as unknown as RocketTree;
      buildConfiguredRocket(tree, newFlightConfig({ mount: { spec: one } }));
      expect(seated).toHaveLength(0);
      buildConfiguredRocket(tree, newFlightConfig({ mount: { spec: C6 } }));
      expect(seated).toHaveLength(1);
    } finally {
      __setEngineForTests(null);
    }
  });
});
