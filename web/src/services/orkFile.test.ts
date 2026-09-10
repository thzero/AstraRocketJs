// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { exportOrk, importOrk, type OrkExportMotor } from './orkFile';
import { specToTree } from '../engine/api';
import type { RocketSpec, ComponentNode, RocketTree } from '../engine/openRocketEngine';

const spec = {
  noseCone: { length: 0.1, aftRadius: 0.013, thickness: 0.001 },
  bodyTube: { length: 0.2, outerRadius: 0.013, thickness: 0.0005 },
  fins: { count: 4, rootChord: 0.06, tipChord: 0.03, sweep: 0.03, height: 0.05, thickness: 0.003 },
  motorMount: { length: 0.07, outerRadius: 0.0092, thickness: 0.0004 },
  parachute: { diameter: 0.3 },
} as unknown as RocketSpec;

const motor: OrkExportMotor = { designation: 'C6', manufacturer: 'Estes', diameter: 0.018, length: 0.07, delay: 3 };

const findByType = (tree: RocketTree, type: string): ComponentNode | undefined => {
  const stack = [...tree.components];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.type === type) return n;
    if (n.children) stack.push(...n.children);
  }
  return undefined;
};

describe('exportOrk → importOrk round-trip', () => {
  const { tree, mountId } = specToTree(spec);
  const xml = exportOrk({ name: 'Round Trip', tree, mountId, motor });

  it('produces OpenRocket XML', () => {
    expect(typeof xml).toBe('string');
    expect(xml).toContain('<openrocket');
    expect(xml).toContain('<subcomponents>');
  });

  it('escapes a malicious flight-config id (no XML injection on export)', () => {
    const evil = 'x"><injected foo="bar';
    const out = exportOrk({
      name: 'Evil',
      tree,
      mountId,
      motor,
      configs: [{ id: evil, name: null, isDefault: true, motors: {}, deployments: {} }],
      activeConfigId: evil,
    });
    expect(out).not.toContain('<injected'); // the raw tag must never form
    expect(out).toContain('&lt;injected'); // escaped instead
    expect(importOrk(out)).toBeTruthy(); // still parses as valid XML
  });

  it('preserves the design name', () => {
    expect(importOrk(xml).name).toBe('Round Trip');
  });

  it('preserves the component structure through a round-trip', () => {
    const res = importOrk(xml);
    expect(findByType(res.tree, 'stage')).toBeDefined();
    expect(findByType(res.tree, 'nosecone')).toBeDefined();
    const body = findByType(res.tree, 'bodytube');
    expect(body).toBeDefined();
    const fins = findByType(res.tree, 'trapezoidfinset') as { finCount?: number } | undefined;
    expect(fins?.finCount).toBe(4);
    expect(findByType(res.tree, 'parachute')).toBeDefined();
  });

  it('preserves body-tube geometry within rounding', () => {
    const body = findByType(importOrk(xml).tree, 'bodytube') as { length?: number; outerRadius?: number };
    expect(body.length).toBeCloseTo(0.2, 6);
    expect(body.outerRadius).toBeCloseTo(0.013, 6);
  });

  it('round-trips the motor and reports notes as an array', () => {
    const res = importOrk(xml);
    expect(xml).toContain('C6');
    expect(Array.isArray(res.notes)).toBe(true);
  });

  it('accepts its own output as a bare XML string (no zip)', () => {
    expect(() => importOrk(xml)).not.toThrow();
  });
});

