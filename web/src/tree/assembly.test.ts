import { describe, it, expect } from 'vitest';
import type { ComponentNode } from '../engine/openRocketEngine';
import {
  assemblyChainLength, assemblyBoundingRadius, resolveAssemblyRadius,
  ringInstanceOffsets, isAssembly,
} from './assembly';

const pod = (children: ComponentNode[], props: Record<string, unknown> = {}): ComponentNode =>
  ({ type: 'podset', children, ...props });

describe('assemblyChainLength', () => {
  it('sums the axial chain members and ignores internal parts', () => {
    const p = pod([
      { type: 'nosecone', length: 0.05 },
      { type: 'bodytube', length: 0.1 },
      { type: 'parachute', packedLength: 0.3 }, // internal — not part of the chain
    ]);
    expect(assemblyChainLength(p)).toBeCloseTo(0.15);
  });

  it('is zero with no chain members', () => {
    expect(assemblyChainLength(pod([]))).toBe(0);
  });
});

describe('assemblyBoundingRadius', () => {
  it('takes the largest radius across the chain (nose aft, tube outer, transition fore/aft)', () => {
    const p = pod([
      { type: 'nosecone', aftRadius: 0.012 },
      { type: 'bodytube', outerRadius: 0.01 },
      { type: 'transition', foreRadius: 0.02, aftRadius: 0.015 },
    ]);
    expect(assemblyBoundingRadius(p)).toBeCloseTo(0.02);
  });

  it('is zero for an empty assembly', () => {
    expect(assemblyBoundingRadius(pod([]))).toBe(0);
  });
});

describe('resolveAssemblyRadius', () => {
  const p = pod([{ type: 'bodytube', outerRadius: 0.01 }], { radiusOffset: 0.005 });

  it('relative (default): offset is a gap from the parent surface', () => {
    // 0.005 gap + 0.03 parent radius + 0.01 pod bounding radius
    expect(resolveAssemblyRadius(p, 0.03)).toBeCloseTo(0.045);
  });

  it('relative offset 0 just touches the airframe', () => {
    const touching = pod([{ type: 'bodytube', outerRadius: 0.01 }], { radiusOffset: 0 });
    expect(resolveAssemblyRadius(touching, 0.03)).toBeCloseTo(0.04);
  });

  it('free: offset is measured straight from the parent centerline', () => {
    const free = pod([{ type: 'bodytube', outerRadius: 0.01 }], { radiusOffset: 0.05, radiusMethod: 'free' });
    expect(resolveAssemblyRadius(free, 0.03)).toBeCloseTo(0.05);
  });
});

describe('ringInstanceOffsets', () => {
  it('a single instance sits at angle 0 (y = radius, z = 0)', () => {
    const out = ringInstanceOffsets(1, 0.05);
    expect(out).toHaveLength(1);
    expect(out[0].y).toBeCloseTo(0.05);
    expect(out[0].z).toBeCloseTo(0);
  });

  it('spaces N instances evenly around the axis (y = r·cosθ, z = r·sinθ)', () => {
    const out = ringInstanceOffsets(4, 1);
    expect(out.map((o) => o.y)).toEqual([1, 0, -1, 0].map((n) => expect.closeTo(n)));
    expect(out.map((o) => o.z)).toEqual([0, 1, 0, -1].map((n) => expect.closeTo(n)));
  });

  it('clamps the count to at least 1 and rounds fractional counts', () => {
    expect(ringInstanceOffsets(0, 1)).toHaveLength(1);
    expect(ringInstanceOffsets(2.4, 1)).toHaveLength(2);
  });

  it('applies the angle offset', () => {
    const out = ringInstanceOffsets(1, 1, Math.PI / 2);
    expect(out[0].y).toBeCloseTo(0);
    expect(out[0].z).toBeCloseTo(1);
  });
});

describe('isAssembly', () => {
  it('recognizes the off-axis assembly types', () => {
    expect(isAssembly('podset')).toBe(true);
    expect(isAssembly('parallelstage')).toBe(true);
    expect(isAssembly('bodytube')).toBe(false);
  });
});
