import { describe, it, expect } from 'vitest';
import type { ComponentNode, RocketTree } from '../../src/engine/openRocketEngine';
import { finTabSpan, parentRadiusOf } from '../../src/tree/finPlanform';
import { KERNEL_BODYTUBE_OUTER_RADIUS } from '../../src/tree/kernelDefaults';

const treeWith = (tube: Record<string, unknown>): RocketTree =>
  ({
    name: 't',
    components: [
      {
        type: 'stage',
        id: 's',
        children: [{ type: 'bodytube', id: 'b', ...tube, children: [{ type: 'trapezoidfinset', id: 'f' }] }],
      },
    ],
  }) as unknown as RocketTree;

describe('parentRadiusOf', () => {
  it('reads the body tube radius the fin is mounted on', () => {
    expect(parentRadiusOf(treeWith({ outerRadius: 0.02 }), 'f')).toBeCloseTo(0.02, 12);
  });
  it('falls back to the kernel body-tube radius, not a chord, when the key is absent', () => {
    // Falling back to FIN_DEFAULTS.rootChord (0.05 m), a radius-less tube would
    // clamp the tab at 50 mm where the kernel flies BodyTube()'s 25 mm tube
    // (SymmetricComponent.DEFAULT_RADIUS).
    expect(parentRadiusOf(treeWith({}), 'f')).toBeCloseTo(KERNEL_BODYTUBE_OUTER_RADIUS, 12);
    expect(KERNEL_BODYTUBE_OUTER_RADIUS).toBe(0.025);
  });
});

/**
 * Fin sets on a nose cone or a transition, where the parent's radius changes
 * under the tab. The kernel's limit is `FinSet.getMaxTabHeight()`:
 *
 *     min(sym.getRadius(finFront.x + getTabFrontEdge()),
 *         sym.getRadius(finFront.x + getTabTrailingEdge()))
 *
 * with `getTabFrontEdge()` the `tabPosition` from
 * `AxialMethod.getAsPosition(tabOffset, tabLength, length)` and `finFront.x` the
 * fin's axial position in the parent. The expected radii below are
 * `Transition.getRadius(x)` written out by hand for each shape.
 */
