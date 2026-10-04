// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { exportOrk, importOrk, type OrkExportMotor } from '../../../src/services/files/orkFile';
import { specToTree } from '../../testing/specTree';
import {
  PLUGGED_DELAY,
  type RocketSpec,
  type ComponentNode,
  type RocketTree,
} from '../../../src/engine/openRocketEngine';
import type { DesignInfo } from '../../../src/services/files/orkTypes';
import { badDimensions } from '../../../src/services/design/requiredComponent';
import { updateNode } from '../../../src/services/design/treeEdit';

const spec = {
  noseCone: { length: 0.1, aftRadius: 0.013, thickness: 0.001 },
  bodyTube: { length: 0.2, outerRadius: 0.013, thickness: 0.0005 },
  fins: { count: 4, rootChord: 0.06, tipChord: 0.03, sweep: 0.03, height: 0.05, thickness: 0.003 },
  motorMount: { length: 0.07, outerRadius: 0.0092, thickness: 0.0004 },
  parachute: { diameter: 0.3 },
} as unknown as RocketSpec;

const motor: OrkExportMotor = { designation: 'C6', manufacturer: 'Estes', diameter: 0.018, length: 0.07, delay: 3 };

/** One unnamed flight configuration seating `motor` in `mountId` - what a
 *  single-mount design exports as. */
const loaded = (mountId: string, m: OrkExportMotor = motor) => [{ id: 'cfg-1', name: null, motors: { [mountId]: m } }];

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
  const xml = exportOrk({ name: 'Round Trip', tree, configs: loaded(mountId) });

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
      configs: [{ id: evil, name: null, motors: {} }],
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

  // Desktop's MotorHandler: an absent or unparseable <delay> is plugged, not 0 s.
  it.each([
    ['absent', ''],
    ['unparseable', '<delay>three</delay>'],
    ['blank', '<delay></delay>'],
  ])('imports a motor whose delay is %s as plugged', (_, replacement) => {
    expect(xml).toContain('<delay>3</delay>');
    const res = importOrk(xml.replace('<delay>3</delay>', replacement));
    expect(res.motor?.delay).toBe(PLUGGED_DELAY);
    expect(res.notes.join('\n')).toContain('the file gives no readable delay');
  });

  it('keeps a stated delay and a stated "none"', () => {
    expect(importOrk(xml).motor?.delay).toBe(3);
    const res = importOrk(xml.replace('<delay>3</delay>', '<delay>none</delay>'));
    expect(res.motor?.delay).toBe(PLUGGED_DELAY);
    expect(res.notes.join('\n')).not.toContain('the file gives no readable delay');
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
  const xml = exportOrk({ name: withMeta.name!, tree: withMeta, configs: loaded(mountId) });

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
    const out = exportOrk({ name: 'X', tree: evil, configs: loaded(mountId) });
    expect(out).not.toContain('<injected/>'); // the raw tag must never form
    expect(out).toContain('&lt;injected/&gt;'); // escaped instead
    expect(importOrk(out)).toBeTruthy(); // still valid XML
  });

  it('omits absent metadata and defaults design type to original', () => {
    const bare = exportOrk({ name: 'Bare', tree: { ...tree, name: 'Bare' }, configs: loaded(mountId) });
    expect(bare).not.toContain('<designer>');
    expect(bare).not.toContain('<revision>');
    expect(bare).toContain('<designtype>original</designtype>');
  });
});

