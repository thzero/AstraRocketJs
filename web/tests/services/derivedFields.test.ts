import { describe, expect, it } from 'vitest';
import type { ComponentNode } from '../../src/engine/openRocketEngine';
import { DERIVED, MAX_SWEEP_ANGLE } from '../../src/services/derivedFields';

/**
 * The second doors onto stored numbers. Each pair is checked for the round trip
 * (read what write put there) and for the edge the kernel handles specially,
 * because all of those edges are reachable by typing.
 */

const node = (o: Record<string, unknown>): ComponentNode => o as unknown as ComponentNode;
const deg = (d: number) => (d * Math.PI) / 180;

describe('a trapezoid fin sweep, as an angle', () => {
  const fin = (sweep: number, height: number) => node({ type: 'trapezoidfinset', sweep, height });

  it('is measured off the span, so a 45 degree sweep is one span back', () => {
    expect(DERIVED.sweepAngle.read(fin(0.03, 0.03))).toBeCloseTo(deg(45), 9);
    expect(DERIVED.sweepAngle.read(fin(0, 0.03))).toBe(0);
  });

  it('goes negative for a forward sweep', () => {
    expect(DERIVED.sweepAngle.read(fin(-0.03, 0.03))).toBeCloseTo(deg(-45), 9);
    expect(DERIVED.sweepAngle.write(fin(0, 0.05), deg(-30))['sweep']).toBeCloseTo(-0.05 * Math.tan(deg(30)), 9);
  });

  it('round-trips through the sweep length', () => {
    for (const d of [-80, -45, -5, 0, 5, 30, 60, 88]) {
      const patch = DERIVED.sweepAngle.write(fin(0, 0.04), deg(d));
      expect(DERIVED.sweepAngle.read(fin(patch['sweep'] as number, 0.04))).toBeCloseTo(deg(d), 9);
    }
  });

  it('clamps at 89 degrees rather than letting the tangent run away', () => {
    const at89 = 0.04 * Math.tan(MAX_SWEEP_ANGLE);
    expect(DERIVED.sweepAngle.write(fin(0, 0.04), deg(89.9))['sweep']).toBeCloseTo(at89, 9);
    expect(DERIVED.sweepAngle.write(fin(0, 0.04), deg(-120))['sweep']).toBeCloseTo(-at89, 9);
  });

  it('reads a right angle off a fin with no height, and writing one is a no-op', () => {
    // atan2(x, 0) would be the answer anyway; what matters is that a ZERO
    // sweep on a zero-height fin reads 0 and not a right angle.
    expect(DERIVED.sweepAngle.read(fin(0.02, 0))).toBeCloseTo(Math.PI / 2, 9);
    expect(DERIVED.sweepAngle.read(fin(-0.02, 0))).toBeCloseTo(-Math.PI / 2, 9);
    expect(DERIVED.sweepAngle.read(fin(0, 0))).toBe(0);
    expect(DERIVED.sweepAngle.write(fin(0.02, 0), deg(45))).toEqual({ sweep: 0 });
  });
});

describe('a streamer, by area and aspect ratio', () => {
  const strip = (stripLength: number, stripWidth: number) => node({ type: 'streamer', stripLength, stripWidth });

  it('reads the strip as it is cut', () => {
    expect(DERIVED.stripArea.read(strip(0.5, 0.05))).toBeCloseTo(0.025, 12);
    expect(DERIVED.stripAspect.read(strip(0.5, 0.05))).toBeCloseTo(10, 9);
  });

  it('keeps the aspect ratio when the area changes', () => {
    const patch = DERIVED.stripArea.write(strip(0.5, 0.05), 0.05);
    expect(DERIVED.stripArea.read(node({ ...patch }))).toBeCloseTo(0.05, 12);
    expect(DERIVED.stripAspect.read(node({ ...patch }))).toBeCloseTo(10, 9);
  });

  it('keeps the area when the aspect ratio changes', () => {
    const patch = DERIVED.stripAspect.write(strip(0.5, 0.05), 20);
    expect(DERIVED.stripAspect.read(node({ ...patch }))).toBeCloseTo(20, 9);
    expect(DERIVED.stripArea.read(node({ ...patch }))).toBeCloseTo(0.025, 12);
  });

  it('floors the ratio instead of dividing by something near zero', () => {
    const patch = DERIVED.stripAspect.write(strip(0.5, 0.05), 0);
    // 0.01, upstream's floor: a strip a hundred times wider than it is long.
    expect(DERIVED.stripAspect.read(node({ ...patch }))).toBeCloseTo(0.01, 9);
    expect(Number.isFinite(patch['stripWidth'] as number)).toBe(true);
  });

  it('reports 1000 for a strip with no width, the way the kernel does', () => {
    expect(DERIVED.stripAspect.read(strip(0.5, 0))).toBe(1000);
    expect(DERIVED.stripAspect.read(strip(0.5, 0.00005))).toBe(1000);
  });

  it('refuses a negative area rather than writing a NaN width', () => {
    // Math.sqrt of a negative is NaN, and a NaN width would reach the mass, the
    // mesh and the .ork, none of which check for one. Clamped to zero here.
    expect(DERIVED.stripArea.write(strip(0.5, 0.05), -1)).toEqual({ stripWidth: 0, stripLength: 0 });
  });
});

