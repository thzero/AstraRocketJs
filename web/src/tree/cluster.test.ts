import { describe, it, expect } from 'vitest';
import { CLUSTER_POINTS, CLUSTER_OPTIONS, clusterCount, clusterOffsets } from './cluster';

describe('clusterCount', () => {
  it('defaults an absent cluster to a single motor', () => {
    expect(clusterCount(undefined)).toBe(1);
  });

  it('counts the point pairs of a known pattern', () => {
    expect(clusterCount('double')).toBe(2);
    expect(clusterCount('9-grid')).toBe(9);
  });

  it('treats an unknown pattern as single', () => {
    expect(clusterCount('nonsense')).toBe(1);
  });
});

describe('CLUSTER_POINTS / CLUSTER_OPTIONS', () => {
  it('every pattern is a flat list of [x, y] pairs', () => {
    for (const [name, pts] of Object.entries(CLUSTER_POINTS)) {
      expect(pts.length % 2, `${name} should have an even point count`).toBe(0);
    }
  });

  it('labels single plainly and the rest with their motor counts', () => {
    const opts = Object.fromEntries(CLUSTER_OPTIONS);
    expect(opts.single).toBe('Single');
    expect(opts.double).toBe('double (2 motors)');
    expect(opts['9-grid']).toBe('9-grid (9 motors)');
  });
});

describe('clusterOffsets', () => {
  it('single sits on the axis', () => {
    expect(clusterOffsets('single', 0.01)).toEqual([{ y: 0, z: 0 }]);
  });

  it('spaces tubes by 2·radius·scale in the cross-section plane', () => {
    // double, R=0.01, scale 1 ⇒ separation 0.02; points −0.5 and +0.5
    const out = clusterOffsets('double', 0.01, 1, 0);
    expect(out).toHaveLength(2);
    expect(out[0].y).toBeCloseTo(-0.01);
    expect(out[0].z).toBeCloseTo(0);
    expect(out[1].y).toBeCloseTo(0.01);
    expect(out[1].z).toBeCloseTo(0);
  });

  it('applies clusterScale to the separation', () => {
    const out = clusterOffsets('double', 0.01, 2, 0); // separation 0.04
    expect(out[1].y).toBeCloseTo(0.02);
  });

  it('rotates the layout by clusterRotation', () => {
    // double rotated 90° swings the pair onto the z axis
    const out = clusterOffsets('double', 0.01, 1, Math.PI / 2);
    expect(out[0].y).toBeCloseTo(0);
    expect(out[0].z).toBeCloseTo(-0.01);
    expect(out[1].y).toBeCloseTo(0);
    expect(out[1].z).toBeCloseTo(0.01);
  });

  it('falls back to a single on-axis tube for an unknown pattern', () => {
    expect(clusterOffsets('nonsense', 0.01)).toEqual([{ y: 0, z: 0 }]);
  });
});