describe('design metadata (Rocket configuration) round-trip', () => {
  const { tree, mountId } = specToTree(spec);
  const withMeta: RocketTree = {
    ...tree,
    name: 'Meta Rocket',
    designer: 'Ada Lovelace',
    comment: 'Best F motor.\nTwo 2-56 nylon screws → 42.8 lb shear.',
    revision: 'v3 — moved the CP forward',
    designType: 'upscale_kit',
  };
  const xml = exportOrk({ name: withMeta.name!, tree: withMeta, mountId, motor });

  it('emits the metadata elements (only what is set)', () => {
    expect(xml).toContain('<designer>Ada Lovelace</designer>');
    expect(xml).toContain('<revision>v3 — moved the CP forward</revision>');
    expect(xml).toContain('<designtype>upscale_kit</designtype>');
    expect(xml).toContain('Best F motor.'); // comment body present
  });

  it('imports the metadata back onto the tree', () => {
    const res = importOrk(xml);
    expect(res.tree.designer).toBe('Ada Lovelace');
    expect(res.tree.comment).toContain('42.8 lb shear');
    expect(res.tree.revision).toBe('v3 — moved the CP forward');
    expect(res.tree.designType).toBe('upscale_kit');
  });

  it('escapes metadata so a crafted comment cannot inject XML', () => {
    const evil: RocketTree = { ...tree, name: 'X', comment: '</comment><injected/>' };
    const out = exportOrk({ name: 'X', tree: evil, mountId, motor });
    expect(out).not.toContain('<injected/>'); // the raw tag must never form
    expect(out).toContain('&lt;injected/&gt;'); // escaped instead
    expect(importOrk(out)).toBeTruthy(); // still valid XML
  });

  it('omits absent metadata and defaults design type to original', () => {
    const bare = exportOrk({ name: 'Bare', tree: { ...tree, name: 'Bare' }, mountId, motor });
    expect(bare).not.toContain('<designer>');
    expect(bare).not.toContain('<revision>');
    expect(bare).toContain('<designtype>original</designtype>');
  });
});

