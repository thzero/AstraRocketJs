import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { ComponentNode } from '../../src/engine/openRocketEngine';
import { KERNEL_DEFAULTS } from '../../src/tree/kernelDefaults';
import {
  assemblyChainLength,
  assemblyBoundingRadius,
  resolveAssemblyRadius,
  ringInstanceOffsets,
  isAssembly,
} from '../../src/tree/assembly';

const JAVA_ROOT = fileURLToPath(
  new URL('../../../engine-java/src/java/info/openrocket/core/rocketcomponent/', import.meta.url),
);
/** Java source with runs of whitespace collapsed, so the guards survive reformatting. */
const javaSource = (file: string): string => readFileSync(JAVA_ROOT + file, 'utf8').replace(/\s+/g, ' ');

const pod = (children: ComponentNode[], props: Record<string, unknown> = {}): ComponentNode => ({
  type: 'podset',
  children,
  ...props,
});

describe('assemblyChainLength', () => {
  it('sums the axial chain members and ignores internal parts', () => {
    const p = pod([
      { type: 'nosecone', length: 0.05 },
      { type: 'bodytube', length: 0.1 },
      { type: 'parachute', length: 0.3 }, // internal, not part of the chain
    ]);
    expect(assemblyChainLength(p)).toBeCloseTo(0.15);
  });

  it('is zero with no chain members', () => {
    expect(assemblyChainLength(pod([]))).toBe(0);
  });

  it('counts a member with no length at the length the bridge builds it with', () => {
    // ComponentFactory gives a body tube and a nose cone with no length their
    // constructors' (KERNEL_DEFAULTS); the pod's chain is that long in the
    // kernel, not zero.
    const p = pod([{ type: 'nosecone' }, { type: 'bodytube', length: 0.1 }]);
    expect(assemblyChainLength(p)).toBeCloseTo(KERNEL_DEFAULTS.nosecone.length + 0.1, 12);
    expect(assemblyChainLength(pod([{ type: 'bodytube' }]))).toBeCloseTo(KERNEL_DEFAULTS.bodytube.length, 12);
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

/**
 * `resolveAssemblyRadius` against `RadiusMethod.getRadius` and
 * `ComponentAssembly.getBoundingRadius`, transcribed below from the Java rather
 * than summed by hand.
 */
describe('resolveAssemblyRadius vs RadiusMethod.java', () => {
  const radiusMethod = javaSource('position/RadiusMethod.java');
  const assembly = javaSource('ComponentAssembly.java');

  it('is generated from the rules the port was written against', () => {
    // COAXIAL, FREE, RELATIVE and SURFACE, in that order.
    expect(radiusMethod).toContain('final double requestedOffset) { return 0.0; }');
    expect(radiusMethod).toContain('final double requestedOffset) { return requestedOffset; }');
    expect(radiusMethod).toContain(
      'double radius = requestedOffset; if (parentComponent instanceof BodyTube) { radius += ((BodyTube) parentComponent).getOuterRadius(); } if (thisComponent instanceof RadiusPositionable) { radius += ((RadiusPositionable) thisComponent).getBoundingRadius(); } return radius;',
    );
    expect(radiusMethod).toContain(
      'double radius = 0.0; if (parentComponent instanceof BodyTube) { radius += ((BodyTube) parentComponent).getOuterRadius(); } if (thisComponent instanceof RadiusPositionable) { radius += ((RadiusPositionable) thisComponent).getBoundingRadius(); } return radius;',
    );
    expect(assembly).toContain(
      'if (comp instanceof BodyTube) { thisRadius = ((BodyTube) comp).getOuterRadius(); } else if (comp instanceof Transition) { Transition trans = (Transition) comp; thisRadius = Math.max(trans.getForeRadius(), trans.getAftRadius()); }',
    );
  });

  /** `ComponentAssembly.getBoundingRadius`: a nose cone is a `Transition` with a zero fore radius. */
  const boundingRadius = (children: Record<string, number | string>[]): number => {
    let outerRadius = 0;
    for (const comp of children) {
      let thisRadius = 0;
      if (comp['type'] === 'bodytube') thisRadius = comp['outerRadius'] as number;
      else if (comp['type'] === 'transition')
        thisRadius = Math.max(comp['foreRadius'] as number, comp['aftRadius'] as number);
      else if (comp['type'] === 'nosecone') thisRadius = Math.max(0, comp['aftRadius'] as number);
      outerRadius = Math.max(outerRadius, thisRadius);
    }
    return outerRadius;
  };

  /** `RadiusMethod.getRadius` for a pod set (a `RadiusPositionable`) on a body tube. */
  const getRadius = (method: string, parentOuterRadius: number, bounding: number, requestedOffset: number) => {
    if (method === 'coaxial') return 0.0;
    if (method === 'free') return requestedOffset;
    if (method === 'surface') return 0.0 + parentOuterRadius + bounding;
    return requestedOffset + parentOuterRadius + bounding;
  };

  const chain: Record<string, string | number>[] = [
    { type: 'nosecone', aftRadius: 0.012 },
    { type: 'bodytube', outerRadius: 0.01 },
    { type: 'transition', foreRadius: 0.011, aftRadius: 0.009 },
  ];

  it('places a pod set by each method as the kernel does', () => {
    for (const radiusMethod of ['relative', 'surface', 'free', 'coaxial']) {
      for (const radiusOffset of [0, 0.005, 0.05]) {
        const p = pod(chain as ComponentNode[], { radiusOffset, radiusMethod });
        expect(resolveAssemblyRadius(p, 0.03), `${radiusMethod} @ ${radiusOffset}`).toBeCloseTo(
          getRadius(radiusMethod, 0.03, boundingRadius(chain), radiusOffset),
          12,
        );
      }
    }
  });

  it('reads an unset method as relative, the kernel default', () => {
    expect(javaSource('PodSet.java')).toContain('protected RadiusMethod radiusMethod = RadiusMethod.RELATIVE;');
    const p = pod(chain as ComponentNode[], { radiusOffset: 0.005 });
    expect(resolveAssemblyRadius(p, 0.03)).toBeCloseTo(getRadius('relative', 0.03, boundingRadius(chain), 0.005), 12);
  });
});

describe('ringInstanceOffsets', () => {
  it('a single instance sits at angle 0 (y = radius, z = 0)', () => {
    const out = ringInstanceOffsets(1, 0.05);
    expect(out).toHaveLength(1);
    expect(out[0]!.y).toBeCloseTo(0.05);
    expect(out[0]!.z).toBeCloseTo(0);
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
    expect(out[0]!.y).toBeCloseTo(0);
    expect(out[0]!.z).toBeCloseTo(1);
  });
});

describe('isAssembly', () => {
  it('recognizes the off-axis assembly types', () => {
    expect(isAssembly('podset')).toBe(true);
    expect(isAssembly('parallelstage')).toBe(true);
    expect(isAssembly('bodytube')).toBe(false);
  });
});
