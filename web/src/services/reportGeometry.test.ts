import { describe, it, expect } from 'vitest';
import type { ComponentNode, RocketTree } from '../engine/openRocketEngine';
import { finPlanformMm, profileMm, rocketSideView } from './reportGeometry';

const node = (o: object): ComponentNode => o as unknown as ComponentNode;

describe('finPlanformMm', () => {
  it('draws a trapezoid fin as a 4-point (plus none) outline in mm', () => {
    const p = finPlanformMm(
      node({ type: 'trapezoidfinset', rootChord: 0.06, tipChord: 0.03, sweep: 0.02, height: 0.04, finCount: 4 }),
    );
    expect(p).not.toBeNull();
    expect(p!.count).toBe(4);
    expect(p!.pts).toHaveLength(4);
    // Root runs 0..60mm; the outline spans the full 40mm height.
    const ys = p!.pts.map(([, y]) => y);
    expect(Math.min(...ys)).toBeCloseTo(0, 6); // apex (top)
    expect(Math.max(...ys)).toBeCloseTo(40, 6); // root line at height
  });

  it('draws an elliptical fin as a true sampled half-ellipse, not a trapezoid', () => {
    const p = finPlanformMm(node({ type: 'ellipticalfinset', rootChord: 0.05, height: 0.03, finCount: 3 }));
    expect(p).not.toBeNull();
    expect(p!.pts.length).toBeGreaterThan(10); // 41-point curve, not 4-point trapezoid
    // The apex reaches the full height (y = 0 at the top of the mm frame).
    expect(Math.min(...p!.pts.map(([, y]) => y))).toBeCloseTo(0, 3);
  });
});

describe('profileMm', () => {
  it('returns null for a zero-length part', () => {
    expect(profileMm(node({ type: 'transition', length: 0 }), 0.01, 0.008, 'conical')).toBeNull();
  });
  it('sizes a conical transition to its length and max diameter', () => {
    const r = profileMm(
      node({ type: 'transition', shape: 'conical', length: 0.04, foreRadius: 0.013, aftRadius: 0.02 }),
      0.013,
      0.02,
      'conical',
    );
    expect(r).not.toBeNull();
    expect(r!.w).toBeCloseTo(40, 6); // 0.04 m
    expect(r!.h).toBeCloseTo(40, 6); // 2 * max radius (0.02 m)
    expect(r!.pts.length).toBeGreaterThan(4);
  });
});

describe('rocketSideView', () => {
  const tree: RocketTree = {
    name: 'test',
    components: [
      node({
        type: 'stage',
        children: [
          node({ type: 'nosecone', shape: 'ogive', length: 0.1, aftRadius: 0.012 }),
          node({
            type: 'bodytube',
            length: 0.2,
            outerRadius: 0.012,
            children: [
              node({ type: 'ellipticalfinset', rootChord: 0.05, height: 0.03, finCount: 3 }),
              node({
                type: 'trapezoidfinset',
                rootChord: 0.05,
                tipChord: 0.02,
                sweep: 0.02,
                height: 0.03,
                finCount: 4,
              }),
            ],
          }),
        ],
      }),
    ],
  } as unknown as RocketTree;

  it('produces a closed body silhouette and a top+mirror polygon per fin set', () => {
    const v = rocketSideView(tree);
    expect(v.w).toBeCloseTo(300, 6); // 0.3 m nose + body
    expect(v.body.length).toBeGreaterThan(2);
    expect(v.fins).toHaveLength(4); // 2 fin sets × (top + mirrored bottom)
  });

  it('draws the elliptical fin as a curve and the trapezoid as 4 points', () => {
    const v = rocketSideView(tree);
    expect(v.fins.some((f) => f.length > 10)).toBe(true); // elliptical half-ellipse
    expect(v.fins.some((f) => f.length === 4)).toBe(true); // trapezoid
  });
});