describe('launch-lug / rail-button radial angle round-trips', () => {
  // A tree with a lug at 45° and a rail button at 90° around the body. These
  // used to be silently overwritten with 180° on every save.
  const tree = {
    components: [
      {
        type: 'stage',
        name: 'Sustainer',
        id: 's1',
        children: [
          {
            type: 'bodytube',
            id: 'body',
            length: 0.3,
            outerRadius: 0.013,
            thickness: 0.0005,
            children: [
              {
                type: 'launchlug',
                id: 'lug',
                length: 0.03,
                outerRadius: 0.0022,
                angleOffset: Math.PI / 4,
                position: { method: 'middle', offset: 0 },
              },
              {
                type: 'railbutton',
                id: 'btn',
                outerDiameter: 0.0097,
                angleOffset: Math.PI / 2,
                position: { method: 'middle', offset: 0 },
              },
            ],
          },
        ],
      },
    ],
  } as unknown as RocketTree;

  it('loads a design with external pods (podset) and round-trips it', () => {
    const podBody = '<bodytube><length>0.12</length><radius>0.009</radius><thickness>0.0005</thickness></bodytube>';
    const withPod =
      '<openrocket><rocket><name>P</name><subcomponents><stage><name>S</name><subcomponents>' +
      '<bodytube><length>0.3</length><radius>0.013</radius><thickness>0.0005</thickness><subcomponents>' +
      '<podset><name>Pod</name><instancecount>3</instancecount>' +
      '<radiusoffset method="relative">0.005</radiusoffset><angleoffset method="relative">90.0</angleoffset>' +
      `<subcomponents>${podBody}</subcomponents></podset>` +
      '</subcomponents></bodytube></subcomponents></stage></subcomponents></rocket></openrocket>';
    const res = importOrk(withPod);
    const pod = findByType(res.tree, 'podset');
    expect(pod).toBeDefined();
    expect(pod!.instanceCount).toBe(3);
    expect(pod!.radiusOffset).toBeCloseTo(0.005, 6);
    expect(pod!.radiusMethod).toBe('relative');
    expect(pod!.angleOffset).toBeCloseTo(Math.PI / 2, 6); // 90° → radians
    expect(findByType({ components: pod!.children ?? [] } as RocketTree, 'bodytube')).toBeDefined();

    // Export → re-import keeps the pod and its placement (round-trip).
    const back = importOrk(exportOrk({ name: 'P', tree: res.tree }));
    const pod2 = findByType(back.tree, 'podset');
    expect(pod2).toBeDefined();
    expect(pod2!.instanceCount).toBe(3);
    expect(pod2!.radiusOffset).toBeCloseTo(0.005, 6);
    expect(pod2!.angleOffset).toBeCloseTo(Math.PI / 2, 6);
  });

  it('loads a multi-stage (axial) design — both stages present', () => {
    const tube = '<bodytube><length>0.2</length><radius>0.013</radius><thickness>0.0005</thickness></bodytube>';
    const twoStage =
      '<openrocket><rocket><name>Two</name><subcomponents>' +
      `<stage><name>Sustainer</name><subcomponents>${tube}</subcomponents></stage>` +
      `<stage><name>Booster</name><subcomponents>${tube}</subcomponents></stage>` +
      '</subcomponents></rocket></openrocket>';
    const res = importOrk(twoStage);
    const stages = res.tree.components.filter((n) => n.type === 'stage');
    expect(stages).toHaveLength(2);
    expect(stages.map((s) => s.name)).toEqual(['Sustainer', 'Booster']);
  });

  it('preserves the lug and button angle through export → import', () => {
    const out = importOrk(exportOrk({ name: 'Lugs', tree }));
    // ids are regenerated on import, so match by type.
    const lug = findByType(out.tree, 'launchlug') as { angleOffset?: number } | undefined;
    const btn = findByType(out.tree, 'railbutton') as { angleOffset?: number } | undefined;
    expect(lug?.angleOffset).toBeCloseTo(Math.PI / 4, 6);
    expect(btn?.angleOffset).toBeCloseTo(Math.PI / 2, 6);
  });

  it('preserves a fin-set cant angle through export → import', () => {
    const canted = {
      components: [
        {
          type: 'stage',
          name: 'Sustainer',
          id: 's1',
          children: [
            {
              type: 'bodytube',
              id: 'body',
              length: 0.3,
              outerRadius: 0.013,
              thickness: 0.0005,
              children: [
                {
                  type: 'trapezoidfinset',
                  id: 'fins',
                  finCount: 3,
                  rootChord: 0.06,
                  tipChord: 0.03,
                  sweep: 0.03,
                  height: 0.05,
                  thickness: 0.003,
                  cant: Math.PI / 36, // 5°
                  position: { method: 'bottom', offset: 0 },
                },
              ],
            },
          ],
        },
      ],
    } as unknown as RocketTree;
    const fins = findByType(importOrk(exportOrk({ name: 'Cant', tree: canted })).tree, 'trapezoidfinset') as {
      cant?: number;
    };
    expect(fins.cant).toBeCloseTo(Math.PI / 36, 6);
  });

  it('preserves a split-cluster inner tube radial offset through export → import', () => {
    // A split cluster is single tubes carrying radialPosition (m) + radialDirection (rad).
    // Regression: the writer used to hard-write 0.0, collapsing every tube onto the axis.
    const clustered = {
      components: [
        {
          type: 'stage',
          name: 'Sustainer',
          id: 's1',
          children: [
            {
              type: 'bodytube',
              id: 'body',
              length: 0.3,
              outerRadius: 0.026,
              thickness: 0.0005,
              children: [
                {
                  type: 'innertube',
                  id: 'mount',
                  length: 0.07,
                  outerRadius: 0.0095,
                  thickness: 0.0005,
                  radialPosition: 0.012,
                  radialDirection: Math.PI / 3, // 60°
                  position: { method: 'bottom', offset: 0 },
                },
              ],
            },
          ],
        },
      ],
    } as unknown as RocketTree;
    const tube = findByType(importOrk(exportOrk({ name: 'Cluster', tree: clustered })).tree, 'innertube') as {
      radialPosition?: number;
      radialDirection?: number;
    };
    expect(tube.radialPosition).toBeCloseTo(0.012, 6);
    expect(tube.radialDirection).toBeCloseTo(Math.PI / 3, 6);
  });

  it('preserves an off-axis mass component radial offset through export → import', () => {
    // Regression: the writer hard-wrote radialposition 0.0 and never emitted a
    // radialdirection, and the reader ignored both — so an off-centreline mass
    // (ballast, altimeter) snapped back onto the axis on every save/load.
    const withMass = {
      components: [
        {
          type: 'stage',
          name: 'Sustainer',
          id: 's1',
          children: [
            {
              type: 'bodytube',
              id: 'body',
              length: 0.3,
              outerRadius: 0.026,
              thickness: 0.0005,
              children: [
                {
                  type: 'masscomponent',
                  id: 'ballast',
                  length: 0.02,
                  mass: 0.05,
                  radialPosition: 0.018,
                  radialDirection: Math.PI / 4, // 45°
                  position: { method: 'top', offset: 0.01 },
                },
              ],
            },
          ],
        },
      ],
    } as unknown as RocketTree;
    const mass = findByType(importOrk(exportOrk({ name: 'Mass', tree: withMass })).tree, 'masscomponent') as {
      radialPosition?: number;
      radialDirection?: number;
    };
    expect(mass.radialPosition).toBeCloseTo(0.018, 6);
    expect(mass.radialDirection).toBeCloseTo(Math.PI / 4, 6);
  });
});

