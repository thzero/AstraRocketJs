import { describe, expect, it } from 'vitest';
import { axialFrameOf, rebasePosition, rebaseTabOffset } from '../../src/tree/axialRebase';
import type { ComponentNode, RocketTree } from '../../src/engine/openRocketEngine';

/**
 * A new position reference keeps the part where it is, as the kernel's
 * `RocketComponent.setAxialMethod` and `FinSet.setTabOffsetMethod` do.
 */
describe('rebasePosition', () => {
  const tube = { start: 0.1, length: 0.3 };

  it('moves a ring at top 20 mm to the matching bottom offset', () => {
    const p = rebasePosition({ method: 'top', offset: 0.02 }, 'bottom', 0.01, tube);
    expect(p.method).toBe('bottom');
    // Leading edge 20 mm down a 300 mm tube, 10 mm long: 270 mm short of the end.
    expect(p.offset).toBeCloseTo(-0.27, 12);
  });

  it('round-trips through every method', () => {
    const start = { method: 'top' as const, offset: 0.05 };
    let p = rebasePosition(start, 'middle', 0.02, tube);
    expect(p.offset).toBeCloseTo(0.05 + (0.02 - 0.3) / 2, 12);
    p = rebasePosition(p, 'absolute', 0.02, tube);
    // Rocket frame: the tube's own start plus the leading edge.
    expect(p.offset).toBeCloseTo(0.15, 12);
    p = rebasePosition(p, 'bottom', 0.02, tube);
    p = rebasePosition(p, 'top', 0.02, tube);
    expect(p.offset).toBeCloseTo(0.05, 12);
  });

  it('leaves an unchanged method alone', () => {
    const pos = { method: 'middle' as const, offset: 0.01 };
    expect(rebasePosition(pos, 'middle', 0.02, tube)).toBe(pos);
  });
});

describe('rebaseTabOffset', () => {
  const fin = (extra: Record<string, unknown>) =>
    ({ id: 'f', type: 'trapezoidfinset', rootChord: 0.06, tabLength: 0.02, ...extra }) as unknown as ComponentNode;

  it('reads an unset method as the middle, the kernel default', () => {
    // Centered 20 mm tab on a 60 mm root: its front edge is 20 mm from the root's front.
    const top = rebaseTabOffset(fin({ tabOffset: 0 }), 'top');
    expect(top.tabOffsetMethod).toBe('top');
    expect(top.tabOffset as number).toBeCloseTo(0.02, 12);
  });

  it('keeps the tab in place when the reference changes', () => {
    const bottom = rebaseTabOffset(fin({ tabOffsetMethod: 'top', tabOffset: 0.01 }), 'bottom');
    expect(bottom.tabOffsetMethod).toBe('bottom');
    expect(bottom.tabOffset as number).toBeCloseTo(-0.03, 12);
    const middle = rebaseTabOffset(fin({ tabOffsetMethod: 'bottom', tabOffset: -0.03 }), 'middle');
    expect(middle.tabOffset as number).toBeCloseTo(-0.01, 12);
  });

  it('reads and writes an after or absolute tab as AxialMethod does', () => {
    // AFTER: getAsPosition = outerLength + offset, getAsOffset = position - outerLength.
    // ABSOLUTE: both are the identity. outerLength is the 60 mm root.
    const fromAfter = rebaseTabOffset(fin({ tabOffsetMethod: 'after', tabOffset: 0.01 }), 'top');
    expect(fromAfter.tabOffset as number).toBeCloseTo(0.06 + 0.01, 12);
    const toAfter = rebaseTabOffset(fin({ tabOffsetMethod: 'top', tabOffset: 0.07 }), 'after');
    expect(toAfter.tabOffset as number).toBeCloseTo(0.07 - 0.06, 12);
    const toAbsolute = rebaseTabOffset(fin({ tabOffsetMethod: 'bottom', tabOffset: 0 }), 'absolute');
    expect(toAbsolute.tabOffset as number).toBeCloseTo(0 + (0.06 - 0.02), 12);
  });
});

describe('axialFrameOf', () => {
  const tree = {
    components: [
      {
        id: 's',
        type: 'stage',
        children: [
          { id: 'n', type: 'nosecone', length: 0.1 },
          {
            id: 't',
            type: 'bodytube',
            length: 0.3,
            children: [{ id: 'r', type: 'centeringring', length: 0.01, position: { method: 'bottom', offset: 0 } }],
          },
        ],
      },
    ],
  } as unknown as RocketTree;

  it('stacks the chain and places children against their parent', () => {
    expect(axialFrameOf(tree, 't')).toEqual({ start: 0.1, length: 0.3 });
    const ring = axialFrameOf(tree, 'r')!;
    expect(ring.start).toBeCloseTo(0.39, 12);
    expect(ring.length).toBeCloseTo(0.01, 12);
    expect(axialFrameOf(tree, 'nope')).toBeNull();
  });
});
