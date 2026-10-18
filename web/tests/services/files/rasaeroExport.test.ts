// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { RocketTree } from '../../../src/engine/openRocketEngine';
import { exportCdx1 } from '../../../src/services/files/rasaeroExport';
import { stageEngineSlots } from '../../../src/services/files/rasaero/engines';
import { KERNEL_DEFAULTS } from '../../../src/tree/kernelDefaults';
import {
  rasaeroSurface,
  RASAERO_SURFACE_DEFAULT,
  RASAERO_SURFACE_WARNING,
} from '../../../src/services/files/rasaero/surface';
import type { Keyed } from '../../../src/i18n/keyedError';

// A 1-inch-diameter rocket with clean-inch geometry so the meter→inch (×39.37)
// conversions land on round numbers the assertions can pin exactly.
const tree: RocketTree = {
  name: 'Test Bird',
  components: [
    {
      type: 'stage',
      name: 'Sustainer',
      children: [
        { type: 'nosecone', id: 'nc', length: 0.1, aftRadius: 0.0127, shape: 'ogive', thickness: 0.001 },
        {
          type: 'bodytube',
          id: 'bt',
          length: 0.254, // 10 in
          outerRadius: 0.0127, // 1 in dia
          children: [
            {
              type: 'trapezoidfinset',
              id: 'fin',
              finCount: 3,
              rootChord: 0.0508, // 2 in
              tipChord: 0.0254, // 1 in
              sweep: 0.0254, // 1 in
              height: 0.0254, // 1 in span
              thickness: 0.003,
              position: { method: 'bottom', offset: 0 },
            },
            {
              type: 'launchlug',
              id: 'lug',
              length: 0.0254,
              outerRadius: 0.002,
              position: { method: 'middle', offset: 0 },
            },
          ],
        },
      ],
    },
  ],
};

describe('exportCdx1', () => {
  const xml = exportCdx1({ tree, name: 'Test Bird', launchMassKg: 0.45359237, launchCgM: 0.127 });

  it('is well-formed XML rooted at RASAeroDocument (FileVersion 2)', () => {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.querySelector('RASAeroDocument > FileVersion')?.textContent).toBe('2');
    expect(doc.querySelector('RASAeroDocument > RocketDesign')).not.toBeNull();
  });

  it('writes the nose cone with mapped shape and inch diameter', () => {
    expect(xml).toContain('<Shape>Tangent Ogive</Shape>');
    // aftRadius 0.0127 m → diameter 0.0254 m → 1 in.
    expect(xml).toMatch(/<NoseCone>[\s\S]*?<Diameter>1<\/Diameter>/);
  });

  it('writes the body tube with the launch lug and its fin set', () => {
    expect(xml).toMatch(/<BodyTube>[\s\S]*?<LaunchLugLength>1<\/LaunchLugLength>/);
    expect(xml).toContain('<Count>3</Count>');
    expect(xml).toContain('<Chord>2</Chord>'); // rootChord 2 in
    expect(xml).toContain('<Span>1</Span>'); // height 1 in
    expect(xml).toContain('<TipChord>1</TipChord>');
  });

  it('fills the mandatory simulation block with loaded weight (lb) and CG (in)', () => {
    // 0.45359237 kg → 1.000 lb; 0.127 m → 5 in.
    expect(xml).toContain('<SustainerLaunchWt>1</SustainerLaunchWt>');
    expect(xml).toContain('<SustainerCG>5</SustainerCG>');
    expect(xml).toContain('</SimulationList>');
  });

  // An absolute station is from the nose tip: 0.1 of nose plus the 0.254 tube,
  // less the 0.0508 root, is the same fin set flush with the tube's aft end.
  it('places an absolute fin set by its station from the nose tip', () => {
    const at = (position: object): string => {
      const t = structuredClone(tree);
      t.components[0]!.children![1]!.children![0]!.position = position as never;
      const out = exportCdx1({ tree: t, name: 'Test Bird' });
      return /<Fin>[\s\S]*?<Location>([^<]*)<\/Location>/.exec(out)![1]!;
    };
    expect(at({ method: 'absolute', offset: 0.1 + 0.254 - 0.0508 })).toBe(at({ method: 'bottom', offset: 0 }));
    expect(at({ method: 'absolute', offset: 0.1 })).toBe(at({ method: 'top', offset: 0 }));
  });

  it('rejects a design RASAero cannot represent (tube fins)', () => {
    const bad: RocketTree = {
      components: [
        {
          type: 'stage',
          children: [
            { type: 'bodytube', length: 0.2, outerRadius: 0.012, children: [{ type: 'tubefinset', finCount: 4 }] },
          ],
        },
      ],
    };
    expect(() => exportCdx1({ tree: bad, name: 'bad' })).toThrow(/RASAero/);
  });
});