describe('optional <designinfo> block', () => {
  const { tree, mountId } = specToTree(spec);

  it('is absent by default — a normal save is unchanged', () => {
    expect(exportOrk({ name: 'X', tree, configs: loaded(mountId) })).not.toContain('<designinfo>');
  });

  it('emits statistics and fin-set positions when provided', () => {
    const designInfo: DesignInfo = {
      groups: [
        { scope: 'rocket', stats: [{ field: 'Length', value: '0.425', unit: 'm' }] },
        { scope: 'stage', stageNumber: 1, name: 'Booster', stats: [{ field: 'CP', value: '0.331', unit: 'm' }] },
      ],
      finsets: [{ stageNumber: 0, stage: 'Sustainer', name: 'Trapezoidal fin set', topX: 0.35, bottomX: 0.4 }],
    };
    const out = exportOrk({ name: 'X', tree, configs: loaded(mountId), designInfo });
    expect(out).toContain('<designinfo>');
    expect(out).toContain('<statistics scope="rocket">');
    expect(out).toContain('<stat field="Length" value="0.425" unit="m"/>');
    expect(out).toContain('<statistics scope="stage" stagenumber="1" name="Booster">');
    expect(out).toContain('<finset stagenumber="0" stage="Sustainer" name="Trapezoidal fin set">');
    expect(out).toContain('<nosetoroottop unit="m">0.35</nosetoroottop>');
    expect(out).toContain('<nosetorootbottom unit="m">0.4</nosetorootbottom>');
    expect(importOrk(out)).toBeTruthy(); // still valid XML; the loader ignores it
  });

  it('escapes attributes so crafted stat/finset text cannot inject XML', () => {
    const designInfo: DesignInfo = {
      groups: [{ scope: 'rocket', stats: [{ field: 'x"><evil', value: '0', unit: '' }] }],
      finsets: [],
    };
    const out = exportOrk({ name: 'X', tree, configs: loaded(mountId), designInfo });
    expect(out).not.toContain('"><evil'); // the raw break-out must never form
    expect(out).toContain('&quot;&gt;&lt;evil'); // escaped instead
  });
});

