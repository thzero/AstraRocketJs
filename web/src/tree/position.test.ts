import { describe, it, expect } from 'vitest';
import type { ComponentNode, RocketTree } from '../engine/openRocketEngine';
import {
  axialLength, startFromPosition, offsetForStart,
  resolveAbsolutePositions, anchorStarts, snapStart,
} from './position';

describe('axialLength', () => {
  it('uses the furthest point x for a freeform fin set', () => {
    const fin = { type: 'freeformfinset', points: [[0, 0], [0.03, 0.02], [0.06, 0]] } as unknown as ComponentNode;
    expect(axialLength(fin)).toBeCloseTo(0.06);
  });

  it('falls back to a default span for an empty freeform fin set', () => {
    expect(axialLength({ type: 'freeformfinset' })).toBeCloseTo(0.05);
  });

  it('uses root chord for trapezoid / elliptical fins', () => {
    expect(axialLength({ type: 'trapezoidfinset', rootChord: 0.07 })).toBeCloseTo(0.07);
    expect(axialLength({ type: 'ellipticalfinset' })).toBeCloseTo(0.05); // default
  });

  it('uses length, then packedLength, then a default for other parts', () => {
    expect(axialLength({ type: 'bodytube', length: 0.1 })).toBeCloseTo(0.1);
    expect(axialLength({ type: 'parachute', packedLength: 0.3 })).toBeCloseTo(0.3);
    expect(axialLength({ type: 'bulkhead' })).toBeCloseTo(0.025);
  });

  it('uses the chain length for an assembly', () => {
    const podset = { type: 'podset', children: [{ type: 'bodytube', length: 0.08 }] } as ComponentNode;
    expect(axialLength(podset)).toBeCloseTo(0.08);
  });
});

describe('startFromPosition', () => {
  const pLen = 0.2, cLen = 0.05;
  it('top / absolute are the offset itself', () => {
    expect(startFromPosition({ method: 'top', offset: 0.02 }, cLen, pLen)).toBeCloseTo(0.02);
    expect(startFromPosition({ method: 'absolute', offset: 0.02 }, cLen, pLen)).toBeCloseTo(0.02);
  });
  it('middle centers the child then adds the offset', () => {
    expect(startFromPosition({ method: 'middle', offset: 0 }, cLen, pLen)).toBeCloseTo(0.075);
  });
  it('bottom aligns the trailing edges then adds the offset', () => {
    expect(startFromPosition({ method: 'bottom', offset: 0 }, cLen, pLen)).toBeCloseTo(0.15);
  });
});

describe('offsetForStart', () => {
  const pLen = 0.2, cLen = 0.05;
  it('inverts startFromPosition for every method', () => {
    for (const method of ['top', 'middle', 'bottom', 'absolute'] as const) {
      const start = startFromPosition({ method, offset: 0.013 }, cLen, pLen);
      expect(offsetForStart(method, start, cLen, pLen)).toBeCloseTo(0.013);
    }
  });
});

describe('resolveAbsolutePositions', () => {
  it('rewrites an absolute child into the equivalent parent-relative top offset', () => {
    const tree: RocketTree = {
      components: [{
        id: 's1', type: 'stage', children: [
          { id: 'nc', type: 'nosecone', length: 0.1 },
          {
            id: 'bt', type: 'bodytube', length: 0.2, children: [
              { id: 'it', type: 'innertube', length: 0.05, position: { method: 'absolute', offset: 0.15 } },
            ],
          },
        ],
      }],
    };
    const out = resolveAbsolutePositions(tree);
    const it = out.components[0].children![1].children![0];
    // bodytube starts at x=0.1 (after the 0.1 nose), so 0.15 absolute ⇒ 0.05 from the tube's fore edge
    expect(it.position!.method).toBe('top');
    expect(it.position!.offset).toBeCloseTo(0.05);
  });

  it('returns the same tree object when there is nothing absolute to fix', () => {
    const tree: RocketTree = {
      components: [{
        id: 's1', type: 'stage', children: [
          { id: 'bt', type: 'bodytube', length: 0.2, children: [
            { id: 'it', type: 'innertube', length: 0.05, position: { method: 'top', offset: 0.02 } },
          ] },
        ],
      }],
    };
    expect(resolveAbsolutePositions(tree)).toBe(tree);
  });
});

describe('anchorStarts', () => {
  const child: ComponentNode = { id: 'c', type: 'innertube', length: 0.05 };

  it('offers the parent ends and middle with no siblings', () => {
    const parent: ComponentNode = { type: 'bodytube', length: 0.2, children: [child] };
    const a = anchorStarts(parent, child);
    expect(a).toHaveLength(3);
    expect(a[0]).toBeCloseTo(0);       // leading edge
    expect(a[1]).toBeCloseTo(0.075);   // centered
    expect(a[2]).toBeCloseTo(0.15);    // trailing edge
  });

  it('adds sibling alignment and butt anchors', () => {
    const sib: ComponentNode = { id: 'sib', type: 'innertube', length: 0.04, position: { method: 'top', offset: 0.1 } };
    const parent: ComponentNode = { type: 'bodytube', length: 0.2, children: [child, sib] };
    const a = anchorStarts(parent, child);
    const has = (v: number) => a.some((x) => Math.abs(x - v) < 1e-9);
    expect(has(0.05)).toBe(true);  // butt in front of the sibling (0.1 − 0.05)
    expect(has(0.1)).toBe(true);   // align leading edges
    expect(has(0.14)).toBe(true);  // butt behind the sibling (0.1 + 0.04)
    expect(a).toEqual([...a].sort((p, q) => p - q)); // sorted
  });
});

describe('snapStart', () => {
  const anchors = [0, 0.1, 0.2];
  it('snaps to the nearest anchor within epsilon', () => {
    expect(snapStart(0.101, anchors, 0.01)).toBeCloseTo(0.1);
  });
  it('leaves the value unchanged when nothing is within epsilon', () => {
    expect(snapStart(0.15, anchors, 0.01)).toBeCloseTo(0.15);
  });
  it('picks the closest of several in-range anchors', () => {
    expect(snapStart(0.08, anchors, 0.05)).toBeCloseTo(0.1); // 0.02 to 0.1 beats 0.08 to 0
  });
});