/**
 * The surface table is the desktop's RASAeroCommonConstants
 * .OPENROCKET_TO_RASAERO_SURFACE (lines 370-391), row for row. It does not send
 * `polished` to Sheet Metal, `smooth` to Smooth Paint or `rough` to Cast Iron,
 * and it lets ROUGH and POLISHED fall to its default with a warning.
 */
describe('finish to RASAero surface (desktop table)', () => {
  it.each([
    ['mirror', 'Smooth (Zero Roughness)'],
    ['finishpolished', 'Polished'],
    ['optimum', 'Sheet Metal'],
    ['smooth', 'Camouflage Paint'],
    ['normal', 'Rough Camouflage Paint'],
    ['unfinished', 'Galvanized Metal'],
    ['roughunfinished', 'Cast Iron (Very Rough)'],
  ])('%s maps to %s without a warning', (finish, surface) => {
    expect(rasaeroSurface(finish)).toEqual({ surface });
  });

  it.each(['rough', 'polished', 'nosuchfinish'])('%s falls to Smooth with the desktop warning', (finish) => {
    const r = rasaeroSurface(finish);
    expect(r.surface).toBe(RASAERO_SURFACE_DEFAULT);
    expect(r.warning).toEqual(RASAERO_SURFACE_WARNING);
  });

  const withFinish = (finish: string | undefined): RocketTree => ({
    components: [
      {
        type: 'stage',
        children: [
          { type: 'nosecone', id: 'nc', length: 0.1, aftRadius: 0.0127, shape: 'ogive', ...(finish ? { finish } : {}) },
          { type: 'bodytube', id: 'bt', length: 0.254, outerRadius: 0.0127 },
        ],
      },
    ],
  });

  it('takes the global surface from the first nose cone, as RocketDesignDTO does', () => {
    expect(exportCdx1({ tree: withFinish('optimum'), name: 'x' })).toContain('<Surface>Sheet Metal</Surface>');
    // No finish key is the kernel's NORMAL.
    expect(exportCdx1({ tree: withFinish(undefined), name: 'x' })).toContain(
      '<Surface>Rough Camouflage Paint</Surface>',
    );
  });

  it('collects the warning for a finish with no row', () => {
    const warnings: Keyed[] = [];
    const xml = exportCdx1({ tree: withFinish('rough'), name: 'x', launchMassKg: 0.45, launchCgM: 0.12, warnings });
    expect(xml).toContain('<Surface>Smooth (Zero Roughness)</Surface>');
    expect(warnings).toEqual([RASAERO_SURFACE_WARNING]);
  });
});

/**
 * An assembly in the sustainer chain is not skipped like an internal part. A pod or
 * a strap-on booster is external aerodynamics, and a file that quietly omits it
 * describes a different rocket (the desktop refuses them, RASAeroExport.error33).
 */
describe('assemblies RASAero cannot hold', () => {
  const withAssembly = (type: 'podset' | 'parallelstage'): RocketTree => ({
    components: [
      {
        type: 'stage',
        children: [
          { type: 'nosecone', id: 'nc', length: 0.1, aftRadius: 0.0127, shape: 'ogive' },
          { type: 'bodytube', id: 'bt', length: 0.254, outerRadius: 0.0127 },
          { type, id: 'asm', name: 'Side pod', children: [{ type: 'bodytube', length: 0.1, outerRadius: 0.005 }] },
        ],
      },
    ],
  });

  it('refuses a pod set by name rather than dropping it', () => {
    expect(() => exportCdx1({ tree: withAssembly('podset'), name: 'x' })).toThrow(/pods.*Side pod/);
  });

  it('refuses a parallel stage by name rather than dropping it', () => {
    expect(() => exportCdx1({ tree: withAssembly('parallelstage'), name: 'x' })).toThrow(/strap-on.*Side pod/);
  });
});

