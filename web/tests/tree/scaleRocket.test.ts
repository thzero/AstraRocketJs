import { describe, it, expect } from 'vitest';
import type { RocketTree } from '../../src/engine/openRocketEngine';
import { KERNEL_DEFAULTS } from '../../src/tree/kernelDefaults';
import { scaleRocket, scalePart, hasExplicitMass, maxBodyDiameter, rocketLength } from '../../src/tree/scaleRocket';

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

  it("scales a mass component's mass by the cube, and no other part's `mass`", () => {
    const out = scaleRocket(tree(), 2);
    const body = out.components[0]!.children![1]!;
    const massc = body.children!.find((c) => c.type === 'masscomponent')!;
    const chute = body.children!.find((c) => c.type === 'parachute')!;
    // MassComponentScaler: getComponentMass() * pow3(2).
    expect(massc['mass']).toBeCloseTo(0.01 * 8, 15);
    // A parachute has no component mass in desktop, so nothing scales the key.
    expect(chute['mass']).toBe(0.008);
  });

  it("follows desktop's ScaleDialog where it leaves a value alone or cubes it", () => {
    // ScaleDialog registers no scaler for a parachute's spill hole or for the
    // instance separation of a ring or a lug (only RailButton's), skips a
    // SymmetricComponent's Thickness while isFilled, and OverrideScaler sets
    // getOverrideMass() * pow3(k) on every part, recovery gear included.
    const k = 3;
    const t: RocketTree = {
      name: 'desktop rules',
      components: [
        {
          type: 'stage',
          id: 's',
          children: [
            { type: 'nosecone', id: 'n', length: 0.1, aftRadius: 0.012, thickness: 0.002, filled: true },
            {
              type: 'bodytube',
              id: 'b',
              length: 0.3,
              outerRadius: 0.012,
              thickness: 0.001,
              children: [
                {
                  type: 'parachute',
                  id: 'p',
                  diameter: 0.4,
                  spillHoleDiameter: 0.05,
                  lineLength: 0.3,
                  overrideMass: 0.02,
                },
                { type: 'streamer', id: 'st', stripLength: 0.4, stripWidth: 0.05, overrideMass: 0.01 },
                { type: 'shockcord', id: 'sc', cordLength: 0.5, overrideMass: 0.004 },
                { type: 'centeringring', id: 'c', length: 0.003, instanceCount: 2, instanceSeparation: 0.04 },
                { type: 'bulkhead', id: 'bh', length: 0.005, instanceCount: 2, instanceSeparation: 0.03 },
                {
                  type: 'launchlug',
                  id: 'l',
                  length: 0.04,
                  outerRadius: 0.0022,
                  instanceCount: 2,
                  instanceSeparation: 0.06,
                },
                { type: 'railbutton', id: 'r', outerDiameter: 0.01, instanceCount: 2, instanceSeparation: 0.1 },
              ],
            },
          ],
        },
      ],
    } as unknown as RocketTree;
    const stage = scaleRocket(t, k).components[0]!;
    const nose = stage.children![0]!;
    const body = stage.children![1]!;
    const byId = (id: string) => body.children!.find((c) => c.id === id)!;
    expect(byId('p')['diameter']).toBeCloseTo(0.4 * k, 12);
    expect(byId('p')['lineLength']).toBeCloseTo(0.3 * k, 12);
    expect(byId('p')['spillHoleDiameter']).toBe(0.05);
    expect(byId('p')['overrideMass']).toBeCloseTo(0.02 * k ** 3, 15);
    expect(byId('st')['overrideMass']).toBeCloseTo(0.01 * k ** 3, 15);
    expect(byId('sc')['overrideMass']).toBeCloseTo(0.004 * k ** 3, 15);
    expect(byId('c')['instanceSeparation']).toBe(0.04);
    expect(byId('bh')['instanceSeparation']).toBe(0.03);
    expect(byId('l')['instanceSeparation']).toBe(0.06);
    expect(byId('l')['length']).toBeCloseTo(0.04 * k, 12);
    expect(byId('r')['instanceSeparation']).toBeCloseTo(0.1 * k, 12);
    expect(nose['thickness']).toBe(0.002);
    expect(nose['length']).toBeCloseTo(0.1 * k, 12);
    expect(body['thickness']).toBeCloseTo(0.001 * k, 12);
  });

  it('scales a recovery device’s packed length, not just its canopy', () => {
    // `length` on a parachute/streamer is the packed length - orkImport reads
    // <packedlength> straight into it - so it is the space the device needs in
    // the airframe. The shared fixture above declares no `length` on its chute,
    // so this case states one: unscaled, a 2x design would keep its 25 mm packed
    // length while the tube around it doubles.
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

  it('scales a launch lug in every dimension, as desktop does', () => {
    // Desktop's LaunchLug scalers take the outer radius, the wall and the
    // length, so the bore grows with the lug and a pinned mass goes as k^3.
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
              children: [
                {
                  type: 'launchlug',
                  id: 'l',
                  length: 0.04,
                  outerRadius: 0.0022,
                  thickness: 0.0003,
                  overrideMass: 0.001,
                },
              ],
            },
          ],
        },
      ],
    } as unknown as RocketTree;
    const lug = scaleRocket(t, 2).components[0]!.children![0]!.children![0]!;
    expect(lug['length']).toBeCloseTo(0.08);
    expect(lug['outerRadius']).toBeCloseTo(0.0044);
    expect(lug['thickness']).toBeCloseTo(0.0006);
    expect(lug['overrideMass']).toBeCloseTo(0.008);
  });

  it("scales the fields desktop's ScaleDialog scalers list: recovery radius, overhang, ring offsets, rail buttons", () => {
    const t: RocketTree = {
      name: 'scalers',
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
              motorOverhang: 0.01,
              children: [
                { type: 'parachute', id: 'p', radius: 0.008, radialPosition: 0.002 },
                { type: 'streamer', id: 'st', radius: 0.006, radiusAuto: true },
                { type: 'shockcord', id: 'sc', radius: 0.004 },
                { type: 'innertube', id: 'i', outerRadius: 0.009, motorOverhang: 0.005 },
                { type: 'centeringring', id: 'c', radialPosition: 0.001 },
                { type: 'bulkhead', id: 'bh', radialPosition: 0.001 },
                { type: 'tubecoupler', id: 'tc', radialPosition: 0.001 },
                { type: 'engineblock', id: 'e', radialPosition: 0.001 },
                {
                  type: 'railbutton',
                  id: 'r',
                  outerDiameter: 0.01,
                  innerDiameter: 0.006,
                  height: 0.008,
                  baseHeight: 0.002,
                  flangeHeight: 0.0015,
                  screwHeight: 0.003,
                  overrideMass: 0.002,
                },
              ],
            },
          ],
        },
      ],
    } as unknown as RocketTree;
    const body = scaleRocket(t, 2).components[0]!.children![0]!;
    const byId = (id: string) => body.children!.find((c) => c.id === id)!;
    expect(body['motorOverhang']).toBeCloseTo(0.02, 12);
    expect(byId('p')['radius']).toBeCloseTo(0.016, 12);
    expect(byId('p')['radialPosition']).toBeCloseTo(0.004, 12);
    // An automatic packed radius is the kernel's to resolve; desktop skips it.
    expect(byId('st')['radius']).toBe(0.006);
    expect(byId('sc')['radius']).toBeCloseTo(0.008, 12);
    expect(byId('i')['motorOverhang']).toBeCloseTo(0.01, 12);
    for (const id of ['c', 'bh', 'tc', 'e']) expect(byId(id)['radialPosition']).toBeCloseTo(0.002, 12);
    const rb = byId('r');
    expect(rb['outerDiameter']).toBeCloseTo(0.02, 12);
    expect(rb['innerDiameter']).toBeCloseTo(0.012, 12);
    expect(rb['height']).toBeCloseTo(0.016, 12);
    expect(rb['baseHeight']).toBeCloseTo(0.004, 12);
    expect(rb['flangeHeight']).toBeCloseTo(0.003, 12);
    // RailButtonScaler leaves the screw out.
    expect(rb['screwHeight']).toBe(0.003);
    // OverrideScaler takes every override mass by the cube.
    expect(rb['overrideMass']).toBeCloseTo(0.016, 12);
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

