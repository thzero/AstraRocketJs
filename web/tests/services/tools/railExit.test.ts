import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { G0 } from '../../../src/services/motors/motorMath';
import { __setEngineForTests } from '../../../src/engine/openRocketEngine';
import { finalizeSamples } from '../../../src/services/motors/curveFinalize';
import { loadEngine } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import {
  maxDryMassKg,
  maxWindMs,
  railExit,
  railNeededM,
  weathercockDeg,
  type RailExit,
} from '../../../src/services/tools/railExit';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/* eslint-disable @typescript-eslint/no-explicit-any -- the TeaVM bundle is untyped */
let engine: any;
beforeAll(async () => {
  engine = await loadEngine();
  __setEngineForTests(engine);
});

/** The kernel's average thrust for a curve, straight from the bridge. */
const kernelAverage = (curve: [number, number][]): number => {
  const fin = finalizeSamples(curve);
  const raw = JSON.parse(
    engine.getMotorStatistics(
      fin.map((p) => p[0]),
      fin.map((p) => p[1]),
    ) as string,
  ) as { averageThrust: number; error?: string };
  expect(raw.error).toBeUndefined();
  return raw.averageThrust;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/** 10 N for a second, burning no mass, so the rail run has a closed form. */
const STEADY = { times: [0, 1], thrusts: [10, 10], masses: [0.02, 0.02] };

describe('railExit', () => {
  it('matches constant acceleration for a steady motor', () => {
    const r = railExit({ motor: STEADY, dryMassKg: 0.08, railLengthM: 1 }) as RailExit;
    const a = 10 / 0.1 - G0;
    expect(r.liftoffMassKg).toBeCloseTo(0.1, 9);
    expect(r.exitSpeedMs).toBeCloseTo(Math.sqrt(2 * a * 1), 1);
    expect(r.exitS).toBeCloseTo(Math.sqrt(2 / a), 2);
    expect(r.thrustToWeightAverage).toBeCloseTo(
      kernelAverage([
        [0, 10],
        [1, 10],
      ]) /
        (0.1 * G0),
      6,
    );
    expect(r.thrustToWeightPeak).toBeCloseTo(r.thrustToWeightAverage, 6);
  });

  it('waits on the rail until the thrust exceeds the weight', () => {
    const ramp = { times: [0, 0.5, 1], thrusts: [0, 10, 10], masses: [0.02, 0.02, 0.02] };
    const r = railExit({ motor: ramp, dryMassKg: 0.08, railLengthM: 1 }) as RailExit;
    // 0.98 N is reached a tenth of the way up the ramp.
    expect(r.liftoffS).toBeCloseTo(0.049, 2);
  });

  it('counts the propellant burned on the rail', () => {
    const burning = { ...STEADY, masses: [0.06, 0.01] };
    const fixed = railExit({ motor: { ...STEADY, masses: [0.06, 0.06] }, dryMassKg: 0.04, railLengthM: 1 }) as RailExit;
    const lighter = railExit({ motor: burning, dryMassKg: 0.04, railLengthM: 1 }) as RailExit;
    expect(lighter.exitSpeedMs).toBeGreaterThan(fixed.exitSpeedMs);
  });

  it('says when the motor cannot lift the rocket, or it stops on the rail', () => {
    expect(railExit({ motor: STEADY, dryMassKg: 2, railLengthM: 1 })).toBe('noLiftoff');
    const short = { times: [0, 0.01, 0.02], thrusts: [10, 10, 0], masses: [0.02, 0.02, 0.02] };
    expect(railExit({ motor: short, dryMassKg: 0.08, railLengthM: 5 })).toBe('stalls');
  });
});

describe('the wind and mass limits', () => {
  it('turns a crosswind equal to the exit speed by 45 degrees', () => {
    expect(weathercockDeg(15, 15)).toBeCloseTo(45, 9);
    expect(weathercockDeg(0, 15)).toBe(0);
  });

  it('gives the wind that reaches the limit exactly', () => {
    expect(weathercockDeg(maxWindMs(15), 15)).toBeCloseTo(20, 9);
  });

  it('finds the heaviest rocket that still meets both minimums', () => {
    const dry = maxDryMassKg(STEADY, 1, 10)!;
    const at = railExit({ motor: STEADY, dryMassKg: dry, railLengthM: 1 }) as RailExit;
    // Whichever bound binds, it binds at the edge.
    const exitEdge = Math.abs(at.exitSpeedMs - 10) < 0.05;
    const ratioEdge = Math.abs(at.thrustToWeightAverage - 5) < 0.01;
    expect(exitEdge || ratioEdge).toBe(true);
    expect(at.exitSpeedMs).toBeGreaterThanOrEqual(10 - 1e-6);
    expect(at.thrustToWeightAverage).toBeGreaterThanOrEqual(5 - 1e-6);
  });

  it('has no heaviest rocket when even the motor alone falls short', () => {
    expect(maxDryMassKg({ times: [0, 1], thrusts: [0.5, 0.5], masses: [0.02, 0.02] }, 1, 10)).toBeNull();
  });
});

describe('railNeededM', () => {
  it('is the distance to reach the speed, for a steady motor', () => {
    const a = 10 / 0.1 - G0;
    // v² = 2as, so 15 m/s takes 225 / 2a meters.
    expect(railNeededM(STEADY, 0.08, 15)).toBeCloseTo(225 / (2 * a), 1);
  });

  it('agrees with railExit: that rail leaves at that speed', () => {
    const need = railNeededM(STEADY, 0.08, 12)!;
    const r = railExit({ motor: STEADY, dryMassKg: 0.08, railLengthM: need }) as RailExit;
    expect(r.exitSpeedMs).toBeCloseTo(12, 1);
  });

  it('is null when the rocket never gets that fast', () => {
    const short = { times: [0, 0.01, 0.02], thrusts: [10, 10, 0], masses: [0.02, 0.02, 0.02] };
    expect(railNeededM(short, 0.08, 15)).toBeNull();
    expect(railNeededM(STEADY, 2, 15)).toBeNull();
  });
});

interface CatalogRow {
  designation: string;
  mass: number;
  propWeightG: number;
  curves?: { samples: [number, number][] }[];
}

/**
 * The average thrust-to-weight is the kernel's average thrust, measured inside
 * the burn window between the crossings of 5% of peak, over the liftoff
 * weight: the figure the motor picker shows. A curve with a long low tail
 * averages lower over its whole span.
 */
describe('the average thrust-to-weight', () => {
  const rows = JSON.parse(
    readFileSync(join(__dirname, '../../../public/data/motors.generated.json'), 'utf8'),
  ) as CatalogRow[];
  const motorOf = (r: CatalogRow) => {
    const samples = r.curves![0]!.samples;
    const full = r.mass / 1000;
    const empty = (r.mass - r.propWeightG) / 1000;
    const end = samples[samples.length - 1]![0];
    return {
      times: samples.map((p) => p[0]),
      thrusts: samples.map((p) => p[1]),
      masses: samples.map((p) => full - ((full - empty) * p[0]) / end),
    };
  };
  /** A tail under 5% of peak: the last sample is under that, and so is the one before it. */
  const hasLowTail = (s: [number, number][]) => {
    const peak = Math.max(...s.map((p) => p[1]));
    const tail = s.slice(-3, -1);
    return tail.length === 2 && tail.every((p) => p[1] > 0 && p[1] < 0.05 * peak);
  };
  const sampled = rows.filter((r) => (r.curves?.[0]?.samples.length ?? 0) >= 3 && r.mass > 0);
  const step = Math.max(1, Math.floor(sampled.length / 60));
  const spread = sampled.filter((_, i) => i % step === 0);
  const tailed = sampled.filter((r) => hasLowTail(r.curves![0]!.samples));

  it('is the kernel average over the liftoff weight, across the catalog', () => {
    expect(spread.length).toBeGreaterThan(40);
    expect(tailed.length).toBeGreaterThan(5);
    for (const r of [...spread, ...tailed]) {
      const motor = motorOf(r);
      // Light enough that every motor leaves a short rail.
      const r0 = railExit({ motor, dryMassKg: 0, railLengthM: 0.01 });
      if (typeof r0 === 'string') continue;
      const want = kernelAverage(r.curves![0]!.samples) / (r0.liftoffMassKg * G0);
      expect(r0.thrustToWeightAverage, r.designation).toBeCloseTo(want, 6);
    }
  });

  it('caps the heaviest rocket by the kernel average', () => {
    const r = tailed[0]!;
    const motor = motorOf(r);
    const dry = maxDryMassKg(motor, 0.01, 0)!;
    expect(dry).not.toBeNull();
    // The ratio bound binds at the kernel's average: average / (5 g) less the motor.
    const cap = kernelAverage(r.curves![0]!.samples) / (5 * G0) - motor.masses[0]!;
    expect(dry).toBeLessThanOrEqual(cap + 1e-9);
    expect(dry).toBeGreaterThan(cap * 0.99);
  });

  it('reads the thrust-to-weight at exit over the mass at that moment', () => {
    const burning = { times: [0, 1], thrusts: [10, 10], masses: [0.06, 0.01] };
    const r = railExit({ motor: burning, dryMassKg: 0.04, railLengthM: 1 }) as RailExit;
    const massAtExit = 0.04 + 0.06 - 0.05 * r.exitS;
    expect(r.thrustToWeightAtExit).toBeCloseTo(10 / (massAtExit * G0), 6);
    expect(r.thrustToWeightAtExit).toBeGreaterThan(10 / (r.liftoffMassKg * G0));
  });
});