describe('rail button as RASAero rail guide', () => {
  const withButton = (button: Record<string, unknown> | null): RocketTree => ({
    components: [
      {
        type: 'stage',
        children: [
          { type: 'nosecone', id: 'nc', length: 0.1, aftRadius: 0.0127, shape: 'ogive' },
          {
            type: 'bodytube',
            id: 'bt',
            length: 0.254,
            outerRadius: 0.0127,
            children: button ? [{ type: 'railbutton', id: 'rb', ...button }] : [],
          },
        ],
      },
    ],
  });

  it('writes the outer diameter and total height in inches', () => {
    // 0.0127 m is 0.5 in; 0.0254 m is 1 in.
    const xml = exportCdx1({ tree: withButton({ outerDiameter: 0.0127, height: 0.0254 }), name: 'x' });
    expect(xml).toContain('<RailGuideDiameter>0.5</RailGuideDiameter>');
    expect(xml).toContain('<RailGuideHeight>1</RailGuideHeight>');
  });

  it('falls back to the desktop button size for a bare node, and 0 with no button', () => {
    const xml = exportCdx1({ tree: withButton({}), name: 'x' });
    expect(xml).toContain(`<RailGuideDiameter>${(0.0097 * 39.37).toFixed(4).replace(/0+$/, '')}</RailGuideDiameter>`);
    expect(xml).toContain(`<RailGuideHeight>${(0.0097 * 39.37).toFixed(4).replace(/0+$/, '')}</RailGuideHeight>`);
    const none = exportCdx1({ tree: withButton(null), name: 'x' });
    expect(none).toContain('<RailGuideDiameter>0</RailGuideDiameter>');
    expect(none).toContain('<RailGuideHeight>0</RailGuideHeight>');
  });
});

/**
 * A non-finite number never reaches the file as text. A bare
 * `typeof === 'number'` check would let a NaN or Infinity on a node through, and
 * the writer would print "NaN" into the .CDX1. The shared `num` rejects it and
 * falls back, as every other reader does.
 */
describe('a non-finite dimension', () => {
  it('is never written as NaN or Infinity', () => {
    const bad = structuredClone(tree);
    const body = bad.components[0]!.children![1]!;
    body['length'] = Number.NaN;
    body['outerRadius'] = Number.POSITIVE_INFINITY;
    const out = exportCdx1({ tree: bad, name: 'bad', launchMassKg: 0.45, launchCgM: 0.127 });
    expect(out).not.toMatch(/NaN|Infinity/);
  });
});

/**
 * A trapezoid fin with no sweep key exports the kernel's default sweep
 * (`KERNEL_DEFAULTS.trapezoidfinset.sweep`), which is what the engine flies for that node.
 */
describe('a trapezoid fin with no sweep key', () => {
  it('writes the kernel default sweep', () => {
    const bare = structuredClone(tree);
    const fin = bare.components[0]!.children![1]!.children![0]!;
    delete fin['sweep'];
    const out = exportCdx1({ tree: bare, name: 'bare', launchMassKg: 0.45, launchCgM: 0.127 });
    expect(out).toContain(
      `<SweepDistance>${(KERNEL_DEFAULTS.trapezoidfinset.sweep * 39.37).toFixed(4).replace(/0+$/, '')}</SweepDistance>`,
    );
  });
});

/**
 * The sustainer order rules the desktop's RocketDesignDTO enforces: a nose cone
 * first and nowhere else, never flipped, then a body tube or a closing
 * transition; a single-stage rocket's closing transition is a boat tail.
 */
