import { describe, it, expect } from 'vitest';
import { KERNEL_DEFAULTS } from '../../../src/tree/kernelDefaults';
import type { RocketTree } from '../../../src/engine/openRocketEngine';
import { fitContextFor } from '../../../src/services/parts/componentFit';
import { fitRuleFor } from '../../../src/services/parts/componentFilter';

/**
 * A two-stage rocket with a real 54 mm airframe: a 1.6 mm-walled body tube
 * (54.6 mm OD, so a 51.4 mm bore) holding a 29 mm motor mount, a centering ring
 * and a coupler, plus a 66 mm booster below, the next airframe part across the
 * stage boundary.
 *
 * Radii, because that is what the tree stores: the picker's problem is
 * that the number a coupler has to match (the bore) is not a field at all, it is
 * `outerRadius - thickness`, doubled.
 */
const makeTree = (): RocketTree =>
  ({
    components: [
      {
        id: 's1',
        type: 'stage',
        children: [
          { id: 'nose', type: 'nosecone', aftRadius: 0.0273, length: 0.15 },
          {
            id: 'tube',
            type: 'bodytube',
            outerRadius: 0.0273,
            thickness: 0.0016,
            length: 0.4,
            children: [
              { id: 'mount', type: 'innertube', outerRadius: 0.0145, length: 0.1 },
              { id: 'ring', type: 'centeringring', outerRadius: 0.0257, innerRadius: 0.0145, length: 0.003 },
              { id: 'coupler', type: 'tubecoupler', outerRadius: 0.0255, thickness: 0.0016, length: 0.08 },
              { id: 'chute', type: 'parachute', diameter: 0.45 },
            ],
          },
        ],
      },
      {
        id: 's2',
        type: 'stage',
        children: [{ id: 'booster', type: 'bodytube', outerRadius: 0.0332, thickness: 0.0016, length: 0.3 }],
      },
    ],
  }) as unknown as RocketTree;

describe('fitContextFor', () => {
  const tree = makeTree();

  it('derives the enclosing bore from the wall, which is not a stored field', () => {
    // 27.3 mm outer radius less a 1.6 mm wall, doubled: 51.4 mm of bore. This is
    // the number a coupler has to hit, and it is not a field of its own.
    expect(fitContextFor(tree, 'coupler')!.parentInner).toBeCloseTo(0.0514, 6);
    expect(fitContextFor(tree, 'ring')!.parentInner).toBeCloseTo(0.0514, 6);
  });

  it('finds the mount a centering ring has to clear beside it, not under it', () => {
    // The motor mount is the ring's sibling. Looking for it among the ring's
    // children would find nothing and silently drop the constraint.
    expect(fitContextFor(tree, 'ring')!.mountOuter).toBeCloseTo(0.029, 6);
  });

  it('matches each airframe end against the part beside it, across stages', () => {
    // The tube's fore end meets the nose cone's base and its aft end the
    // booster's fore end, in the next stage.
    const tube = fitContextFor(tree, 'tube')!;
    expect(tube.foreMatch).toBeCloseTo(0.0546, 9);
    expect(tube.aftMatch).toBeCloseTo(0.0664, 9);
    expect(fitContextFor(tree, 'nose')!.aftMatch).toBeCloseTo(0.0546, 9);
    expect(fitContextFor(tree, 'nose')!.foreMatch).toBeUndefined();
  });

  it('gives a part on a bare stage no enclosing geometry, and says so', () => {
    // A stage has no radius, so there is nothing to fit inside; the booster
    // still meets the tube ahead of it, and nothing behind it.
    const ctx = fitContextFor(tree, 'booster')!;
    expect(ctx.parentInner).toBeUndefined();
    expect(ctx.foreMatch).toBeCloseTo(0.0546, 9);
    expect(ctx.aftMatch).toBeUndefined();
  });

  it('returns nothing for an id that is not in the tree', () => {
    expect(fitContextFor(tree, 'nope')).toBeUndefined();
    expect(fitContextFor(tree, null)).toBeUndefined();
  });

  describe('feeding the filter', () => {
    it('lets a coupler be ranked against the bore it slides into', () => {
      expect(fitRuleFor('tubecoupler', fitContextFor(tree, 'coupler'))).toEqual({
        kind: 'inside',
        target: expect.closeTo(0.0514, 6) as unknown as number,
      });
    });

    it('lets a body tube be ranked against the airframe it continues', () => {
      const rule = fitRuleFor('bodytube', fitContextFor(tree, 'booster'));
      expect(rule).toEqual({ kind: 'ends', fore: expect.closeTo(0.0546, 9) as unknown as number, aft: null });
    });

    it('still abstains where the geometry cannot answer', () => {
      // A parachute inside the same tube has a bore around it, and it is still
      // the wrong question: what matters is packed volume, which is not modeled.
      expect(fitRuleFor('parachute', fitContextFor(tree, 'chute'))).toBeNull();
    });
  });

  it('ignores a wall that cannot be a wall', () => {
    // A thickness of zero, or one at least as big as the radius, is not a bore:
    // it is a bad value, and `(or - th) * 2` would hand the picker a zero or a
    // negative target to rank every part against.
    const bad = {
      components: [
        {
          id: 's1',
          type: 'stage',
          children: [
            {
              id: 'solid',
              type: 'bodytube',
              outerRadius: 0.0273,
              thickness: 0.0273,
              children: [{ id: 'x', type: 'tubecoupler' }],
            },
          ],
        },
      ],
    } as unknown as RocketTree;
    expect(fitContextFor(bad, 'x')!.parentInner).toBeUndefined();
    expect(fitRuleFor('tubecoupler', fitContextFor(bad, 'x'))).toBeNull();
  });
});

/**
 * A tube with no `thickness` key still has a bore: the one the kernel builds
 * with the type's default wall (BodyTube()'s, KERNEL_DEFAULTS). Treating it as "no
 * bore" would leave the picker nothing to rank a coupler against.
 */
describe('fitContextFor on a keyless wall', () => {
  it('derives the bore from the kernel default wall', () => {
    const tree = {
      components: [
        {
          id: 's1',
          type: 'stage',
          children: [
            { id: 'tube', type: 'bodytube', outerRadius: 0.0273, children: [{ id: 'x', type: 'tubecoupler' }] },
          ],
        },
      ],
    } as unknown as RocketTree;
    expect(fitContextFor(tree, 'x')!.parentInner).toBeCloseTo(2 * (0.0273 - KERNEL_DEFAULTS.bodytube.thickness), 9);
  });
});
