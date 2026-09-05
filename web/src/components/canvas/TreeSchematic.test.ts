import { describe, it, expect } from 'vitest';
import type { ComponentNode } from '../../engine/openRocketEngine';
import type { RocketTree } from '../../engine/openRocketEngine';
import {
  niceStep,
  snapNear,
  axialStart,
  collect,
  profilePath,
  calloutLayout,
  finTabFront,
  CALLOUT_LANES,
  computeSchematicLayout,
} from './schematicGeometry';

describe('niceStep', () => {
  it('picks a 1/2/2.5/5/10 × 10ⁿ step giving ~8 marks', () => {
    expect(niceStep(1)).toBeCloseTo(0.2); // target 0.125 → 0.2
    expect(niceStep(0.5)).toBeCloseTo(0.1); // target 0.0625 → 0.1
    expect(niceStep(8)).toBeCloseTo(1); // target 1 → 1
    expect(niceStep(80)).toBeCloseTo(10);
  });
  it('stays positive and finite for a degenerate zero length', () => {
    const s = niceStep(0);
    expect(s).toBeGreaterThan(0);
    expect(Number.isFinite(s)).toBe(true);
  });
});

describe('snapNear', () => {
  const snaps = [0, 0.1, 0.2];
  it('snaps to the nearest value within eps', () => {
    expect(snapNear(0.101, snaps, 0.01)).toBeCloseTo(0.1);
  });
  it('returns raw when nothing is within eps', () => {
    expect(snapNear(0.15, snaps, 0.01)).toBeCloseTo(0.15);
  });
  it('picks the closest of several in-range snaps', () => {
    expect(snapNear(0.08, snaps, 0.05)).toBeCloseTo(0.1); // 0.02 to 0.1 beats 0.08 to 0
  });
});

describe('axialStart', () => {
  it('adds the parent-relative start (top offset) to the parent start', () => {
    const child: ComponentNode = { type: 'innertube', position: { method: 'top', offset: 0.02 } };
    expect(axialStart(child, 0.05, 0.1, 0.2)).toBeCloseTo(0.12);
  });
  it('defaults an absent position to top offset 0', () => {
    expect(axialStart({ type: 'innertube' }, 0.05, 0.1, 0.2)).toBeCloseTo(0.1);
  });
  it('centers a middle-positioned child', () => {
    const child: ComponentNode = { type: 'centeringring', position: { method: 'middle', offset: 0 } };
    // pStart 0.1 + (pLen 0.2 − childLen 0.05)/2 = 0.1 + 0.075
    expect(axialStart(child, 0.05, 0.1, 0.2)).toBeCloseTo(0.175);
  });
});

describe('collect', () => {
  it('walks the tree pre-order, mapping every node', () => {
    const tree: ComponentNode[] = [
      { type: 'bodytube', children: [{ type: 'innertube' }, { type: 'trapezoidfinset' }] },
    ];
    expect(collect(tree, (n) => n.type)).toEqual(['bodytube', 'innertube', 'trapezoidfinset']);
  });
  it('is empty for no nodes', () => {
    expect(collect([], (n) => n.type)).toEqual([]);
  });
});

describe('finTabFront', () => {
  it('top: the offset itself', () => {
    expect(finTabFront({ type: 'trapezoidfinset', tabOffset: 0.01, tabOffsetMethod: 'top' }, 0.05)).toBeCloseTo(0.01);
  });
  it('bottom: offset + (finLen − tabLen)', () => {
    expect(
      finTabFront({ type: 'trapezoidfinset', tabOffset: 0, tabLength: 0.02, tabOffsetMethod: 'bottom' }, 0.05),
    ).toBeCloseTo(0.03);
  });
  it('middle (default): centers the tab', () => {
    expect(finTabFront({ type: 'trapezoidfinset', tabOffset: 0, tabLength: 0.02 }, 0.05)).toBeCloseTo(0.015);
  });
});