describe('sustainer part order', () => {
  const nose = { type: 'nosecone', id: 'nc', name: 'Nose', length: 0.1, aftRadius: 0.0127, shape: 'ogive' };
  const tube = { type: 'bodytube', id: 'bt', name: 'Body', length: 0.254, outerRadius: 0.0127 };
  const tail = {
    type: 'transition',
    id: 'tr',
    name: 'Tail',
    length: 0.03,
    foreRadius: 0.0127,
    aftRadius: 0.009,
    shape: 'conical',
  };
  const one = (children: Record<string, unknown>[]): RocketTree =>
    ({ components: [{ type: 'stage', children }] }) as unknown as RocketTree;

  it('refuses a chain that does not start with a nose cone', () => {
    expect(() => exportCdx1({ tree: one([tube, nose]), name: 'x' })).toThrow(/start with a nose cone.*Body/);
  });

  it('refuses a second nose cone further down', () => {
    const tailCone = { ...nose, id: 'nc2', name: 'Tail cone' };
    expect(() => exportCdx1({ tree: one([nose, tube, tailCone]), name: 'x' })).toThrow(
      /only as the first part.*Tail cone/,
    );
  });

  it('refuses a flipped nose cone', () => {
    expect(() => exportCdx1({ tree: one([{ ...nose, flipped: true }, tube]), name: 'x' })).toThrow(
      /flipped nose cones.*Nose/,
    );
  });

  it('refuses a transition second unless it closes the chain', () => {
    expect(() => exportCdx1({ tree: one([nose, tail, tube]), name: 'x' })).toThrow(/right after the nose cone.*Tail/);
    expect(() => exportCdx1({ tree: one([nose, tail]), name: 'x' })).not.toThrow();
  });

  it("writes a single-stage rocket's closing transition as a boat tail", () => {
    const xml = exportCdx1({ tree: one([nose, tube, tail]), name: 'x' });
    expect(xml).toContain('<BoatTail>\n<PartType>BoatTail</PartType>');
    expect(xml).not.toContain('<Transition>');
  });

  it("writes a transition's <Diameter> from its aft radius, as desktop's BasePartDTO does", () => {
    const xml = exportCdx1({ tree: one([nose, tube, tail]), name: 'x' });
    const part = /<BoatTail>[\s\S]*?<\/BoatTail>/.exec(xml)![0];
    // aftRadius 0.009 m: 0.018 m across, 0.708661 in; the fore radius would be 1 in.
    expect(part).toContain('<Diameter>0.7087</Diameter>');
    expect(part).toContain('<RearDiameter>0.7087</RearDiameter>');
  });
});

/**
 * A booster is one RASAero body as long as all its tubes, and its fin Location
 * is measured from that body's bottom. Desktop's `BoosterDTO` adds the length of
 * every tube after the one the fins are on (`finLocationOffset`): fins with a
 * 2 in root flush with the bottom of the first of a 5 in and a 4 in tube sit
 * 2 + 4 = 6 in from the booster's bottom.
 */
describe('a booster made of two tubes', () => {
  const tube = (id: string, inches: number, children: unknown[] = []) => ({
    type: 'bodytube',
    id,
    name: id,
    length: inches * 0.0254,
    outerRadius: 0.0127,
    children,
  });
  const fins = {
    type: 'trapezoidfinset',
    id: 'bf',
    name: 'Booster fins',
    finCount: 3,
    rootChord: 0.0508,
    tipChord: 0.0254,
    sweep: 0.0254,
    height: 0.0254,
    thickness: 0.003,
    position: { method: 'bottom', offset: 0 },
  };
  const staged = (boosterTubes: unknown[]): RocketTree =>
    ({
      name: 'Two',
      components: [tree.components[0]!, { type: 'stage', id: 'b', name: 'Booster', children: boosterTubes }],
    }) as RocketTree;
  const boosterFinLocation = (t: RocketTree): number => {
    const out = exportCdx1({ tree: t, name: 'Two', launchMassKg: 0.5, launchCgM: 0.2 });
    const doc = new DOMParser().parseFromString(out, 'text/xml');
    return Number(doc.querySelector('Booster > Fin > Location')?.textContent);
  };

  it('measures the fin location from the bottom of the whole booster', () => {
    expect(boosterFinLocation(staged([tube('A', 5, [fins]), tube('B', 4)]))).toBeCloseTo(6, 3);
  });

  it('adds nothing when the fins are on the last tube', () => {
    expect(boosterFinLocation(staged([tube('A', 5), tube('B', 4, [fins])]))).toBeCloseTo(2, 3);
  });
});

/** The base design with one parachute in the body tube. */
const withChute = (chute: Record<string, unknown>): RocketTree => ({
  ...tree,
  components: [
    {
      ...tree.components[0]!,
      children: [
        tree.components[0]!.children![0]!,
        { ...tree.components[0]!.children![1]!, children: [{ type: 'parachute', id: 'p', name: 'Main', ...chute }] },
      ],
    },
  ],
});
const exported = (t: RocketTree) =>
  new DOMParser().parseFromString(
    exportCdx1({ tree: t, name: 'Chute', launchMassKg: 0.45, launchCgM: 0.12 }),
    'text/xml',
  );