describe('a mass component, by density', () => {
  const lump = (mass: number, radius: number, length: number) => node({ type: 'masscomponent', mass, radius, length });

  it('spreads the mass through the packed cylinder', () => {
    const volume = Math.PI * 0.01 ** 2 * 0.02;
    expect(DERIVED.massDensity.read(lump(volume * 1200, 0.01, 0.02))).toBeCloseTo(1200, 6);
  });

  it('round-trips', () => {
    const patch = DERIVED.massDensity.write(lump(0, 0.012, 0.03), 800);
    expect(DERIVED.massDensity.read(node({ ...lump(0, 0.012, 0.03), ...patch }))).toBeCloseTo(800, 6);
  });

  it('reads zero for a part with no packed volume, not a NaN', () => {
    expect(DERIVED.massDensity.read(lump(0.02, 0, 0.02))).toBe(0);
    expect(DERIVED.massDensity.read(lump(0.02, 0.01, 0))).toBe(0);
  });

  it('writes a zero mass for a part with no packed volume', () => {
    // Density times nothing is nothing, which is what the kernel computes too.
    expect(DERIVED.massDensity.write(lump(0.02, 0, 0.02), 1200)).toEqual({ mass: 0 });
  });

  it('clamps an absurd density rather than carrying a tonne into the sim', () => {
    expect(DERIVED.massDensity.write(lump(0, 0.05, 0.5), 1e12)['mass']).toBe(1_000_000);
    expect(DERIVED.massDensity.write(lump(0, 0.05, 0.5), -5)['mass']).toBe(0);
  });
});

describe('a motor cluster, by the gap between its tubes', () => {
  // 19 mm tubes, the kernel's own default inner tube.
  const cluster = (clusterScale: number) =>
    node({ type: 'innertube', cluster: 'double', outerRadius: 0.0095, clusterScale });

  it('reads a scale of 1 as tubes touching', () => {
    expect(DERIVED.clusterSeparation.read(cluster(1))).toBeCloseTo(0, 12);
  });

  it('reads the gap as a multiple of the tube diameter', () => {
    // 1.5 is half a diameter of air between neighbors: 9.5 mm.
    expect(DERIVED.clusterSeparation.read(cluster(1.5))).toBeCloseTo(0.0095, 12);
    expect(DERIVED.clusterSeparation.read(cluster(0.5))).toBeCloseTo(-0.0095, 12);
  });

  it('round-trips through the stored scale', () => {
    for (const gap of [-0.015, -0.005, 0, 0.003, 0.02]) {
      const patch = DERIVED.clusterSeparation.write(cluster(1), gap);
      expect(DERIVED.clusterSeparation.read(node({ ...cluster(1), ...patch }))).toBeCloseTo(gap, 12);
    }
  });

  it('stops at tubes exactly concentric rather than turning the scale negative', () => {
    // One whole diameter in is scale 0, which is where the kernel clamps.
    expect(DERIVED.clusterSeparation.write(cluster(1), -0.05)).toEqual({ clusterScale: 0 });
  });

  it('refuses the edit on a tube with no diameter, rather than dividing by zero', () => {
    expect(DERIVED.clusterSeparation.write(node({ type: 'innertube', outerRadius: 0, clusterScale: 1 }), 0.01)).toEqual(
      {},
    );
  });
});
