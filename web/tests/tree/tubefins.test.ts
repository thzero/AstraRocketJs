import { describe, it, expect } from 'vitest';
import type { ComponentNode } from '../../src/engine/openRocketEngine';
import { tubeFinRadius, tubeFinMaxRadius, tubeFinMaxCount, isFinSet, isPlanarFinSet } from '../../src/tree/tubefins';

const node = (props: Record<string, unknown>): ComponentNode => ({ type: 'tubefinset', ...props });

describe('tubeFinRadius', () => {
  it('returns the explicit outerRadius when set (> 0)', () => {
    expect(tubeFinRadius(node({ outerRadius: 0.02, finCount: 6 }), 0.05)).toBe(0.02);
  });

  it('falls back to auto-sizing when outerRadius is absent or zero', () => {
    // finCount 6: r = R·sin(π/6)/(1−sin(π/6)) = R·0.5/0.5 = R
    expect(tubeFinRadius(node({ outerRadius: 0, finCount: 6 }), 0.024)).toBeCloseTo(0.024);
  });

  it('defaults finCount to 6 when unspecified', () => {
    expect(tubeFinRadius(node({}), 0.024)).toBeCloseTo(0.024); // 6 tubes ⇒ r = body radius
  });

  it('auto-sizes larger counts smaller (touching tubes)', () => {
    // finCount 8: r = R·sin(π/8)/(1−sin(π/8))
    const s = Math.sin(Math.PI / 8);
    expect(tubeFinRadius(node({ finCount: 8 }), 0.05)).toBeCloseTo((0.05 * s) / (1 - s));
  });

  it('auto-sizes to the body radius below 3 fins (avoids the sin π/2 divide-by-zero)', () => {
    expect(tubeFinRadius(node({ finCount: 2 }), 0.03)).toBe(0.03);
  });
});

describe('tubeFinMaxRadius', () => {
  it('is null below 3 fins (1–2 tubes can never touch around the body)', () => {
    expect(tubeFinMaxRadius(2, 0.05)).toBeNull();
    expect(tubeFinMaxRadius(1, 0.05)).toBeNull();
  });

  it('returns the touching radius at 3+ fins', () => {
    const s = Math.sin(Math.PI / 3);
    expect(tubeFinMaxRadius(3, 0.01)).toBeCloseTo((0.01 * s) / (1 - s));
  });
});

describe('tubeFinMaxCount', () => {
  it('returns 2 for degenerate inputs', () => {
    expect(tubeFinMaxCount(0, 0.05)).toBe(2);
    expect(tubeFinMaxCount(0.02, 0)).toBe(2);
  });

  it('equal tube and body radii allow exactly 6 fins', () => {
    expect(tubeFinMaxCount(0.05, 0.05)).toBe(6);
  });

  it('smaller tubes allow more fins', () => {
    expect(tubeFinMaxCount(0.01, 0.05)).toBe(18);
  });

  it('never drops below 2 even for oversized tubes', () => {
    expect(tubeFinMaxCount(1, 0.001)).toBe(2);
  });
});

describe('tubeFinRadius numeric guard', () => {
  // The hand-rolled `typeof x === 'number' && x > 0` let Infinity through,
  // which propagates to the schematic's scale and collapses the drawing to
  // nothing. `numOpt` carries the Number.isFinite guard nodeProps documents as
  // load-bearing, so a non-finite radius falls back to the auto rule instead.
  it('ignores a non-finite explicit radius and falls back to the auto rule', () => {
    const auto = tubeFinRadius({ type: 'tubefinset', finCount: 6 } as unknown as ComponentNode, 0.012);
    for (const bad of [Number.POSITIVE_INFINITY, Number.NaN]) {
      const r = tubeFinRadius({ type: 'tubefinset', finCount: 6, outerRadius: bad } as unknown as ComponentNode, 0.012);
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeCloseTo(auto, 12);
    }
  });

  it('still honours a real explicit radius', () => {
    const r = tubeFinRadius({ type: 'tubefinset', finCount: 6, outerRadius: 0.005 } as unknown as ComponentNode, 0.012);
    expect(r).toBeCloseTo(0.005, 12);
  });
});

/**
 * The fin-set predicates.
 *
 * `<tubefinset>` ends in "finset" but `TubeFinSet extends Tube`, not FinSet —
 * so OpenRocket's `instanceof FinSet` excludes it and our string match did not.
 * That one-word difference fabricated a 50 × 30 mm cutting template, a
 * made-up fin in the report silhouette, and a 50 mm root span, for a part that
 * is a tube.
 */
describe('isFinSet / isPlanarFinSet', () => {
  const PLANAR = ['trapezoidfinset', 'ellipticalfinset', 'freeformfinset'];

  it('counts every fin set, tube fins included — what a marking guide collects', () => {
    for (const t of [...PLANAR, 'tubefinset']) expect(isFinSet(t), t).toBe(true);
  });

  it('excludes tube fins from the planar set — what `instanceof FinSet` does', () => {
    for (const t of PLANAR) expect(isPlanarFinSet(t), t).toBe(true);
    expect(isPlanarFinSet('tubefinset')).toBe(false);
  });

  it('says no to everything that is not a fin set', () => {
    for (const t of ['bodytube', 'nosecone', 'innertube', 'transition', 'launchlug', '']) {
      expect(isFinSet(t), t).toBe(false);
      expect(isPlanarFinSet(t), t).toBe(false);
    }
  });
});