describe('launch-lug / rail-button radial angle round-trips', () => {
  // A tree with a lug at 45° and a rail button at 90° around the body. Neither
  // may be overwritten with 180° on save.
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
    // A writer that hard-writes 0.0 collapses every tube onto the axis.
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
    // radialdirection, and the reader ignored both — so an off-centerline mass
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

  // Desktop loads and saves the pair on every RingComponent and MassObject.
  it.each(['parachute', 'streamer', 'shockcord', 'tubecoupler', 'centeringring', 'bulkhead', 'engineblock'])(
    'preserves an off-axis %s',
    (type) => {
      const withPart = {
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
                children: [{ type, id: 'part', length: 0.02, radialPosition: 0.006, radialDirection: Math.PI / 2 }],
              },
            ],
          },
        ],
      } as unknown as RocketTree;
      const xml = exportOrk({ name: 'Offset', tree: withPart });
      expect(xml).toContain('<radialdirection>90</radialdirection>');
      const part = findByType(importOrk(xml).tree, type) as { radialPosition?: number; radialDirection?: number };
      expect(part.radialPosition).toBeCloseTo(0.006, 9);
      expect(part.radialDirection).toBeCloseTo(Math.PI / 2, 9);
    },
  );
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
                drogue: true,
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

  /**
   * Which device is the drogue is what puts a flight on the kernel's
   * dual-deployment branch, so losing `<isdrogue>` here would quietly turn a
   * dual-deployment design back into a single-deployment one on reload.
   */
  it('preserves which device is the drogue', () => {
    const c = findByType(out.tree, 'parachute') as Record<string, unknown>;
    const s = findByType(out.tree, 'streamer') as Record<string, unknown>;
    expect(c.drogue).toBe(true);
    // Absent rather than false: the desktop omits the element for a main, and
    // the importer only sets the key when the file carries it.
    expect(s.drogue).toBeUndefined();
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
            foreShoulderThickness: 0.0007,
            foreShoulderCapped: true,
            aftShoulderLength: 0.018,
            aftShoulderRadius: 0.018,
            aftShoulderThickness: 0.0009,
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

  it('preserves each transition shoulder wall and cap, per side', () => {
    // The walls were read and written all along; the caps were not. The writer
    // emitted a hardcoded `false` for both sides, so a capped shoulder was
    // dropped on the way out and could not come back - and the two sides have
    // to stay apart, since the fore one here is capped and the aft one is not.
    const tr = findByType(out.tree, 'transition') as Record<string, unknown>;
    expect(tr.foreShoulderThickness).toBeCloseTo(0.0007, 6);
    expect(tr.aftShoulderThickness).toBeCloseTo(0.0009, 6);
    expect(tr.foreShoulderCapped).toBe(true);
    expect(tr.aftShoulderCapped).toBeUndefined();
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

/**
 * Automatic radii.
 *
 * Inner structure takes its outer radius from whatever it sits in, and a
 * centering ring takes its inner radius from the motor mount through it.
 * OpenRocket writes that as the sentinel `auto` rather than a number, and the
 * kernel recomputes it as the design changes.
 *
 * Both halves were broken and hid each other. The importer read the radii with
 * the plain number reader, so `auto` fell through to a fallback and the ring
 * arrived with NO radius — which `badDimensions` then called a zero dimension
 * and refused to fly, with "a required dimension is zero: Centering Ring". The
 * exporter hard-wrote `auto` for every ring, so a ring sized by hand exported as
 * automatic and came back the width of its body tube.
 */
describe('automatic ring radii round-trip', () => {
  const ringTree = (radii?: { outerRadius?: number; innerRadius?: number }) =>
    ({
      components: [
        {
          type: 'stage',
          id: 's1',
          children: [
            {
              type: 'bodytube',
              id: 'body',
              length: 0.3,
              outerRadius: 0.013,
              thickness: 0.0005,
              children: [
                { type: 'centeringring', id: 'ring', length: 0.003, ...(radii ?? {}) },
                { type: 'bulkhead', id: 'bh', length: 0.003, ...(radii ?? {}) },
                { type: 'tubecoupler', id: 'tc', length: 0.05, thickness: 0.0005, ...(radii ?? {}) },
                { type: 'engineblock', id: 'eb', length: 0.005, thickness: 0.001, ...(radii ?? {}) },
              ],
            },
          ],
        },
      ],
    }) as unknown as RocketTree;

  it('writes auto when the part carries no radius, as the desktop saver does', () => {
    const xml = exportOrk({ name: 'Auto', tree: ringTree() });
    expect(xml).toContain('<outerradius>auto</outerradius>');
    expect(xml).toContain('<innerradius>auto</innerradius>');
  });

  it('reads auto back as automatic, with the size it resolves to', () => {
    const out = importOrk(exportOrk({ name: 'Auto', tree: ringTree() }));
    const ring = findByType(out.tree, 'centeringring') as Record<string, unknown>;
    // A FLAG with the resolved number beside it, rather than an absent key.
    // Spelling automatic as absence leaves the panel showing 0 and the drawing on
    // a fallback while the kernel uses the real bore. The flag says it follows;
    // the number is what it currently is.
    expect(ring.outerRadiusAuto).toBe(true);
    expect(ring.innerRadiusAuto).toBe(true);
    expect(ring.outerRadius).toBeCloseTo(0.0125, 6); // the tube's bore
    expect(badDimensions(out.tree)).toEqual([]);
  });

  it('still writes auto on the way back out, not the number it resolved to', () => {
    // Otherwise a ring that FOLLOWS its tube would come back pinned to
    // whatever that tube happened to be when it was saved.
    const once = importOrk(exportOrk({ name: 'Auto', tree: ringTree() }));
    const twice = exportOrk({ name: 'Auto', tree: once.tree });
    expect(twice).toContain('<outerradius>auto</outerradius>');
    expect(twice).toContain('<innerradius>auto</innerradius>');
  });

  it('keeps a radius that was set by hand instead of flattening it to auto', () => {
    const xml = exportOrk({ name: 'Sized', tree: ringTree({ outerRadius: 0.0125, innerRadius: 0.009 }) });
    expect(xml).toContain('<outerradius>0.0125</outerradius>');
    expect(xml).toContain('<innerradius>0.009</innerradius>');

    const out = importOrk(xml);
    const ring = findByType(out.tree, 'centeringring') as Record<string, unknown>;
    expect(ring.outerRadius).toBeCloseTo(0.0125, 6);
    expect(ring.innerRadius).toBeCloseTo(0.009, 6);
    const coupler = findByType(out.tree, 'tubecoupler') as Record<string, unknown>;
    expect(coupler.outerRadius).toBeCloseTo(0.0125, 6);
  });

  it('a bulkhead gets no inner radius at all, being solid', () => {
    // RadiusRingComponentSaver skips the element for a Bulkhead.
    const xml = exportOrk({ name: 'Auto', tree: ringTree() });
    const bulkhead = xml.slice(xml.indexOf('<bulkhead>'), xml.indexOf('</bulkhead>'));
    expect(bulkhead).not.toContain('innerradius');
  });
});

/**
 * The fields a full audit against `DocumentConfig.java` found the writer
 * dropping, or the reader never looking at. Each one round-tripped in the file
 * or reached the kernel but not both, which is the state that looks supported
 * and is not.
 */
describe('audit round trips (2026-09-27)', () => {
  const tree = {
    name: 'Audit',
    components: [
      {
        type: 'stage',
        id: 's1',
        name: 'S',
        // A stage can be overridden like any other component. This block wrote
        // its own name and id instead of going through the shared header, so
        // the override flew and was dropped on the way out.
        overrideMass: 0.25,
        overrideSubcomponentsMass: true,
        children: [
          {
            type: 'nosecone',
            id: 'nc',
            shape: 'ogive',
            length: 0.1,
            aftRadius: 0.013,
            thickness: 0.001,
            flipped: true,
            color: '#ff8800',
            comment: 'Sanded to 400 grit & filled',
            lineStyle: 'dashed',
          },
          {
            type: 'bodytube',
            id: 'bt',
            length: 0.3,
            outerRadius: 0.013,
            thickness: 0.001,
            children: [
              { type: 'centeringring', id: 'cr', length: 0.003, instanceCount: 3, instanceSeparation: 0.05 },
              {
                type: 'masscomponent',
                id: 'mc',
                mass: 0.02,
                length: 0.03,
                radius: 0.009,
                massComponentType: 'altimeter',
                radialPosition: 0.004,
                radialDirection: 1.2,
              },
              { type: 'shockcord', id: 'sc', cordLength: 2.5, length: 0.02, radius: 0.008 },
              {
                type: 'railbutton',
                id: 'rb',
                outerDiameter: 0.0097,
                innerDiameter: 0.006,
                height: 0.012,
                baseHeight: 0.003,
                flangeHeight: 0.0025,
                screwHeight: 0.001,
              },
              {
                type: 'trapezoidfinset',
                id: 'fn',
                finCount: 3,
                rootChord: 0.06,
                tipChord: 0.03,
                height: 0.04,
                thickness: 0.003,
                crossSection: 'airfoil',
              },
            ],
          },
        ],
      },
    ],
  } as unknown as RocketTree;

  const out = importOrk(exportOrk({ name: 'Audit', tree }));
  const get = (type: string) => findByType(out.tree, type) as Record<string, unknown>;

  it('keeps a part color, which the writer never wrote at all', () => {
    expect(get('nosecone').color).toBe('#ff8800');
  });

  it('keeps a flipped nose cone, which was hardcoded false on the way out', () => {
    expect(get('nosecone').flipped).toBe(true);
  });

  it('keeps a stage-level override', () => {
    const stage = out.tree.components[0] as unknown as Record<string, unknown>;
    expect(stage.overrideMass).toBeCloseTo(0.25, 9);
    expect(stage.overrideSubcomponentsMass).toBe(true);
  });

  it('keeps repeated instances and their spacing', () => {
    expect(get('centeringring').instanceCount).toBe(3);
    expect(get('centeringring').instanceSeparation).toBeCloseTo(0.05, 9);
  });

  it('keeps what a mass component is, and where off the axis it sits', () => {
    expect(get('masscomponent').massComponentType).toBe('altimeter');
    expect(get('masscomponent').radialPosition).toBeCloseTo(0.004, 9);
    expect(get('masscomponent').radialDirection).toBeCloseTo(1.2, 6);
  });

  it('keeps a shock cord, which had no editable field until now', () => {
    expect(get('shockcord').cordLength).toBeCloseTo(2.5, 9);
    expect(get('shockcord').radius).toBeCloseTo(0.008, 9);
  });

  it('keeps the whole rail button, not just its outer diameter', () => {
    const rb = get('railbutton');
    expect(rb.innerDiameter).toBeCloseTo(0.006, 9);
    expect(rb.height).toBeCloseTo(0.012, 9);
    expect(rb.baseHeight).toBeCloseTo(0.003, 9);
    expect(rb.flangeHeight).toBeCloseTo(0.0025, 9);
    expect(rb.screwHeight).toBeCloseTo(0.001, 9);
  });

  it('keeps the fin cross-section', () => {
    expect(get('trapezoidfinset').crossSection).toBe('airfoil');
  });

  it('keeps a part comment, which was dropped on every save', () => {
    expect(get('nosecone').comment).toBe('Sanded to 400 grit & filled');
  });

  it('keeps the line style, which we do not draw but must not forget', () => {
    expect(get('nosecone').lineStyle).toBe('dashed');
  });
});

/**
 * The catalog link.
 *
 * The desktop shows which part a component is at the top of every config
 * dialog, and our picker is the same control, so the link is a fact about the
 * design. It was read nowhere and written nowhere, which is why a design that
 * came back from OpenRocket had forgotten every part it was built from.
 *
 * The half that matters is the DROPPING: a link that outlives the dimensions
 * labels a hand-sized tube with somebody's part number.
 */
describe('the catalog part a component came from', () => {
  /** A link as an imported desktop file carries one: with its digest. */
  const withPreset = (extra: Record<string, unknown> = {}) =>
    ({
      name: 'Preset',
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
              outerRadius: 0.0131,
              thickness: 0.00046,
              preset: {
                type: 'bodytube',
                manufacturer: 'Estes',
                partNo: 'BT-50, 30352',
                digest: 'a59dec8e4034a2fee5955dbf4ff07f1c',
                ...extra,
              },
            },
          ],
        },
      ],
    }) as unknown as RocketTree;

  it('survives a round trip', () => {
    const back = findByType(importOrk(exportOrk({ name: 'P', tree: withPreset() })).tree, 'bodytube');
    expect(back!['preset']).toMatchObject({
      type: 'bodytube',
      manufacturer: 'Estes',
      partNo: 'BT-50, 30352',
      digest: 'a59dec8e4034a2fee5955dbf4ff07f1c',
    });
  });

  it('is written the way the desktop writes it', () => {
    // The type is the kernel's enum constant, which is what `Type.valueOf`
    // parses: a file saying `type="bodytube"` names a type it does not have.
    // The digest and the attribute order are `RocketComponentSaver`'s own.
    const xml = exportOrk({ name: 'P', tree: withPreset() });
    expect(xml).toContain(
      '<preset type="BODY_TUBE" manufacturer="Estes" partno="BT-50, 30352" digest="a59dec8e4034a2fee5955dbf4ff07f1c"/>',
    );
  });

  it('is not written at all without a digest', () => {
    // The desktop rejects a preset element with no digest and says so in a
    // dialog, so a link our own catalog cannot digest stays out of the file
    // rather than costing every reader a warning about a part that loaded fine.
    const noDigest = withPreset({ digest: undefined });
    expect(exportOrk({ name: 'P', tree: noDigest })).not.toContain('<preset');
  });

  it('is dropped when a dimension it defines moves', () => {
    const edited = updateNode(withPreset(), 'bt', { outerRadius: 0.02 });
    expect(findByType(edited, 'bodytube')!['preset']).toBeUndefined();
  });

  it('is dropped when the material changes', () => {
    const edited = updateNode(withPreset(), 'bt', { materialName: 'Blue tube', density: 1100 });
    expect(findByType(edited, 'bodytube')!['preset']).toBeUndefined();
  });

  it('survives an edit that does not change what the part IS', () => {
    for (const patch of [{ name: 'Payload bay' }, { comment: 'from the spares box' }, { overrideMass: 0.05 }]) {
      expect(findByType(updateNode(withPreset(), 'bt', patch), 'bodytube')!['preset']).toBeDefined();
    }
  });
});