/** Desktop's Scale dialog choices: what to scale, and whether masses and positions follow. */
describe('scale options and scopes', () => {
  const mass = (t: RocketTree) => t.components[0]!.children![1]!.children![2]!;

  it('keeps positions and override CGs where they were with offsets off', () => {
    const t = tree();
    Object.assign(mass(t), { overrideCGX: 0.01, radialPosition: 0.004 });
    const out = mass(scaleRocket(t, 2, { offsets: false }));
    expect(out.position).toEqual({ method: 'top', offset: 0.05 });
    expect(out['overrideCGX']).toBe(0.01);
    expect(out['radialPosition']).toBe(0.004);
    expect(out['length']).toBe(0.04); // the size still scales
  });

  it('leaves typed masses alone with masses off', () => {
    const out = mass(scaleRocket(tree(), 2, { masses: false }));
    expect(out['mass']).toBe(0.01);
    expect(out['length']).toBe(0.04);
  });

  it('scales an override mass only with both masses and offsets on, as desktop does', () => {
    const t = tree();
    t.components[0]!.children![1]!['overrideMass'] = 0.1;
    const tube = (x: RocketTree) => x.components[0]!.children![1]!;
    expect(tube(scaleRocket(t, 2))['overrideMass']).toBeCloseTo(0.8, 12);
    expect(tube(scaleRocket(t, 2, { offsets: false }))['overrideMass']).toBe(0.1);
    expect(tube(scaleRocket(t, 2, { masses: false }))['overrideMass']).toBe(0.1);
  });
});

