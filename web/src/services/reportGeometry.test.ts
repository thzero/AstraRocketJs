import { describe, it, expect } from 'vitest';
import type { ComponentNode, RocketTree } from '../engine/openRocketEngine';
import { finPlanformMm, profileMm, rocketSideView } from './reportGeometry';

const node = (o: object): ComponentNode => o as unknown as ComponentNode;

describe('finPlanformMm', () => {
  it('draws a trapezoid fin as a 4-point (plus none) outline in mm', () => {
    const p = finPlanformMm(node({ type: 'trapezoidfinset', rootChord: 0.06, tipChord: 0.03, sweep: 0.02, height: 0.04, finCount: 4 }));
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
    const r = profileMm(node({ type: 'transition', shape: 'conical', length: 0.04, foreRadius: 0.013, aftRadius: 0.02 }), 0.013, 0.02, 'conical');
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
              node({ type: 'trapezoidfinset', rootChord: 0.05, tipChord: 0.02, sweep: 0.02, height: 0.03, finCount: 4 }),
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
