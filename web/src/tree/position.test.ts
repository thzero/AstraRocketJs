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
import { KERNEL_DEFAULTS } from './kernelDefaults';

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

  it('uses length, then a default, for other parts', () => {
    expect(axialLength({ type: 'bodytube', length: 0.1 })).toBeCloseTo(0.1);
    // A recovery device's PACKED length is what `length` holds — orkImport
    // reads <packedlength> into it. There is no separate `packedLength` key to
    // fall back to, and the fallback that used to be here never fired.
    expect(axialLength({ type: 'parachute', length: 0.3 })).toBeCloseTo(0.3);
    // The fallback is the KERNEL's per-type length, not 0.025 for every type
    // (that is the parachute / streamer / shock-cord value; a bulkhead flies
    // at 2 mm). Each value is what ComponentFactory reads, pinned by
    // kernelDefaults.kernel.test.ts against the real engine.
    expect(axialLength({ type: 'bulkhead' })).toBeCloseTo(KERNEL_DEFAULTS.bulkhead.length);
    expect(axialLength({ type: 'bulkhead' })).toBeCloseTo(0.002);
    expect(axialLength({ type: 'centeringring' })).toBeCloseTo(0.002);
    expect(axialLength({ type: 'engineblock' })).toBeCloseTo(0.005);
    expect(axialLength({ type: 'innertube' })).toBeCloseTo(0.07);
    expect(axialLength({ type: 'tubecoupler' })).toBeCloseTo(0.05);
    expect(axialLength({ type: 'launchlug' })).toBeCloseTo(0.05);
    expect(axialLength({ type: 'masscomponent' })).toBeCloseTo(0.02);
    expect(axialLength({ type: 'tubefinset' })).toBeCloseTo(0.1);
    expect(axialLength({ type: 'parachute' })).toBeCloseTo(0.025);
    expect(axialLength({ type: 'streamer' })).toBeCloseTo(0.025);
    expect(axialLength({ type: 'shockcord' })).toBeCloseTo(0.025);
    // No factory default at all: the kernel's RocketComponent.length is 0.
    expect(axialLength({ type: 'railbutton' })).toBe(0);
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

  it('walks an off-axis assembly with its OWN length and start, not zero and the chain total', () => {
    // A podset hangs beside the airframe: it consumes no chain length, but it
    // has its own 0.2 m body and sits 0.1 m down the stage. Its children must
    // be resolved against THAT, not against a parent length of 0 (which put a
    // `middle` child forward of the pod's own nose) and not against the core
    // chain's running total.
    const tree: RocketTree = {
      components: [
        {
          type: 'stage',
          id: 's',
          children: [
            { type: 'nosecone', id: 'n', length: 0.1, aftRadius: 0.012 },
            { type: 'bodytube', id: 'b', length: 0.4, outerRadius: 0.012 },
            {
              type: 'podset',
              id: 'p',
              radiusOffset: 0.03,
              position: { method: 'top', offset: 0.1 },
              children: [
                { type: 'bodytube', id: 'pb', length: 0.2, outerRadius: 0.008 },
                {
                  type: 'masscomponent',
                  id: 'pm',
                  length: 0.02,
                  position: { method: 'absolute', offset: 0.22 },
                },
              ],
            },
          ],
        },
      ],
    } as unknown as RocketTree;

    const pod = resolveFilePositions(tree).components[0]!.children![2]!;
    const mass = pod.children![1]!;
    // The pod's own start is 0.1 (its position against the stage), so an
    // absolute station of 0.22 is 0.12 from the pod's fore edge. Under the old
    // walk pStart was the chain total (0.5 by the time the pod was reached),
    // which rebased it to -0.28: ahead of the rocket's own nose.
    expect(mass.position!.method).toBe('top');
    expect(mass.position!.offset).toBeCloseTo(0.12);
  });

  it('gives a middle-positioned child inside a pod a station inside the pod', () => {
    // The symptom that started this: parent length 0 made `middle` resolve to
    // -childLen/2, so an `after` sibling then chained off a negative station.
    const tree: RocketTree = {
      components: [
        {
          type: 'stage',
          id: 's',
          children: [
            { type: 'bodytube', id: 'b', length: 0.5, outerRadius: 0.012 },
            {
              type: 'parallelstage',
              id: 'ps',
              radiusOffset: 0.03,
              children: [
                { type: 'bodytube', id: 'pb', length: 0.3, outerRadius: 0.01 },
                { type: 'masscomponent', id: 'm1', length: 0.02, position: { method: 'middle', offset: 0 } },
                { type: 'masscomponent', id: 'm2', length: 0.02, position: { method: 'after', offset: 0 } },
              ],
            },
          ],
        },
      ],
    } as unknown as RocketTree;

    const ps = resolveFilePositions(tree).components[0]!.children![1]!;
    // `after` follows the aft end of the middle-positioned sibling. The pod's
    // own chain is 0.3 long, so middle puts m1 at (0.3 - 0.02)/2 = 0.14 and m2
    // lands at 0.16. With the old parent length of 0, m1 resolved to -0.01 and
    // m2 chained to +0.01 — both forward of where the part actually sits.
    expect(ps.children![2]!.position!.offset).toBeCloseTo(0.16);
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
