import { describe, expect, it } from 'vitest';
import { G0 } from '../../../src/services/motors/motorMath';
import {
  maxDryMassKg,
  maxWindMs,
  railExit,
  railNeededM,
  weathercockDeg,
  type RailExit,
} from '../../../src/services/tools/railExit';

/** 10 N for a second, burning no mass, so the rail run has a closed form. */
const STEADY = { times: [0, 1], thrusts: [10, 10], masses: [0.02, 0.02] };

describe('railExit', () => {
  it('matches constant acceleration for a steady motor', () => {
    const r = railExit({ motor: STEADY, dryMassKg: 0.08, railLengthM: 1 }) as RailExit;
    const a = 10 / 0.1 - G0;
    expect(r.liftoffMassKg).toBeCloseTo(0.1, 9);
    expect(r.exitSpeedMs).toBeCloseTo(Math.sqrt(2 * a * 1), 1);
    expect(r.exitS).toBeCloseTo(Math.sqrt(2 / a), 2);
    expect(r.thrustToWeightAverage).toBeCloseTo(10 / (0.1 * G0), 6);
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