/**
 * The root chord positions a freeform fin; the outline DRAWS it. Those are two
 * different measures whenever the tip trailing corner overhangs the root, and
 * conflating them is the bug this guards:
 *
 *   - use the aftmost point to position, and the fin moves forward of where the
 *     engine flies it (what four modules used to do);
 *   - use the root chord to draw, and the overhang gets clipped off the shape.
 *
 * The 2D schematic already had this right — it keeps `root` and `aftX` apart,
 * with a comment saying the aft point must not move the fin. These pin the same
 * invariant for the report geometry, which is where it was got wrong.
 */
describe('freeform fin: root positions, outline draws', () => {
  // Root chord 0.06 (first -> last x); furthest-aft point 0.09.
  const overhang: [number, number][] = [
    [0, 0],
    [0.04, 0.05],
    [0.09, 0.05],
    [0.06, 0],
  ];

  it('draws the whole outline, overhang included', () => {
    const fin = { type: 'freeformfinset', points: overhang } as unknown as ComponentNode;
    const out = finPlanformMm(fin)!;
    // 0.09 m -> 90 mm. Clipping to the 60 mm root would cut the fin's corner off
    // the 1:1 cutting template.
    expect(Math.max(...out.pts.map((p) => p[0]))).toBeCloseTo(90, 6);
  });

  it('clamps the fin tab to the ROOT, not to the overhang', () => {
    const fin = {
      type: 'freeformfinset',
      points: overhang,
      tabHeight: 0.004,
      tabLength: 0.2, // longer than the fin: must clamp
    } as unknown as ComponentNode;
    const out = finPlanformMm(fin)!;
    const tabXs = out.pts.slice(overhang.length).map((p) => p[0]);
    expect(tabXs.length).toBeGreaterThan(0);
    // 60 mm, the real root — a tab running to 90 mm would hang off the airframe.
    expect(Math.max(...tabXs)).toBeCloseTo(60, 6);
  });

  it('anchors a bottom-mounted fin by its root but still draws the overhang', () => {
    const tree = {
      components: [
        {
          type: 'bodytube',
          length: 0.2,
          outerRadius: 0.012,
          children: [{ type: 'freeformfinset', points: overhang, position: { method: 'bottom', offset: 0 } }],
        },
      ],
    } as unknown as RocketTree;
    const view = rocketSideView(tree);
    expect(view.fins.length).toBeGreaterThan(0);
    const xs = view.fins[0]!.map((p) => p[0]);
    const start = Math.min(...xs);
    // Bottom-anchored: the ROOT trailing edge sits at the tube's aft end
    // (200 mm), so the fin starts at 140 mm — not 110 mm, which is where the
    // aftmost-point measure used to put it.
    expect(start).toBeCloseTo(140, 3);
    // …and the drawn polygon still reaches the full 90 mm of outline.
    expect(Math.max(...xs) - start).toBeCloseTo(90, 3);
  });
});

describe('rocketSideView: fins on a transition', () => {
  /**
   * `treeEdit.ts:137` allows a fin set on a transition (a boat tail), the kernel
   * simulates it — and this branch was the only one that never looked at its
   * children. The PDF's whole-rocket side view showed a finless rocket, with no
   * warning that anything was missing.
   */
  const withBoatTailFins = {
    components: [
      {
        type: 'bodytube',
        length: 0.2,
        outerRadius: 0.012,
      },
      {
        type: 'transition',
        length: 0.05,
        foreRadius: 0.012,
        aftRadius: 0.008,
        children: [{ type: 'trapezoidfinset', rootChord: 0.03, tipChord: 0.02, sweep: 0.01, height: 0.02 }],
      },
    ],
  } as unknown as RocketTree;

  it('draws them', () => {
    expect(rocketSideView(withBoatTailFins).fins.length).toBeGreaterThan(0);
  });

  it('places them on the transition, not back on the tube', () => {
    const view = rocketSideView(withBoatTailFins);
    const xs = view.fins[0]!.map((p) => p[0]);
    // The transition starts 200 mm aft (after the tube), so the fin root has to
    // begin at or past that — not at the start of the rocket.
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(200 - 1e-6);
  });
});
