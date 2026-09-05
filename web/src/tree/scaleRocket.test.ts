import { describe, it, expect } from 'vitest';
import type { RocketTree } from '../engine/openRocketEngine';
import { scaleRocket, maxBodyDiameter, rocketLength } from './scaleRocket';

const tree = (): RocketTree => ({
  components: [
    {
      type: 'stage',
      children: [
        { type: 'nosecone', length: 0.1, aftRadius: 0.012, thickness: 0.001, shape: 'ogive', shapeParameter: 1 },
        {
          type: 'bodytube',
          length: 0.3,
          outerRadius: 0.012,
          thickness: 0.001,
          children: [
            { type: 'trapezoidfinset', finCount: 3, rootChord: 0.05, tipChord: 0.03, sweep: 0.02, height: 0.03, thickness: 0.003 },
            { type: 'freeformfinset', finCount: 4, points: [[0, 0], [0.02, 0.03], [0.05, 0]] },
            { type: 'masscomponent', mass: 0.01, length: 0.02, radius: 0.005, position: { method: 'top', offset: 0.05 } },
            { type: 'parachute', diameter: 0.4, mass: 0.008 },
          ],
        },
      ],
    },
  ],
});

describe('scaleRocket', () => {
  it('doubles every length, radius and axial position at 2×', () => {
    const out = scaleRocket(tree(), 2);
    const stage = out.components[0]!;
    const [nose, body] = stage.children!;
    expect(nose!['length']).toBeCloseTo(0.2);
    expect(nose!['aftRadius']).toBeCloseTo(0.024);
    expect(body!['length']).toBeCloseTo(0.6);
    expect(body!['outerRadius']).toBeCloseTo(0.024);
    const [fin, freeform, massc] = body!.children!;
    expect(fin!['rootChord']).toBeCloseTo(0.1);
    expect(fin!['height']).toBeCloseTo(0.06);
    // Freeform planform points both scale.
    expect(freeform!['points']).toEqual([[0, 0], [0.04, 0.06], [0.1, 0]]);
    // Axial position offset scales too.
    expect(massc!.position!.offset).toBeCloseTo(0.1);
  });

  it("does NOT scale counts, shape parameters or the fin's angular data", () => {
    const out = scaleRocket(tree(), 2);
    const body = out.components[0]!.children![1]!;
    const nose = out.components[0]!.children![0]!;
    expect(body.children![0]!['finCount']).toBe(3); // count unchanged
    expect(nose['shapeParameter']).toBe(1); // dimensionless, unchanged
  });

  it('scales a pinned mass by the cube for a solid part, the square for a canopy', () => {
    const out = scaleRocket(tree(), 2);
    const body = out.components[0]!.children![1]!;
    const massc = body.children!.find((c) => c.type === 'masscomponent')!;
    const chute = body.children!.find((c) => c.type === 'parachute')!;
    expect(massc['mass']).toBeCloseTo(0.01 * 8); // k³
    expect(chute['mass']).toBeCloseTo(0.008 * 4); // k² (fabric)
  });

  it('is a no-op at 1× and for invalid factors (same tree object)', () => {
    const t = tree();
    expect(scaleRocket(t, 1)).toBe(t);
    expect(scaleRocket(t, 0)).toBe(t);
    expect(scaleRocket(t, -2)).toBe(t);
    expect(scaleRocket(t, NaN)).toBe(t);
  });

  it('does not mutate the input tree', () => {
    const t = tree();
    scaleRocket(t, 3);
    expect(t.components[0]!.children![0]!['length']).toBe(0.1);
  });

  it('measures max body diameter and core length', () => {
    const t = tree();
    expect(maxBodyDiameter(t)).toBeCloseTo(0.024); // 0.012 radius × 2
    expect(rocketLength(t)).toBeCloseTo(0.4); // 0.1 nose + 0.3 body
  });
});
