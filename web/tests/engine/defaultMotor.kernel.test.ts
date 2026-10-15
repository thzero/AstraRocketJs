import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { C6 } from '../../src/engine/api';
import { __setEngineForTests, motorStatistics } from '../../src/engine/openRocketEngine';
import { loadEngine } from '../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

interface CatalogRow {
  manufacturer: string;
  designation: string;
  impulse: number;
  burn: number;
  maxThrust: number;
  mass: number;
  propWeightG: number;
  diameter: number;
  length: number;
  delays: string;
  curves: { src: string; samples: [number, number][] }[];
}

/** The certified Estes C6 row of the bundled catalog. */
const row = (
  JSON.parse(readFileSync(join(__dirname, '../../public/data/motors.generated.json'), 'utf8')) as CatalogRow[]
).find((r) => r.manufacturer === 'Estes' && r.designation === 'C6')!;
const certified = row.curves.find((c) => c.src.startsWith('Certified'))!;

/** The catalog states impulse and burn to two decimals. */
const CATALOG_ROUNDING = 0.005;

const pairs = (times: readonly number[], thrusts: readonly number[]) =>
  times.map((t, i) => [t, thrusts[i]!] as [number, number]);

beforeAll(async () => {
  __setEngineForTests(await loadEngine());
});

/**
 * The motor seated into every empty mount is the Estes C6 the catalog lists,
 * so the default design flies the impulse its label promises.
 */
describe('the built-in C6', () => {
  it("has the catalog row's total impulse and peak thrust, as the kernel computes them", () => {
    const stats = motorStatistics(pairs(C6.times, C6.thrusts))!;
    expect(stats).not.toBeNull();
    expect(Math.abs(stats.totalImpulse - row.impulse)).toBeLessThanOrEqual(CATALOG_ROUNDING);
    expect(stats.maxThrust).toBeCloseTo(row.maxThrust, 9);
  });

  it("burns as long as the catalog's certified curve", () => {
    // The catalog's burn runs to the last sample; the kernel's runs between
    // the crossings of 5% of peak. Both must agree with the certified curve,
    // which the kernel takes only from t = 0.
    expect(Math.abs(C6.times[C6.times.length - 1]! - row.burn)).toBeLessThanOrEqual(CATALOG_ROUNDING);
    const own = motorStatistics(pairs(C6.times, C6.thrusts))!;
    const cert = motorStatistics([[0, 0], ...certified.samples])!;
    expect(cert).not.toBeNull();
    expect(own.burnTime).toBeCloseTo(cert.burnTime, 9);
    expect(own.totalImpulse).toBeCloseTo(cert.totalImpulse, 9);
  });

  it("carries the catalog's size, weights and a delay it is sold with", () => {
    expect(C6.diameter).toBeCloseTo(row.diameter / 1000, 9);
    expect(C6.length).toBeCloseTo(row.length / 1000, 9);
    expect(C6.masses).toHaveLength(C6.times.length);
    expect(C6.masses[0]).toBeCloseTo(row.mass / 1000, 9);
    expect(C6.masses[C6.masses.length - 1]).toBeCloseTo((row.mass - row.propWeightG) / 1000, 9);
    // Between the ends, mass falls in proportion to cumulative impulse by the
    // trapezoid rule (AbstractMotorLoader.calculateMass); stated to 0.1 mg.
    const cum = [0];
    for (let i = 1; i < C6.times.length; i++) {
      cum.push(cum[i - 1]! + ((C6.thrusts[i]! + C6.thrusts[i - 1]!) / 2) * (C6.times[i]! - C6.times[i - 1]!));
    }
    const total = cum[cum.length - 1]!;
    cum.forEach((impulse, i) => {
      const expected = (row.mass - row.propWeightG * (impulse / total)) / 1000;
      expect(Math.abs(C6.masses[i]! - expected)).toBeLessThanOrEqual(0.5e-7);
    });
    expect(row.delays.split(',').map(Number)).toContain(C6.ejectionDelay);
  });
});
