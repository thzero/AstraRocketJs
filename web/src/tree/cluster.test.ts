import { describe, it, expect } from 'vitest';
import { CLUSTER_POINTS, CLUSTER_OPTIONS, clusterCount, clusterOffsets, isClusterPattern } from './cluster';

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

  it('offers every pattern as a dropdown option, in kernel order', () => {
    // The property panel renders these verbatim as <option value>, so the list
    // must be the pattern NAMES and must not drift from CLUSTER_POINTS.
    expect(CLUSTER_OPTIONS).toEqual(Object.keys(CLUSTER_POINTS));
    expect(CLUSTER_OPTIONS[0]).toBe('single');
    expect(CLUSTER_OPTIONS.every((n) => clusterCount(n) >= 1)).toBe(true);
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
    expect(out[0]!.y).toBeCloseTo(-0.01);
    expect(out[0]!.z).toBeCloseTo(0);
    expect(out[1]!.y).toBeCloseTo(0.01);
    expect(out[1]!.z).toBeCloseTo(0);
  });

  it('applies clusterScale to the separation', () => {
    const out = clusterOffsets('double', 0.01, 2, 0); // separation 0.04
    expect(out[1]!.y).toBeCloseTo(0.02);
  });

  it('rotates the layout the way the kernel rotates it', () => {
    // double rotated 90° swings the pair onto the z axis. The kernel applies
    // R(−θ), so the point (−0.5, 0) goes to (0, +0.5) — +z, not −z. This test
    // asserted −z, which is what let the app draw every rotated cluster mirrored
    // against the arrangement the kernel was flying.
    const out = clusterOffsets('double', 0.01, 1, Math.PI / 2);
    expect(out[0]!.y).toBeCloseTo(0);
    expect(out[0]!.z).toBeCloseTo(0.01);
    expect(out[1]!.y).toBeCloseTo(0);
    expect(out[1]!.z).toBeCloseTo(-0.01);
  });

  /**
   * …and it stays that way. This transcribes ClusterConfiguration.getPoints
   * (ClusterConfiguration.java:108-119) independently rather than re-running
   * clusterOffsets, so a sign that drifts back fails for every pattern at once
   * instead of only in whichever single case someone remembered to pin.
   */
  it('matches ClusterConfiguration.getPoints for every pattern and rotation', () => {
    const kernelPoints = (pts: number[], rotation: number) => {
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const out: { y: number; z: number }[] = [];
      for (let i = 0; i < pts.length; i += 2) {
        const x = pts[i]!;
        const y = pts[i + 1]!;
        out.push({ y: x * cos + y * sin, z: -x * sin + y * cos });
      }
      return out;
    };

    const r = 0.0095;
    const scale = 1.3;
    const separation = 2 * r * scale;
    for (const [name, pts] of Object.entries(CLUSTER_POINTS)) {
      for (const deg of [0, 30, 45, 90, 137, -60]) {
        const rot = (deg * Math.PI) / 180;
        const got = clusterOffsets(name, r, scale, rot);
        const want = kernelPoints(pts, rot);
        expect(got, `${name} @ ${deg}°`).toHaveLength(want.length);
        want.forEach((w, i) => {
          expect(got[i]!.y, `${name} @ ${deg}° [${i}].y`).toBeCloseTo(w.y * separation, 12);
          expect(got[i]!.z, `${name} @ ${deg}° [${i}].z`).toBeCloseTo(w.z * separation, 12);
        });
      }
    }
  });

  it('falls back to a single on-axis tube for an unknown pattern', () => {
    expect(clusterOffsets('nonsense', 0.01)).toEqual([{ y: 0, z: 0 }]);
  });
});

describe('isClusterPattern', () => {
  it('accepts every option and rejects anything else', () => {
    for (const o of CLUSTER_OPTIONS) expect(isClusterPattern(o), o).toBe(true);
    expect(isClusterPattern('7-ring')).toBe(false);
    expect(isClusterPattern('toString')).toBe(false); // not via the prototype chain
    expect(isClusterPattern(undefined)).toBe(false);
  });
  it('an unknown pattern lays out as a single tube everywhere it is read', () => {
    expect(clusterCount('7-ring')).toBe(1);
    expect(clusterOffsets('7-ring', 0.01)).toEqual([{ y: 0, z: 0 }]);
  });
});
