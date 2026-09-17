import { describe, it, expect } from 'vitest';
import type { ComponentNode, RocketTree } from '../engine/openRocketEngine';
import {
  axialLength,
  freeformPoints,
  freeformRootChord,
  normalizeFreeformPoints,
  startFromPosition,
  resolveFilePositions,
} from './position';

describe('axialLength', () => {
  it('uses the furthest point x for a freeform fin set', () => {
    const fin = {
      type: 'freeformfinset',
      points: [
        [0, 0],
        [0.03, 0.02],
        [0.06, 0],
      ],
    } as unknown as ComponentNode;
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
  const pLen = 0.2,
    cLen = 0.05;
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

describe('resolveFilePositions', () => {
  it('rewrites an absolute child into the equivalent parent-relative top offset', () => {
    const tree: RocketTree = {
      components: [
        {
          id: 's1',
          type: 'stage',
          children: [
            { id: 'nc', type: 'nosecone', length: 0.1 },
            {
              id: 'bt',
              type: 'bodytube',
              length: 0.2,
              children: [{ id: 'it', type: 'innertube', length: 0.05, position: { method: 'absolute', offset: 0.15 } }],
            },
          ],
        },
      ],
    };
    const out = resolveFilePositions(tree);
    const it = out.components[0]!.children![1]!.children![0]!;
    // bodytube starts at x=0.1 (after the 0.1 nose), so 0.15 absolute ⇒ 0.05 from the tube's fore edge
    expect(it.position!.method).toBe('top');
    expect(it.position!.offset).toBeCloseTo(0.05);
  });

  it('returns the same tree object when there is nothing absolute to fix', () => {
    const tree: RocketTree = {
      components: [
        {
          id: 's1',
          type: 'stage',
          children: [
            {
              id: 'bt',
              type: 'bodytube',
              length: 0.2,
              children: [{ id: 'it', type: 'innertube', length: 0.05, position: { method: 'top', offset: 0.02 } }],
            },
          ],
        },
      ],
    };
    expect(resolveFilePositions(tree)).toBe(tree);
  });
});

describe('freeformRootChord', () => {
  // The kernel's definition: FreeformFinSet.length = last.x - first.x. Four
  // other modules used to compute this as Math.max(...xs), which is the same
  // number ONLY when the aftmost point is also the root trailing corner.
  it('is the span between the first and last points, not the aftmost point', () => {
    // A swept fin whose tip trailing corner overhangs the root: root chord
    // 0.06, but the furthest-aft point is 0.09.
    const overhanging: [number, number][] = [
      [0, 0],
      [0.04, 0.05],
      [0.09, 0.05],
      [0.06, 0],
    ];
    expect(freeformRootChord(overhanging)).toBeCloseTo(0.06, 9);
    expect(Math.max(...overhanging.map((p) => p[0]))).toBeCloseTo(0.09, 9); // what the copies returned
  });

  it('agrees with Math.max for an ordinary fin, which is why this went unnoticed', () => {
    const plain: [number, number][] = [
      [0, 0],
      [0.02, 0.04],
      [0.05, 0.04],
      [0.07, 0],
    ];
    expect(freeformRootChord(plain)).toBeCloseTo(Math.max(...plain.map((p) => p[0])), 9);
  });

  it('falls back rather than returning a zero or negative chord', () => {
    expect(freeformRootChord(undefined)).toBe(0.05);
    expect(freeformRootChord([])).toBe(0.05);
    expect(freeformRootChord([[0.1, 0] as [number, number], [0, 0] as [number, number]])).toBe(0.05);
    expect(freeformRootChord([[Number.NaN, 0] as [number, number], [0.1, 0] as [number, number]])).toBe(0.05);
  });

  it('is what axialLength uses, so the schematic and the report agree', () => {
    const fin = {
      type: 'freeformfinset',
      points: [
        [0, 0],
        [0.04, 0.05],
        [0.09, 0.05],
        [0.06, 0],
      ],
    } as unknown as ComponentNode;
    expect(axialLength(fin)).toBeCloseTo(freeformRootChord(fin['points'] as [number, number][]), 9);
  });
});

/**
 * The kernel's own invariant. `FreeformFinSet.setPoints()` — the entry point
 * our bridge uses (ComponentFactory.java:211) — does
 *
 *     final CoordinateIF delta = newPoints.get(0).multiply(-1);
 *     if (IGNORE_SMALLER_THAN < delta.length2()) newPoints = translatePoints(newPoints, delta);
 *
 * so the engine always flies an outline whose first point is the origin. The
 * app read the RAW points while placing the through-the-wall tab in
 * root-relative coordinates, and the two agree only when points[0].x === 0.
 */
describe('normalizeFreeformPoints', () => {
  it('leaves an outline that already starts at the origin untouched', () => {
    const pts: [number, number][] = [
      [0, 0],
      [0.02, 0.03],
      [0.06, 0],
    ];
    expect(normalizeFreeformPoints(pts)).toBe(pts); // same reference: no copy, no drift
  });

  it('translates by -p0 in BOTH axes, as the kernel does', () => {
    expect(
      normalizeFreeformPoints([
        [0.02, 0.01],
        [0.04, 0.04],
        [0.08, 0.01],
      ]),
    ).toEqual([
      [0, 0],
      [expect.closeTo(0.02, 12), expect.closeTo(0.03, 12)],
      [expect.closeTo(0.06, 12), 0],
    ]);
  });

  it('preserves the root chord, which is already translation-invariant', () => {
    const moved: [number, number][] = [
      [0.02, 0],
      [0.04, 0.03],
      [0.08, 0],
    ];
    expect(freeformRootChord(moved)).toBeCloseTo(0.06, 12);
    expect(freeformRootChord(normalizeFreeformPoints(moved))).toBeCloseTo(0.06, 12);
  });

  it('survives an empty or malformed outline', () => {
    expect(normalizeFreeformPoints(undefined)).toEqual([]);
    expect(normalizeFreeformPoints([])).toEqual([]);
    expect(normalizeFreeformPoints([[NaN, 0] as [number, number]])).toEqual([[NaN, 0]]);
  });

  it('reads only freeform nodes through the node accessor', () => {
    const got = freeformPoints({
      type: 'freeformfinset',
      points: [
        [0.02, 0],
        [0.05, 0.02],
        [0.08, 0],
      ],
    } as never);
    // Element-wise: the subtraction is exact in decimal but not in binary.
    expect(got.map(([x]) => x)).toEqual([expect.closeTo(0, 12), expect.closeTo(0.03, 12), expect.closeTo(0.06, 12)]);
    expect(got.map(([, y]) => y)).toEqual([0, 0.02, 0]);
    expect(freeformPoints({ type: 'trapezoidfinset', points: [[1, 1]] } as never)).toEqual([]);
  });
});

/**
 * AxialMethod.AFTER — the method the importer used to throw away.
 *
 * `orkImport` allowed only top/middle/bottom/absolute, so `method="after"`
 * returned undefined and the part lost its position entirely, defaulting to the
 * parent's top. A coupler seated after an inner tube jumped to the front of the
 * body tube.
 *
 * The kernel's meaning (RocketComponent.setAfter:1459-1491): start at the aft
 * end of the previous sibling, offset forced to 0. NOT the `outerLength +
 * offset` the AxialMethod enum's own getAsPosition suggests — setAfter returns
 * before that code is reached.
 */
describe('resolveFilePositions: after', () => {
  const tree = (): RocketTree =>
    ({
      components: [
        {
          id: 's1',
          type: 'stage',
          children: [
            {
              id: 'body',
              type: 'bodytube',
              length: 0.4,
              children: [
                { id: 'a', type: 'innertube', length: 0.07, position: { method: 'top', offset: 0.05 } },
                { id: 'b', type: 'tubecoupler', length: 0.03, position: { method: 'after', offset: 0 } },
                { id: 'c', type: 'engineblock', length: 0.005, position: { method: 'after', offset: 0 } },
              ],
            },
          ],
        },
      ],
    }) as unknown as RocketTree;

  const kids = (t: RocketTree) => t.components[0]!.children![0]!.children!;

  it('seats an after-positioned part at the previous sibling’s aft end', () => {
    const out = kids(resolveFilePositions(tree()));
    // 'a' runs 0.05 → 0.12, so 'b' starts at 0.12 — not at 0, which is where
    // the dropped position left it.
    const p = out[1]!.position as { method: string; offset: number };
    expect(p.method).toBe('top');
    expect(p.offset).toBeCloseTo(0.12, 9);
  });

  it('chains, so a second after-part follows the first', () => {
    const out = kids(resolveFilePositions(tree()));
    expect((out[2]!.position as { offset: number }).offset).toBeCloseTo(0.15, 9); // 0.12 + 0.03
  });

  it('starts a FIRST child at the parent’s top, as setAfter does', () => {
    const t = tree();
    t.components[0]!.children![0]!.children![0]!.position = { method: 'after', offset: 0 };
    const out = kids(resolveFilePositions(t));
    expect(out[0]!.position).toMatchObject({ method: 'top', offset: 0 });
  });

  it('keeps what the file said, so the .ork round-trip stays byte-stable', () => {
    const p = kids(resolveFilePositions(tree()))[1]!.position as {
      offset: number;
      ork?: { method: string; resolved: number };
    };
    expect(p.ork!.method).toBe('after');
    // Compared with === at export time, so it must be the SAME value.
    expect(p.ork!.resolved).toBe(p.offset);
  });

  it('ignores a stored offset, because the kernel forces it to zero', () => {
    const t = tree();
    (t.components[0]!.children![0]!.children![1]!.position as { offset: number }).offset = 0.9;
    expect((kids(resolveFilePositions(t))[1]!.position as { offset: number }).offset).toBeCloseTo(0.12, 9);
  });
});
