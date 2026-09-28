import { describe, it, expect } from 'vitest';
import type { RocketTree } from '../../src/engine/openRocketEngine';
import { scaleRocket, maxBodyDiameter, rocketLength } from '../../src/tree/scaleRocket';

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
            {
              type: 'trapezoidfinset',
              finCount: 3,
              rootChord: 0.05,
              tipChord: 0.03,
              sweep: 0.02,
              height: 0.03,
              thickness: 0.003,
            },
            {
              type: 'freeformfinset',
              finCount: 4,
              points: [
                [0, 0],
                [0.02, 0.03],
                [0.05, 0],
              ],
            },
            {
              type: 'masscomponent',
              mass: 0.01,
              length: 0.02,
              radius: 0.005,
              position: { method: 'top', offset: 0.05 },
            },
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
    expect(freeform!['points']).toEqual([
      [0, 0],
      [0.04, 0.06],
      [0.1, 0],
    ]);
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

  it('scales a recovery device’s packed length, not just its canopy', () => {
    // `length` on a parachute/streamer is the PACKED length - orkImport reads
    // <packedlength> straight into it - so it is the space the device needs in
    // the airframe. The shared fixture above declares no `length` on its chute,
    // which is why the whole suite could not see whether it scaled: a 2x design
    // kept a 25 mm packed length inside a 24 mm-bore tube.
    const t: RocketTree = {
      name: 'recovery',
      components: [
        {
          type: 'stage',
          children: [
            {
              type: 'bodytube',
              length: 0.3,
              outerRadius: 0.012,
              thickness: 0.001,
              children: [
                { type: 'parachute', diameter: 0.4, length: 0.025, lineLength: 0.5 },
                { type: 'streamer', stripLength: 0.4, stripWidth: 0.05, length: 0.02 },
              ],
            },
          ],
        },
      ],
    } as unknown as RocketTree;
    const kids = scaleRocket(t, 2).components[0]!.children![0]!.children!;
    const chute = kids.find((c) => c.type === 'parachute')!;
    const streamer = kids.find((c) => c.type === 'streamer')!;
    expect(chute['length']).toBeCloseTo(0.05);
    expect(chute['diameter']).toBeCloseTo(0.8);
    expect(chute['lineLength']).toBeCloseTo(1.0);
    expect(streamer['length']).toBeCloseTo(0.04);
    expect(streamer['stripLength']).toBeCloseTo(0.8);
  });

  it('scales a launch lug by the one dimension that actually grows', () => {
    // A lug's bore is the launch rod's diameter, so only its LENGTH scales.
    // Under the k^3 default a pinned 1 g lug came out at 8 g after a 2x scale,
    // and that error goes straight into the scaled design's mass and CG.
    const t: RocketTree = {
      name: 'lug',
      components: [
        {
          type: 'stage',
          id: 's',
          children: [
            {
              type: 'bodytube',
              id: 'b',
              length: 0.3,
              outerRadius: 0.012,
              children: [{ type: 'launchlug', id: 'l', length: 0.04, outerRadius: 0.0022, overrideMass: 0.001 }],
            },
          ],
        },
      ],
    } as unknown as RocketTree;
    const lug = scaleRocket(t, 2).components[0]!.children![0]!.children![0]!;
    expect(lug['length']).toBeCloseTo(0.08); // the one dimension that grows
    expect(lug['outerRadius']).toBeCloseTo(0.0022); // bore is the rod, unchanged
    expect(lug['overrideMass']).toBeCloseTo(0.002); // k^1, not k^3 (0.008)
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

describe('scaleRocket reads positions through positionOf', () => {
  it('normalizes a string offset to the kernel default instead of carrying it through', () => {
    const t = {
      components: [
        {
          type: 'stage',
          id: 's',
          children: [
            {
              type: 'bodytube',
              id: 'b',
              length: 0.2,
              children: [{ type: 'bulkhead', id: 'k', length: 0.002, position: { method: 'sideways', offset: '0.1' } }],
            },
          ],
        },
      ],
    } as unknown as RocketTree;
    const out = scaleRocket(t, 2);
    const k = out.components[0]!.children![0]!.children![0]!;
    // Unknown method and string offset both fall back to the kernel's top / 0
    // (nodeProps.positionOf), so the scaled tree is one the layout can read.
    expect(k.position).toEqual({ method: 'top', offset: 0 });
  });
});
