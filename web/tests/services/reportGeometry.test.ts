import { describe, it, expect } from 'vitest';
import type { ComponentNode, RocketTree } from '../../src/engine/openRocketEngine';
import { finPlanformMm, profileMm, rocketSideView } from '../../src/services/reportGeometry';

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

/**
 * The freeform outline and its through-the-wall TAB have to share one origin.
 *
 * The outline was drawn in raw point coordinates while the tab was placed in
 * root-relative ones (`finTabFront(node, root)` with `root = last.x - first.x`),
 * so they agreed only when points[0].x === 0. `FreeformFinEditor` lets the
 * first vertex be dragged off the origin, and the kernel normalizes on
 * `setPoints` — so the app cut the tab somewhere the engine does not.
 */
describe('a freeform fin whose outline does not start at the origin', () => {
  const ff = (points: [number, number][]) =>
    node({
      type: 'freeformfinset',
      points,
      finCount: 3,
      tabHeight: 0.005,
      tabLength: 0.02,
      tabOffsetMethod: 'middle',
      tabOffset: 0,
    });

  const AT_ORIGIN: [number, number][] = [
    [0, 0],
    [0.02, 0.03],
    [0.06, 0],
  ];
  const SHIFTED: [number, number][] = [
    [0.02, 0],
    [0.04, 0.03],
    [0.08, 0],
  ];

  /** The tab is the four points appended after the outline. */
  const tabSpan = (n: ReturnType<typeof ff>): [number, number] => {
    const tab = finPlanformMm(n)!
      .pts.slice(-4)
      .map(([x]) => x);
    return [Math.min(...tab), Math.max(...tab)];
  };

  /** The outline's own x-range — the frame the tab has to live in. */
  const outlineSpan = (n: ReturnType<typeof ff>): [number, number] => {
    const xs = finPlanformMm(n)!
      .pts.slice(0, 3)
      .map(([x]) => x);
    return [Math.min(...xs), Math.max(...xs)];
  };

  it('centers the tab on the OUTLINE, not 20 mm forward of it', () => {
    // Comparing tab to tab proves nothing: `finTabFront` works off
    // `root = last.x - first.x`, which is translation-invariant, so the tab
    // lands at 20..40 either way. What moved was the outline around it — with
    // the raw points it spanned 20..80, putting the "centered" tab hard against
    // the leading edge.
    const [lo, hi] = tabSpan(ff(SHIFTED));
    const [oLo, oHi] = outlineSpan(ff(SHIFTED));
    expect((lo + hi) / 2).toBeCloseTo((oLo + oHi) / 2, 6);
    expect(lo).toBeGreaterThan(oLo + 1); // genuinely inboard of the leading edge
    expect(hi).toBeLessThan(oHi - 1);
  });

  it('cuts the tab exactly where the identical fin drawn at the origin does', () => {
    const shifted = finPlanformMm(ff(SHIFTED))!.pts;
    const atOrigin = finPlanformMm(ff(AT_ORIGIN))!.pts;
    // Same fin, same 60 mm root, same 20 mm centered tab — so the same part.
    expect(shifted.map(([x, y]) => [Math.round(x * 1e6), Math.round(y * 1e6)])).toEqual(
      atOrigin.map(([x, y]) => [Math.round(x * 1e6), Math.round(y * 1e6)]),
    );
  });

  it('draws the outline from the origin, so outline and tab share a frame', () => {
    const p = finPlanformMm(ff(SHIFTED))!;
    const outline = p.pts.slice(0, 3).map(([x]) => x);
    expect(Math.min(...outline)).toBeCloseTo(0, 6);
    expect(Math.max(...outline)).toBeCloseTo(60, 6);
  });

  it('places it on the body at the same station as the origin-based fin', () => {
    const rocket = (points: [number, number][]) =>
      ({
        components: [
          {
            type: 'bodytube',
            length: 0.3,
            outerRadius: 0.012,
            children: [{ type: 'freeformfinset', points, position: { method: 'top', offset: 0.1 } }],
          },
        ],
      }) as unknown as RocketTree;
    const xs = (points: [number, number][]) => rocketSideView(rocket(points)).fins[0]!.map((p) => p[0]);
    expect(Math.min(...xs(SHIFTED))).toBeCloseTo(Math.min(...xs(AT_ORIGIN)), 6);
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

  /**
   * A fin sits at the radius under ITS OWN FRONT, not at the parent's aft end:
   * `FinSet.getBodyRadius()` is `getFinFront().getY()`, i.e.
   * `symmetricParent.getRadius(xFinFront)` (FinSet.java:959-972).
   *
   * This boat tail runs 12 mm → 8 mm over 50 mm, and the fin starts at its
   * front. Handing `addFins` the AFT radius drew the root at +8 mm while the
   * silhouette there is +12 mm — the fin root 4 mm inside the airframe. On a
   * 26 → 13 mm boat tail it is 13 mm inside.
   */
  it('seats the fin root on the body surface under the fin front, not the aft radius', () => {
    const view = rocketSideView(withBoatTailFins);
    const fin = view.fins[0]!;
    const rootY = Math.min(...fin.map((p) => Math.abs(p[1]))); // the root line
    // Conical 12 → 8 mm: at the transition's front the body is 12 mm.
    expect(rootY).toBeCloseTo(12, 6);
    expect(rootY).not.toBeCloseTo(8, 3);
  });

  it('follows the taper for a fin set further aft', () => {
    const halfway = {
      components: [
        { type: 'bodytube', length: 0.2, outerRadius: 0.012 },
        {
          type: 'transition',
          length: 0.05,
          foreRadius: 0.012,
          aftRadius: 0.008,
          shape: 'conical',
          children: [
            {
              type: 'trapezoidfinset',
              rootChord: 0.02,
              tipChord: 0.01,
              sweep: 0.005,
              height: 0.02,
              position: { method: 'top', offset: 0.025 },
            },
          ],
        },
      ],
    } as unknown as RocketTree;
    const fin = rocketSideView(halfway).fins[0]!;
    const rootY = Math.min(...fin.map((p) => Math.abs(p[1])));
    // Halfway down a linear 12 → 8 mm taper is 10 mm.
    expect(rootY).toBeCloseTo(10, 6);
  });
});

/**
 * Tube fins in the whole-rocket side view.
 *
 * `addFins` had no tube-fin branch, so a `<tubefinset>` fell into the generic
 * `else` and was drawn as a swept fin built from the rootChord/height defaults
 * — a fin the rocket does not have, on the design report's own silhouette.
 * A tube fin is a TUBE: 2·rt tall, standing on the body, running its own length.
 */
describe('rocketSideView: tube fins draw as tubes', () => {
  const tubeRocket = (over: Record<string, unknown> = {}) =>
    ({
      components: [
        node({ type: 'nosecone', id: 'n', length: 0.1, aftRadius: 0.012 }),
        node({
          type: 'bodytube',
          id: 'b',
          length: 0.4,
          outerRadius: 0.012,
          children: [
            node({
              type: 'tubefinset',
              id: 'tf',
              finCount: 6,
              length: 0.08,
              outerRadius: 0.01,
              position: { method: 'bottom', offset: 0 },
              ...over,
            }),
          ],
        }),
      ],
    }) as unknown as RocketTree;

  it('spans the tube diameter above the body, not an invented fin height', () => {
    const sv = rocketSideView(tubeRocket());
    expect(sv.fins).toHaveLength(2); // the shape and its mirror

    const top = sv.fins[0]!;
    const ys = top.map(([, y]) => y);
    // Body radius 12 mm, tube radius 10 mm: the silhouette runs 12 → 32 mm.
    expect(Math.min(...ys)).toBeCloseTo(12, 6);
    expect(Math.max(...ys)).toBeCloseTo(32, 6);
    // The old default-built fin reached 12 + 30 = 42 mm and was never flat-topped.
    expect(Math.max(...ys)).not.toBeCloseTo(42, 3);
  });

  it('runs the tube’s own length, not a 50 mm root chord', () => {
    const top = rocketSideView(tubeRocket()).fins[0]!;
    const xs = top.map(([x]) => x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(80, 6); // length 0.08 m
  });

  it('is a rectangle — four corners, two of them flat on the body', () => {
    const top = rocketSideView(tubeRocket()).fins[0]!;
    expect(top).toHaveLength(4);
    expect(top.filter(([, y]) => Math.abs(y - 12) < 1e-6)).toHaveLength(2); // seated on the airframe
  });

  it('auto-sizes the tube when the set carries no radius, and counts it in the height', () => {
    // No outerRadius: the kernel's touching rule, r = R·sin(π/N)/(1 − sin(π/N)).
    const sv = rocketSideView(tubeRocket({ outerRadius: undefined }));
    const s = Math.sin(Math.PI / 6);
    const rt = (0.012 * s) / (1 - s);
    const top = Math.max(...sv.fins[0]!.map(([, y]) => y));
    expect(top).toBeCloseTo((0.012 + 2 * rt) * 1000, 6);
    // ...and the drawing is tall enough to contain it.
    expect(sv.h / 2).toBeGreaterThanOrEqual(top - 1e-6);
  });
});

/**
 * Kernel-exactness of the elliptical planform, asserted at an INTERIOR station.
 *
 * The pre-existing test above ("a true sampled half-ellipse") asserted only
 * point count and that the apex reaches full height — properties a sine arch
 * shares with a half-ellipse, which is how a wrong curve survived three audits.
 * A parameterized curve has to be pinned between its endpoints.
 */
describe('elliptical planform matches the kernel at interior stations', () => {
  it('is a half-ellipse, not a sine arch', () => {
    const root = 0.05,
      height = 0.03;
    const p = finPlanformMm(node({ type: 'ellipticalfinset', rootChord: root, height, finCount: 3 }));
    // finPlanformMm flips y: the root sits at height*1000 and the span rises toward 0.
    const span = p.pts.map(([x, y]) => [x / 1000, height - y / 1000] as const);
    for (const [x, y] of span) {
      // Closed form of the kernel's ellipse: y = height * sqrt(1 - (2x/root - 1)^2).
      const exact = height * Math.sqrt(Math.max(0, 1 - Math.pow((2 * x) / root - 1, 2)));
      expect(y).toBeCloseTo(exact, 9);
    }
    // And is measurably NOT the sine arch that shipped for twelve days: near
    // the leading edge the two differ by most of the span.
    const near = span.reduce((a, b) => (Math.abs(b[0] - 0.005) < Math.abs(a[0] - 0.005) ? b : a));
    const arch = height * Math.sin((Math.PI * near[0]) / root);
    expect(Math.abs(near[1] - arch)).toBeGreaterThan(0.005);
  });
});

/**
 * The PDF side view has to show what the 2D schematic shows.
 *
 * It used to walk only the core chain, so a strap-on booster cluster printed
 * as a single plain tube while the screen drew the boosters. The report figure
 * is the one you hand someone to check the design, and it was lying by
 * omission. Both now use the same `resolveAssemblyRadius` + `ringInstanceOffsets`
 * from tree/assembly.ts, so the expected offsets below are derived from the
 * kernel's ring convention rather than copied from the implementation.
 */
describe('rocketSideView: off-axis assemblies', () => {
  const CORE_R = 0.012;
  const POD_R = 0.008;
  const boosters = (extra: Record<string, unknown> = {}): RocketTree =>
    ({
      name: 'boosters',
      components: [
        node({
          type: 'stage',
          children: [
            node({ type: 'nosecone', shape: 'ogive', length: 0.1, aftRadius: CORE_R }),
            node({
              type: 'bodytube',
              length: 0.4,
              outerRadius: CORE_R,
              children: [
                node({
                  type: 'parallelstage',
                  instanceCount: 2,
                  radiusOffset: 0,
                  children: [node({ type: 'bodytube', length: 0.2, outerRadius: POD_R })],
                  ...extra,
                }),
              ],
            }),
          ],
        }),
      ],
    }) as unknown as RocketTree;

  // RELATIVE radius: gap + parent outer radius + the pod's own bounding radius,
  // so offset 0 means the booster just touches the airframe.
  const expectedOffsetMm = (0 + CORE_R + POD_R) * 1000;

  it('draws one silhouette per booster instance', () => {
    const sv = rocketSideView(boosters());
    expect(sv.pods).toHaveLength(2);
  });

  it('puts each booster on its own centerline, both sides of the airframe', () => {
    const sv = rocketSideView(boosters());
    // Each pod polygon spans center +/- its own radius.
    const centers = sv.pods.map((p) => {
      const ys = p.map(([, y]) => y);
      return (Math.max(...ys) + Math.min(...ys)) / 2;
    });
    centers.sort((a, b) => a - b);
    expect(centers[0]).toBeCloseTo(-expectedOffsetMm, 6);
    expect(centers[1]).toBeCloseTo(expectedOffsetMm, 6);
    // ...and each is as thick as the booster, not the core.
    for (const p of sv.pods) {
      const ys = p.map(([, y]) => y);
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(POD_R * 2 * 1000, 6);
    }
  });

  it('grows the drawing height to fit the boosters', () => {
    const withPods = rocketSideView(boosters());
    const bare = rocketSideView({
      name: 'bare',
      components: [
        node({
          type: 'stage',
          children: [node({ type: 'bodytube', length: 0.4, outerRadius: CORE_R })],
        }),
      ],
    } as unknown as RocketTree);
    // The frame must reach the far edge of the outermost booster, or the PDF
    // clips it off the page.
    expect(withPods.h).toBeGreaterThan(bare.h);
    expect(withPods.h / 2).toBeGreaterThanOrEqual(expectedOffsetMm + POD_R * 1000 - 1e-6);
  });

  it('honors the ring angle, so three boosters are not all drawn on top of each other', () => {
    const sv = rocketSideView(boosters({ instanceCount: 3 }));
    expect(sv.pods).toHaveLength(3);
    const centers = sv.pods.map((p) => {
      const ys = p.map(([, y]) => y);
      return (Math.max(...ys) + Math.min(...ys)) / 2;
    });
    // y = r*cos(theta) for theta = 0, 120, 240 degrees: one up, two half-down.
    centers.sort((a, b) => a - b);
    expect(centers[0]).toBeCloseTo(-expectedOffsetMm / 2, 6);
    expect(centers[1]).toBeCloseTo(-expectedOffsetMm / 2, 6);
    expect(centers[2]).toBeCloseTo(expectedOffsetMm, 6);
  });

  it('mirrors a fin on a booster about the BOOSTER, not the rocket axis', () => {
    const sv = rocketSideView(
      boosters({
        children: [
          node({
            type: 'bodytube',
            length: 0.2,
            outerRadius: POD_R,
            children: [node({ type: 'trapezoidfinset', rootChord: 0.04, tipChord: 0.02, sweep: 0.01, height: 0.02 })],
          }),
        ],
      }),
    );
    expect(sv.fins.length).toBe(4); // 2 instances x (top + mirror)
    // A fin's top and its mirror straddle the booster's centerline, so their
    // midpoint is the booster offset rather than 0.
    const mids = sv.fins.map((f) => {
      const ys = f.map(([, y]) => y);
      return (Math.max(...ys) + Math.min(...ys)) / 2;
    });
    expect(mids.every((m) => Math.abs(Math.abs(m) - expectedOffsetMm) < expectedOffsetMm)).toBe(true);
    expect(mids.some((m) => m > 0)).toBe(true);
    expect(mids.some((m) => m < 0)).toBe(true);
  });
});