describe('recovery-device features round-trip', () => {
  const tree = {
    components: [
      {
        type: 'stage',
        name: 'Sustainer',
        id: 's1',
        children: [
          {
            type: 'bodytube',
            id: 'body',
            length: 0.3,
            outerRadius: 0.013,
            thickness: 0.0005,
            children: [
              {
                type: 'parachute',
                id: 'chute',
                diameter: 0.5,
                cd: 0.9,
                lineCount: 8,
                lineLength: 0.45,
                surfaceMaterialName: 'Ripstop nylon',
                surfaceDensity: 0.067,
                lineMaterialName: 'Braided nylon (2 mm, 1/16 in)',
                lineDensity: 0.001,
                deployEvent: 'apogee',
                deployAltitude: 200,
                deployDelay: 0,
                position: { method: 'top', offset: 0.02 },
              },
              {
                type: 'streamer',
                id: 'strmr',
                stripLength: 0.9,
                stripWidth: 0.07,
                cd: 0.55,
                surfaceMaterialName: 'Mylar',
                surfaceDensity: 0.021,
                deployEvent: 'apogee',
                deployAltitude: 200,
                deployDelay: 0,
                position: { method: 'top', offset: 0.1 },
              },
            ],
          },
        ],
      },
    ],
  } as unknown as RocketTree;

  const out = importOrk(exportOrk({ name: 'Recovery', tree }));

  it('preserves parachute Cd, shroud lines, and canopy/line materials', () => {
    const c = findByType(out.tree, 'parachute') as Record<string, unknown>;
    expect(c.cd).toBeCloseTo(0.9, 6);
    expect(c.lineCount).toBe(8);
    expect(c.lineLength).toBeCloseTo(0.45, 6);
    expect(c.surfaceDensity).toBeCloseTo(0.067, 6);
    expect(c.lineDensity).toBeCloseTo(0.001, 6);
  });

  it('preserves streamer strip dimensions, Cd, and strip material', () => {
    const s = findByType(out.tree, 'streamer') as Record<string, unknown>;
    expect(s.stripLength).toBeCloseTo(0.9, 6);
    expect(s.stripWidth).toBeCloseTo(0.07, 6);
    expect(s.cd).toBeCloseTo(0.55, 6);
    expect(s.surfaceDensity).toBeCloseTo(0.021, 6);
  });
});