describe('scalePart', () => {
  const withIds = (): RocketTree => {
    const t = tree();
    t.components[0]!.children![1]!.id = 'tube';
    t.components[0]!.children![0]!.id = 'nose';
    return t;
  };

  it('scales the part and what is inside it, and nothing else', () => {
    const out = scalePart(withIds(), 'tube', 2, true);
    const [nose, tube] = out.components[0]!.children!;
    expect(nose!['length']).toBe(0.1);
    expect(tube!['length']).toBe(0.6);
    expect(tube!.children![0]!['rootChord']).toBe(0.1);
  });

  it('scales the part alone, leaving its children as they were', () => {
    const tube = scalePart(withIds(), 'tube', 2, false).components[0]!.children![1]!;
    expect(tube['length']).toBe(0.6);
    expect(tube.children![0]!['rootChord']).toBe(0.05);
  });

  it('returns the same tree for a missing part or a 1x factor', () => {
    const t = withIds();
    expect(scalePart(t, 'nope', 2, true)).toBe(t);
    expect(scalePart(t, 'tube', 1, true)).toBe(t);
  });
});

describe('hasExplicitMass', () => {
  it('finds a mass component or a mass override', () => {
    expect(hasExplicitMass(tree())).toBe(true);
    const bare: RocketTree = { components: [{ type: 'stage', children: [{ type: 'bodytube', length: 0.3 }] }] };
    expect(hasExplicitMass(bare)).toBe(false);
    bare.components[0]!['overrideMass'] = 0.2;
    expect(hasExplicitMass(bare)).toBe(true);
  });
});

describe('rocketLength with a member that has no length', () => {
  it('counts it at the kernel length for its type, as it is drawn and flown', () => {
    const tree = {
      components: [
        {
          type: 'stage',
          children: [
            { type: 'nosecone', length: 0.1 },
            { type: 'bodytube', outerRadius: 0.02 },
          ],
        },
      ],
    } as unknown as RocketTree;
    // The tube with no length counts at KERNEL_DEFAULTS.bodytube.length.
    expect(rocketLength(tree)).toBeCloseTo(0.1 + KERNEL_DEFAULTS.bodytube.length, 12);
  });
});

/**
 * A key a part leaves to the kernel flies the kernel's default (each row read
 * back from the kernel by kernelDefaults.kernel.test.ts), and desktop's scalers
 * scale the value that flies: RailButtonScaler the spacing, the MassObject
 * scalers a pack's radius and length.
 */
describe('scaling a key the part leaves to the kernel', () => {
  it("scales the kernel's value, as desktop's scalers do", async () => {
    const tree = {
      name: 'K',
      components: [
        {
          type: 'stage',
          id: 's',
          children: [
            {
              type: 'bodytube',
              id: 'b',
              length: 0.3,
              outerRadius: 0.02,
              thickness: 0.001,
              children: [
                { type: 'railbutton', id: 'rb', instanceCount: 2 },
                { type: 'parachute', id: 'p' },
              ],
            },
          ],
        },
      ],
    } as unknown as RocketTree;
    const kids = scaleRocket(tree, 2).components[0]!.children![0]!.children!;
    expect(kids[0]!['instanceSeparation']).toBeCloseTo(2 * KERNEL_DEFAULTS.railbutton.instanceSeparation, 12);
    expect(kids[1]!['radius']).toBeCloseTo(2 * KERNEL_DEFAULTS.parachute.radius, 12);
    expect(kids[1]!['length']).toBeCloseTo(2 * KERNEL_DEFAULTS.parachute.length, 12);
  });
});