describe('parentRadiusOf on a tapered parent', () => {
  /** A 60 mm root freeform fin set; the first point sits on the body. */
  const fin = (extra: Record<string, unknown>) => ({
    type: 'freeformfinset',
    id: 'f',
    points: [
      [0, 0],
      [0.02, 0.03],
      [0.06, 0],
    ],
    tabHeight: 0.2,
    ...extra,
  });
  const treeOn = (parent: Record<string, unknown>, f: Record<string, unknown>): RocketTree =>
    ({
      name: 't',
      components: [{ type: 'stage', id: 's', children: [{ id: 'p', ...parent, children: [f] }] }],
    }) as unknown as RocketTree;

  /**
   * `Transition.getRadius(x)` for a conical part, not clipped: stations outside
   * [0, length] read the end radius; with r1 > r2 the station is mirrored
   * (`x = length - x`) and the ends swapped, then
   * `r1 + CONICAL.getRadius(x, r2 - r1, length)`, which is `r1 + (r2 - r1) * x / length`.
   */
  const conical = (fore: number, aft: number, length: number, x: number): number => {
    if (x < 0) return fore;
    if (x >= length) return aft;
    let r1 = fore;
    let r2 = aft;
    if (r1 > r2) {
      x = length - x;
      [r1, r2] = [r2, r1];
    }
    return r1 + ((r2 - r1) * x) / length;
  };

  /** `Transition.Shape.OGIVE.getRadius(x, radius, length, param)`, for length >= radius. */
  const ogive = (x: number, radius: number, length: number, param: number): number => {
    const R = Math.sqrt(
      ((length ** 2 + radius ** 2) * (((2 - param) * length) ** 2 + (param * radius) ** 2)) /
        (4 * (param * radius) ** 2),
    );
    const L = length / param;
    const y0 = Math.sqrt(R * R - L * L);
    return Math.sqrt(R * R - (L - x) ** 2) - y0;
  };

  const boatTail = { type: 'transition', shape: 'conical', length: 0.1, foreRadius: 0.025, aftRadius: 0.015 };

  it('reads a boat tail at the tab ends, not at its narrow end', () => {
    // Fin front at 0; tab from 10 mm to 50 mm along the fin.
    const f = fin({ position: { method: 'top', offset: 0 }, tabOffsetMethod: 'top', tabOffset: 0.01, tabLength: 0.04 });
    const expected = Math.min(conical(0.025, 0.015, 0.1, 0.01), conical(0.025, 0.015, 0.1, 0.05));
    expect(expected).toBeCloseTo(0.02, 12);
    expect(parentRadiusOf(treeOn(boatTail, f), 'f')).toBeCloseTo(expected, 12);
  });

  it('places a bottom-anchored fin and a middle-anchored tab as the kernel does', () => {
    // Fin front = 0.1 - 0.06 = 0.04; tab front = (0.06 - 0.02) / 2 = 0.02.
    const f = fin({
      position: { method: 'bottom', offset: 0 },
      tabOffsetMethod: 'middle',
      tabOffset: 0,
      tabLength: 0.02,
    });
    const expected = Math.min(conical(0.025, 0.015, 0.1, 0.06), conical(0.025, 0.015, 0.1, 0.08));
    expect(parentRadiusOf(treeOn(boatTail, f), 'f')).toBeCloseTo(expected, 12);
  });

  it('reads the end radius for a tab station past the part', () => {
    // Fin front 0.05, bottom-anchored tab offset 0.02: the tab runs 0.09 to 0.13.
    const f = fin({
      position: { method: 'top', offset: 0.05 },
      tabOffsetMethod: 'bottom',
      tabOffset: 0.02,
      tabLength: 0.04,
    });
    const flare = { ...boatTail, foreRadius: 0.015, aftRadius: 0.025 };
    const expected = Math.min(conical(0.015, 0.025, 0.1, 0.09), conical(0.015, 0.025, 0.1, 0.13));
    expect(expected).toBeCloseTo(0.024, 12);
    expect(parentRadiusOf(treeOn(flare, f), 'f')).toBeCloseTo(expected, 12);
  });

  it('reads a nose cone along its profile, tip forward', () => {
    // A nose cone is a transition from 0 at the tip to the base radius.
    const nose = { type: 'nosecone', shape: 'conical', length: 0.2, aftRadius: 0.025 };
    const f = fin({ position: { method: 'top', offset: 0.05 }, tabOffsetMethod: 'top', tabOffset: 0, tabLength: 0.04 });
    const expected = Math.min(conical(0, 0.025, 0.2, 0.05), conical(0, 0.025, 0.2, 0.09));
    expect(expected).toBeCloseTo(0.00625, 12);
    expect(parentRadiusOf(treeOn(nose, f), 'f')).toBeCloseTo(expected, 12);
  });

  it('reads a flipped nose cone base first', () => {
    // NoseCone.setFlipped moves the base to the fore end: fore 0.025, aft 0.
    const nose = { type: 'nosecone', shape: 'conical', length: 0.2, aftRadius: 0.025, flipped: true };
    const f = fin({ position: { method: 'top', offset: 0.05 }, tabOffsetMethod: 'top', tabOffset: 0, tabLength: 0.04 });
    const expected = Math.min(conical(0.025, 0, 0.2, 0.05), conical(0.025, 0, 0.2, 0.09));
    expect(expected).toBeCloseTo(0.01375, 12);
    expect(parentRadiusOf(treeOn(nose, f), 'f')).toBeCloseTo(expected, 12);
  });

  it('reads an ogive nose cone on its curve', () => {
    // Not flipped and r1 = 0 < r2, so getRadius(x) = OGIVE.getRadius(x, base, length, param).
    const nose = { type: 'nosecone', shape: 'ogive', shapeParameter: 1, length: 0.2, aftRadius: 0.025 };
    const f = fin({
      position: { method: 'top', offset: 0.03 },
      tabOffsetMethod: 'top',
      tabOffset: 0.01,
      tabLength: 0.03,
    });
    const expected = Math.min(ogive(0.04, 0.025, 0.2, 1), ogive(0.07, 0.025, 0.2, 1));
    // A tangent ogive bulges above the cone of the same base, so a chord or a
    // cone read at the same station would come out short.
    expect(expected).toBeGreaterThan(conical(0, 0.025, 0.2, 0.04) + 0.003);
    expect(parentRadiusOf(treeOn(nose, f), 'f')).toBeCloseTo(expected, 12);
  });

  it('leaves no tab where the tab starts at the nose tip', () => {
    // The kernel's limit is getRadius(0) = 0, so setTabHeight stores 0.
    const nose = { type: 'nosecone', shape: 'conical', length: 0.2, aftRadius: 0.025 };
    const f = fin({ position: { method: 'top', offset: 0 }, tabOffsetMethod: 'top', tabOffset: 0, tabLength: 0.04 });
    const limit = parentRadiusOf(treeOn(nose, f), 'f');
    expect(limit).toBe(0);
    expect(finTabSpan(f as unknown as ComponentNode, 0.06, limit)).toBeNull();
  });

  it('leaves a body tube at its radius wherever the tab sits', () => {
    const f = fin({
      position: { method: 'top', offset: 0.05 },
      tabOffsetMethod: 'top',
      tabOffset: 0.01,
      tabLength: 0.04,
    });
    expect(parentRadiusOf(treeOn({ type: 'bodytube', length: 0.3, outerRadius: 0.02 }, f), 'f')).toBe(0.02);
  });
});

describe('finSpan on a hostile outline', () => {
  it('handles a 200k-point freeform outline without a stack overflow', async () => {
    const { finSpan } = await import('../../src/tree/finPlanform');
    // `Math.max(...pts.map())` would spread 200k arguments into one call and
    // throw RangeError before the PDF report's own guard is reached.
    const pts: [number, number][] = [];
    for (let i = 0; i < 200_000; i++) pts.push([i * 1e-6, (i % 100) * 1e-4]);
    pts.push([0.2, 0.05]);
    const node = { type: 'freeformfinset', points: pts } as never;
    expect(finSpan(node)).toBeCloseTo(0.05, 12);
  });
});