describe('calloutLayout', () => {
  it('returns all-null when there are no markers', () => {
    expect(calloutLayout(null, null, 100, 40, 600, 300, null)).toEqual({ cg: null, cp: null, margin: null });
  });

  it('places CG above and CP below the centerline; margin needs both', () => {
    const out = calloutLayout(200, 300, 150, 40, 600, 320, null);
    expect(out.cg!.x).toBe(200);
    expect(out.cp!.x).toBe(300);
    expect(out.cg!.leaderY1).toBeLessThan(150); // CG leader goes up from cy
    expect(out.cp!.leaderY1).toBeGreaterThan(150); // CP leader goes down from cy
    expect(out.margin).toBeNull(); // no marginText
  });

  it('clamps the margin label inside the viewBox width', () => {
    const out = calloutLayout(10, 590, 150, 40, 600, 320, '2.5 cal · 15% — ok');
    expect(out.margin).not.toBeNull();
    expect(out.margin!.x).toBeGreaterThanOrEqual(0);
    expect(out.margin!.x).toBeLessThanOrEqual(600);
  });

  it('exposes the reserved lane height as a constant', () => {
    expect(CALLOUT_LANES).toBeGreaterThan(0);
  });
});

describe('profilePath', () => {
  const ctx = { scale: 1000, cy: 150, x0: 20 };
  it('builds a closed SVG outline (M … L … Z) with a point per profile sample, top + bottom', () => {
    const nose: ComponentNode = { type: 'nosecone', shape: 'ogive' };
    const d = profilePath(ctx, nose, 0, 0.1, 0, 0.05, 150);
    expect(d.startsWith('M ')).toBe(true);
    expect(d.trimEnd().endsWith('Z')).toBe(true);
    // outerProfile samples 24 steps ⇒ 25 points; the outline is top (25) + bottom (25).
    expect(d.split(' L ').length).toBe(50);
    expect(d).not.toMatch(/NaN/);
  });
});

describe('computeSchematicLayout', () => {
  const tree = {
    components: [
      {
        type: 'stage',
        children: [
          { type: 'nosecone', length: 0.1, aftRadius: 0.012 },
          {
            type: 'bodytube',
            length: 0.3,
            outerRadius: 0.012,
            children: [{ type: 'trapezoidfinset', rootChord: 0.05, height: 0.03 }],
          },
        ],
      },
    ],
  } as unknown as RocketTree;
  const dims = { chPx: 480, cw: 640, maxHeight: 480 };

  it('flattens the stage into a nose + body axial chain', () => {
    const out = computeSchematicLayout(tree, null, dims);
    expect(out.chain).toHaveLength(2);
  });

  it('measures the axial length and body radius', () => {
    const out = computeSchematicLayout(tree, null, dims);
    expect(out.totalLen).toBeCloseTo(0.4);
    expect(out.maxR).toBeGreaterThanOrEqual(0.012);
  });

  it('produces a positive scale and a sensibly sized canvas', () => {
    const out = computeSchematicLayout(tree, null, dims);
    expect(out.scale).toBeGreaterThan(0);
    expect(out.w).toBeGreaterThanOrEqual(320);
    expect(out.h).toBeGreaterThanOrEqual(200);
  });

  it('returns a drawing context matching the scale with finite geometry', () => {
    const out = computeSchematicLayout(tree, null, dims);
    expect(out.ctx.scale).toBe(out.scale);
    expect(Number.isFinite(out.ctx.cy)).toBe(true);
    expect(Number.isFinite(out.ctx.x0)).toBe(true);
  });

  it('exposes caliper snap targets', () => {
    const out = computeSchematicLayout(tree, null, dims);
    expect(out.snapXs.length).toBeGreaterThan(0);
  });

  it('stays finite in vertical (nose-up) mode', () => {
    const out = computeSchematicLayout(tree, null, { ...dims, vertical: true });
    expect(Number.isFinite(out.w)).toBe(true);
    expect(Number.isFinite(out.h)).toBe(true);
    expect(Number.isFinite(out.scale)).toBe(true);
  });
});