/**
 * RASAero deploys at apogee or at an altitude and nothing else. Desktop's
 * RecoveryDTO raises RASAeroExport.error21 for any other event rather than write
 * a chute that never opens. A key the part does not carry is the kernel's
 * default: a new parachute deploys on the ejection charge, is 0.3 m across, and
 * flies Parachute.DEFAULT_CD.
 */
describe('a parachute with no deployment or size of its own', () => {
  it('is refused on the ejection charge, naming the part and the event', () => {
    expect(() => exported(withChute({}))).toThrow(
      expect.objectContaining({
        key: 'errors.rasaero.chuteEvent',
        values: { name: 'Main', event: { key: 'deployEvent.ejection' } },
      }),
    );
  });

  it('goes out at the kernel diameter and drag coefficient once it deploys at apogee', () => {
    const doc = exported(withChute({ deployEvent: 'apogee' }));
    expect(doc.querySelector('Recovery > EventType1')?.textContent).toBe('Apogee');
    expect(doc.querySelector('Recovery > Event1')?.textContent).toBe('True');
    expect(Number(doc.querySelector('Recovery > Size1')?.textContent)).toBeCloseTo(0.3 / 0.0254, 3);
    expect(Number(doc.querySelector('Recovery > CD1')?.textContent)).toBe(0.8);
  });
});

/**
 * Desktop's exporter reads the parachutes under each stage's own body tubes,
 * a tube's whole subtree in order (RecoveryDTO.getParachutesFromRocket iterates
 * the tube), and no other: one in a nose cone is not a recovery entry, and its
 * event does not stop the export.
 */
describe('which parachutes are recovery', () => {
  const design = (noseKids: object[], tubeKids: object[]): RocketTree => ({
    ...tree,
    components: [
      {
        ...tree.components[0]!,
        children: [
          { ...tree.components[0]!.children![0]!, children: noseKids },
          { ...tree.components[0]!.children![1]!, children: tubeKids },
        ],
      } as RocketTree['components'][number],
    ],
  });

  it('reads one inside an inner tube in a body tube, and none in the nose cone', () => {
    const doc = exported(
      design(
        [{ type: 'parachute', id: 'n', name: 'Nose chute' }],
        [
          {
            type: 'innertube',
            id: 'it',
            length: 0.1,
            children: [{ type: 'parachute', id: 'p', name: 'Main', diameter: 0.6, deployEvent: 'apogee' }],
          },
        ],
      ),
    );
    expect(doc.querySelector('Recovery > Size1')?.textContent).toBe(String(Number((0.6 / 0.0254).toFixed(3))));
    expect(doc.querySelector('Recovery > DeviceType2')?.textContent).toBe('None');
  });
});

/**
 * RASAero has one ogive (tangent) and two Haack noses. Desktop
 * (RASAeroCommonConstants.OPENROCKET_TO_RASAERO_SHAPE) takes an ogive only at
 * shape parameter 1 and a Haack only at 0 (Von Karman) or within 1% of 0.33
 * (LV-Haack), and refuses the rest. An absent parameter is the shape's default.
 */
describe('the nose shape parameter', () => {
  const withNose = (nose: Record<string, unknown>): RocketTree => ({
    ...tree,
    components: [
      {
        ...tree.components[0]!,
        children: [{ ...tree.components[0]!.children![0]!, name: 'Nose', ...nose }, tree.components[0]!.children![1]!],
      },
    ],
  });
  const shapeOf = (nose: Record<string, unknown>) =>
    exported(withNose(nose)).querySelector('NoseCone > Shape')?.textContent;

  it.each([
    [{ shape: 'ogive' }, 'Tangent Ogive'],
    [{ shape: 'ogive', shapeParameter: 1 }, 'Tangent Ogive'],
    [{ shape: 'haack' }, 'Von Karman Ogive'],
    [{ shape: 'haack', shapeParameter: 0 }, 'Von Karman Ogive'],
    [{ shape: 'haack', shapeParameter: 0.333 }, 'LV-Haack'],
  ])('writes %o as %s', (nose, expected) => {
    expect(shapeOf(nose)).toBe(expected);
  });

  it.each([
    [{ shape: 'ogive', shapeParameter: 0.5 }, 'errors.rasaero.noseOgiveParameter', 0.5],
    [{ shape: 'haack', shapeParameter: 0.2 }, 'errors.rasaero.noseHaackParameter', 0.2],
    // The kernel's LV-Haack, 1/3, is outside desktop's 1% of 0.33.
    [{ shape: 'haack', shapeParameter: 1 / 3 }, 'errors.rasaero.noseHaackParameter', 0.333],
  ])('refuses %o', (nose, key, value) => {
    expect(() => shapeOf(nose)).toThrow(expect.objectContaining({ key, values: { name: 'Nose', value } }));
  });
});