describe('newly-editable component options round-trip', () => {
  const tree = {
    components: [
      {
        type: 'stage',
        id: 's1',
        name: 'S',
        children: [
          {
            type: 'nosecone',
            id: 'nc',
            shape: 'ogive',
            length: 0.1,
            aftRadius: 0.013,
            thickness: 0.001,
            shoulderLength: 0.02,
            shoulderRadius: 0.011,
            shoulderThickness: 0.0008,
            shoulderCapped: true,
          },
          {
            type: 'transition',
            id: 'tr',
            shape: 'conical',
            length: 0.05,
            foreRadius: 0.013,
            aftRadius: 0.019,
            thickness: 0.0005,
            foreShoulderLength: 0.015,
            foreShoulderRadius: 0.012,
            aftShoulderLength: 0.018,
            aftShoulderRadius: 0.018,
            position: { method: 'bottom', offset: 0 },
          },
          {
            type: 'bodytube',
            id: 'bt',
            length: 0.3,
            outerRadius: 0.013,
            thickness: 0.0005,
            motorMount: true,
            motorOverhang: 0.01,
            children: [
              {
                type: 'trapezoidfinset',
                id: 'fin',
                finCount: 3,
                rootChord: 0.06,
                tipChord: 0.03,
                sweep: 0.03,
                height: 0.05,
                thickness: 0.003,
                tabHeight: 0.02,
                tabLength: 0.04,
                tabOffset: 0,
                tabOffsetMethod: 'top',
                position: { method: 'bottom', offset: 0 },
              },
              {
                type: 'engineblock',
                id: 'eb',
                length: 0.005,
                outerRadius: 0.0092,
                thickness: 0.0007,
                position: { method: 'bottom', offset: 0 },
              },
            ],
          },
        ],
      },
    ],
  } as unknown as RocketTree;

  const out = importOrk(exportOrk({ name: 'Feat', tree }));

  it('preserves nose-cone shoulder (length/radius/thickness/capped)', () => {
    const nc = findByType(out.tree, 'nosecone') as Record<string, unknown>;
    expect(nc.shoulderLength).toBeCloseTo(0.02, 6);
    expect(nc.shoulderRadius).toBeCloseTo(0.011, 6);
    expect(nc.shoulderThickness).toBeCloseTo(0.0008, 6);
    expect(nc.shoulderCapped).toBe(true);
  });

  it('preserves transition fore/aft shoulders', () => {
    const tr = findByType(out.tree, 'transition') as Record<string, unknown>;
    expect(tr.foreShoulderLength).toBeCloseTo(0.015, 6);
    expect(tr.foreShoulderRadius).toBeCloseTo(0.012, 6);
    expect(tr.aftShoulderLength).toBeCloseTo(0.018, 6);
    expect(tr.aftShoulderRadius).toBeCloseTo(0.018, 6);
  });

  it('preserves the body-tube motor-mount flag + overhang', () => {
    const bt = findByType(out.tree, 'bodytube') as Record<string, unknown>;
    expect(bt.motorMount).toBe(true);
    expect(bt.motorOverhang).toBeCloseTo(0.01, 6);
  });

  it('preserves the fin tab (height/length/reference)', () => {
    const fin = findByType(out.tree, 'trapezoidfinset') as Record<string, unknown>;
    expect(fin.tabHeight).toBeCloseTo(0.02, 6);
    expect(fin.tabLength).toBeCloseTo(0.04, 6);
    expect(fin.tabOffsetMethod).toBe('top');
  });

  it('preserves the engine-block wall thickness', () => {
    const eb = findByType(out.tree, 'engineblock') as Record<string, unknown>;
    expect(eb.thickness).toBeCloseTo(0.0007, 6);
  });

  it('preserves a freeform fin outline (points) through a round-trip', () => {
    const t = {
      components: [
        {
          type: 'stage',
          id: 's1',
          name: 'S',
          children: [
            {
              type: 'bodytube',
              id: 'bt',
              length: 0.3,
              outerRadius: 0.013,
              thickness: 0.0005,
              children: [
                {
                  type: 'freeformfinset',
                  id: 'ff',
                  finCount: 4,
                  thickness: 0.003,
                  points: [
                    [0, 0],
                    [0.03, 0.06],
                    [0.07, 0.04],
                    [0.08, 0],
                  ],
                  position: { method: 'bottom', offset: 0 },
                },
              ],
            },
          ],
        },
      ],
    } as unknown as RocketTree;
    const ff = findByType(importOrk(exportOrk({ name: 'FF', tree: t })).tree, 'freeformfinset') as Record<
      string,
      unknown
    >;
    const pts = ff.points as [number, number][];
    expect(pts).toHaveLength(4);
    expect(pts[1]![0]).toBeCloseTo(0.03, 6);
    expect(pts[1]![1]).toBeCloseTo(0.06, 6);
    expect(pts[3]![0]).toBeCloseTo(0.08, 6);
  });
});