/**
 * A RASAero booster has a boat tail only on the last stage: desktop's
 * `BoosterDTO` writes a trailing transition as the boat tail when the stage is
 * the rocket's last child and otherwise raises error31 and error32 ("Boattails
 * can only be added to the last stage"), refusing the export. The same
 * transition on the last stage is the boat tail.
 */
describe('a trailing narrowing transition on a booster', () => {
  const booster = (id: string, trailing: boolean): unknown => ({
    type: 'stage',
    id,
    name: id,
    children: [
      { type: 'bodytube', id: `${id}t`, length: 0.2, outerRadius: 0.0127, children: [{ ...fins, id: `${id}f` }] },
      ...(trailing
        ? [{ type: 'transition', id: `${id}x`, length: 0.03, shape: 'conical', foreRadius: 0.0127, aftRadius: 0.008 }]
        : []),
    ],
  });
  const fins = {
    type: 'trapezoidfinset',
    finCount: 3,
    rootChord: 0.0508,
    tipChord: 0.0254,
    sweep: 0.0254,
    height: 0.0254,
    thickness: 0.003,
    position: { method: 'bottom', offset: 0 },
  };
  const three = (middle: boolean, last: boolean): RocketTree =>
    ({
      name: 'Three',
      components: [tree.components[0]!, booster('Middle', middle), booster('Last', last)],
    }) as RocketTree;
  const cells = [
    { massKg: 0.4, cgM: 0.15 },
    { massKg: 0.7, cgM: 0.3 },
    { massKg: 1, cgM: 0.45 },
  ];

  it('is refused on a stage that is not the last, naming the stage', () => {
    expect(() => exportCdx1({ tree: three(true, false), name: 'Three', stageLaunch: cells })).toThrow(
      expect.objectContaining({ key: 'errors.rasaero.boosterBoattail', values: { stage: 'Middle' } }),
    );
  });

  it('is the boat tail of the last stage', () => {
    const xml = exportCdx1({ tree: three(false, true), name: 'Three', stageLaunch: cells });
    const boosters = xml.match(/<Booster>[\s\S]*?<\/Booster>/g)!;
    expect(boosters).toHaveLength(2);
    expect(boosters[0]).toContain('<BoattailLength>0</BoattailLength>');
    // 0.03 m is 1.1811 in; 0.008 m aft radius is 0.63 in across.
    expect(boosters[1]).toContain('<BoattailLength>1.1811</BoattailLength>');
    expect(boosters[1]).toContain('<BoattailRearDiameter>0.6299</BoattailRearDiameter>');
  });
});

/**
 * Desktop's RASAeroCommonConstants.OPENROCKET_TO_RASAERO_MANUFACTURER, after
 * Manufacturer.getManufacturer resolves the name: "Loki" is a Loki Research
 * search name, so it takes the LR branch before the bare "Loki" one, and
 * "AMW ProX" is no Animal Motor Works alias, so it takes its own branch.
 */
describe('engine manufacturer abbreviations (desktop table)', () => {
  const stage = { type: 'stage', id: 's', children: [{ type: 'bodytube', id: 'mmt' }] } as never;
  const engine = (manufacturer: string) =>
    stageEngineSlots([stage], { mmt: { designation: 'J350W', manufacturer } }, true)[0]!.engine;

  it.each([
    ['Animal Motor Works', 'AMW'],
    ['AMW', 'AMW'],
    ['AMW ProX', 'AMW/ProX'],
    ['Loki', 'LR'],
    ['Loki Research', 'LR'],
  ])('writes %s as %s', (manufacturer, abbrev) => {
    expect(engine(manufacturer)).toBe(`J350W  (${abbrev})`);
  });
});
