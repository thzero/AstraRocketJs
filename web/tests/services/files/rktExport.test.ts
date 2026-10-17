// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { exportRkt } from '../../../src/services/files/rktExport';
import { importRkt } from '../../../src/services/files/rktImport';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';

/**
 * The writer, checked two ways.
 *
 * A round trip proves the pair agree with each other, which is necessary and
 * not sufficient: reader and writer can share a wrong unit factor and still
 * round-trip perfectly. `rktImport.test.ts` is the other half: it reads a
 * fixture written from RockSim's own schema, so between them a factor can only
 * be wrong in one place at a time. The literal-output checks below pin the few
 * fields where the two sides are not symmetric (diameters, shock-cord mass,
 * stage order), because those are the ones a shared mistake could hide.
 */

const design: RocketTree = {
  name: 'Round Trip',
  components: [
    {
      type: 'stage',
      id: 's1',
      name: 'Sustainer',
      children: [
        {
          type: 'nosecone',
          id: 'n1',
          name: 'Nose',
          length: 0.1,
          aftRadius: 0.0124,
          thickness: 0.0015,
          // Power, not ogive: a shape parameter only round-trips on a shape
          // that uses one, because the reader drops it on the others exactly as
          // `NoseConeHandler` does.
          shape: 'power',
          shapeParameter: 0.75,
          materialName: 'Polystyrene',
          density: 1050,
          finish: 'smooth',
          overrideMass: 0.0095,
          overrideCGX: 0.04,
        },
        {
          type: 'bodytube',
          id: 'b1',
          name: 'Airframe',
          length: 0.3,
          outerRadius: 0.0124,
          thickness: 0.0004,
          materialName: 'Kraft phenolic',
          children: [
            {
              type: 'trapezoidfinset',
              id: 'f1',
              name: 'Fins',
              finCount: 3,
              rootChord: 0.06,
              tipChord: 0.03,
              height: 0.045,
              sweep: 0.025,
              thickness: 0.0032,
              cant: (1.5 * Math.PI) / 180,
              rotation: Math.PI / 6,
              tabLength: 0.04,
              tabHeight: 0.005,
              tabOffset: 0.01,
              position: { method: 'bottom', offset: 0.06 },
            },
            {
              type: 'innertube',
              id: 'm1',
              name: 'Motor mount',
              length: 0.07,
              outerRadius: 0.00935,
              thickness: 0.00035,
              motorMount: true,
              motorOverhang: 0.003,
              position: { method: 'bottom', offset: 0.07 },
              children: [
                {
                  type: 'centeringring',
                  id: 'r1',
                  name: 'Aft ring',
                  length: 0.003,
                  outerRadius: 0.012,
                  innerRadius: 0.00935,
                  position: { method: 'bottom', offset: 0 },
                },
              ],
            },
            {
              type: 'parachute',
              id: 'p1',
              name: 'Chute',
              diameter: 0.4,
              cd: 0.8,
              lineCount: 6,
              lineLength: 0.35,
              spillHoleDiameter: 0.04,
              lineDensity: 0.0001,
              lineMaterialName: 'Braided nylon',
              surfaceDensity: 0.067,
              surfaceMaterialName: 'Ripstop nylon',
              position: { method: 'top', offset: 0.05 },
            },
            {
              type: 'shockcord',
              id: 'sc1',
              name: 'Shock cord',
              cordLength: 1,
              lineDensity: 0.006,
              position: { method: 'top', offset: 0.02 },
            },
            {
              type: 'launchlug',
              id: 'l1',
              name: 'Lug',
              length: 0.035,
              outerRadius: 0.0024,
              thickness: 0.0004,
              angleOffset: Math.PI / 2,
              position: { method: 'top', offset: 0.1 },
            },
          ],
        },
      ],
    },
  ],
};

const { xml, skipped } = exportRkt('Round Trip', design);
const back = importRkt(xml);

const find = (nodes: ComponentNode[] | undefined, name: string): ComponentNode => {
  const walk = (list: ComponentNode[] | undefined): ComponentNode | undefined => {
    for (const n of list ?? []) {
      if (n.name === name) return n;
      const hit = walk(n.children);
      if (hit) return hit;
    }
    return undefined;
  };
  const found = walk(nodes);
  if (!found) throw new Error(`no component named ${name}`);
  return found;
};

describe('exportRkt', () => {
  it('writes a RockSim document a reader can find the design in', () => {
    // Starts with the root element, nothing in front of it. Desktop
    // OpenRocket identifies a RockSim file by its first eleven bytes being
    // `<RockSimDoc` exactly (`GeneralRocketLoader.ROCKSIM_SIGNATURE`), unlike
    // the OpenRocket check beside it, which scans the buffer. An XML
    // declaration in front would make the desktop open the `.rkt` as
    // "Unsupported or corrupt file". The desktop's own saver writes none.
    expect(xml.startsWith('<RockSimDocument>')).toBe(true);
    expect(xml).not.toContain('<?xml');
    expect(xml).toContain('<FileVersion>4</FileVersion>');
    expect(xml).toContain('<Name>Round Trip</Name>');
    expect(xml).toContain('<StageCount>1</StageCount>');
  });

  it('always writes all three stage blocks, as RockSim does', () => {
    // Its reader keys off StageCount, not presence, and its own files carry
    // the unused blocks empty.
    expect(xml).toContain('<Stage3Parts>');
    expect(xml).toContain('<Stage2Parts/>');
    expect(xml).toContain('<Stage1Parts/>');
  });

  it('writes diameters in millimeters, not radii in meters', () => {
    // The single easiest thing to get wrong, and a round trip cannot catch it.
    expect(xml).toContain('<BaseDia>24.8</BaseDia>'); // 0.0124 m radius
    expect(xml).toContain('<OD>24.8</OD>');
    expect(xml).toContain('<ID>24</ID>'); // 0.0124 - 0.0004, doubled
    expect(xml).toContain('<Len>300</Len>');
    // …but a parachute's `Dia` is a diameter on both sides and is not doubled.
    expect(xml).toContain('<Dia>400</Dia>');
  });

  it('writes masses in grams and angles in degrees', () => {
    expect(xml).toContain('<KnownMass>9.5</KnownMass>'); // 0.0095 kg
    expect(xml).toContain('<CantAngle>1.5</CantAngle>');
    expect(xml).toContain('<RadialAngle>30</RadialAngle>');
    // A shock cord states its mass in RockSim: 0.006 kg/m over 1 m.
    expect(xml).toContain('<KnownMass>6</KnownMass>');
  });

  it('sets UseKnownCG only on the part that actually overrides', () => {
    // Turning it on makes RockSim stop computing mass and CG from geometry, so it
    // must not appear on a part with no measured figures.
    expect(xml.match(/<UseKnownCG>1<\/UseKnownCG>/g)).toHaveLength(1);
  });

  it('names the types it could not write instead of dropping them quietly', () => {
    const { skipped: s } = exportRkt('x', {
      name: 'x',
      components: [
        { type: 'stage', id: 's', children: [{ type: 'railbutton', id: 'rb' } as ComponentNode] },
      ] as ComponentNode[],
    });
    // Structured, so the banner renders it with the tree's own type label.
    expect(s).toEqual([{ key: 'part.railbutton' }]);
  });

  it('has nothing to skip for a design made only of shared types', () => {
    expect(skipped).toEqual([]);
  });
});

describe('exportRkt → importRkt round trip', () => {
  const stage = back.tree.components[0]!;

  it('keeps the design name and the structure', () => {
    expect(back.name).toBe('Round Trip');
    expect(back.tree.components).toHaveLength(1);
    expect(find(stage.children, 'Motor mount').children?.[0]!.name).toBe('Aft ring');
  });

  it.each([
    ['Nose', ['length', 'aftRadius', 'thickness', 'shapeParameter', 'overrideMass', 'overrideCGX']],
    ['Airframe', ['length', 'outerRadius', 'thickness']],
    ['Fins', ['rootChord', 'tipChord', 'height', 'sweep', 'thickness', 'cant', 'rotation', 'tabLength']],
    ['Motor mount', ['length', 'outerRadius', 'thickness', 'motorOverhang']],
    ['Aft ring', ['length', 'outerRadius', 'innerRadius']],
    ['Chute', ['diameter', 'cd', 'lineLength', 'spillHoleDiameter', 'lineDensity', 'surfaceDensity']],
    ['Lug', ['length', 'angleOffset']],
  ])('preserves every numeric field of %s', (name, keys) => {
    const before = find(design.components, name);
    const after = find(stage.children, name);
    for (const key of keys as string[]) {
      expect(after[key], `${name}.${key}`).toBeCloseTo(before[key] as number, 9);
    }
  });

  it('preserves types, names, materials and finish', () => {
    for (const name of ['Nose', 'Airframe', 'Fins', 'Motor mount', 'Chute', 'Shock cord', 'Lug']) {
      expect(find(stage.children, name).type, name).toBe(find(design.components, name).type);
    }
    expect(find(stage.children, 'Nose')['materialName']).toBe('Polystyrene');
    expect(find(stage.children, 'Nose')['finish']).toBe('smooth');
    expect(find(stage.children, 'Chute')['surfaceMaterialName']).toBe('Ripstop nylon');
    expect(find(stage.children, 'Chute')['lineMaterialName']).toBe('Braided nylon');
  });

  it('preserves placement, including the side the offset is measured from', () => {
    expect(find(stage.children, 'Fins').position).toEqual({ method: 'bottom', offset: 0.06 });
    expect(find(stage.children, 'Lug').position).toEqual({ method: 'top', offset: 0.1 });
  });

  // LaunchLugHandler sets the outside from OD and then the inside from ID, and
  // LaunchLug.setInnerRadius keeps the wall (the constructor's 1 mm) rather than
  // the outside, so the lug desktop reads is ID/2 + 1 mm across with a 1 mm wall.
  it('reads a lug back as desktop does: the inner radius plus a 1 mm wall', () => {
    const before = find(design.components, 'Lug');
    const after = find(stage.children, 'Lug');
    const inner = (before['outerRadius'] as number) - (before['thickness'] as number);
    expect(after['thickness']).toBeCloseTo(0.001, 9);
    expect(after['outerRadius']).toBeCloseTo(inner + 0.001, 9);
  });

  it('preserves the motor mount flag, and only on the mount', () => {
    expect(find(stage.children, 'Motor mount')['motorMount']).toBe(true);
    expect(find(stage.children, 'Airframe')['motorMount']).toBeUndefined();
  });

  it('preserves a shock cord through its mass', () => {
    // The one field the two sides express differently: we keep a line density,
    // RockSim keeps the total mass, so the trip is density → mass → density.
    const cord = find(stage.children, 'Shock cord');
    expect(cord['cordLength']).toBeCloseTo(1, 9);
    expect(cord['lineDensity']).toBeCloseTo(0.006, 9);
  });
});

/**
 * RockSim has no middle placement. Desktop's BasePartDTO writes a middle part
 * as a top offset: the gap from the parent's top to the part's top when
 * centered, plus its own offset. A fin set's extent is its root chord.
 */
describe('exportRkt, a middle-placed part', () => {
  const xbOf = (xml: string, name: string): number => {
    const block = xml.slice(xml.indexOf(`<Name>${name}</Name>`));
    return Number(/<Xb>([^<]+)<\/Xb>/.exec(block)?.[1]);
  };
  const tree: RocketTree = {
    name: 'Middle',
    components: [
      {
        type: 'stage',
        id: 's1',
        name: 'Sustainer',
        children: [
          {
            type: 'bodytube',
            id: 'b1',
            name: 'Airframe',
            length: 0.3,
            outerRadius: 0.0124,
            thickness: 0.0004,
            children: [
              {
                type: 'launchlug',
                id: 'l1',
                name: 'Lug',
                length: 0.03,
                outerRadius: 0.003,
                thickness: 0.0005,
                position: { method: 'middle', offset: 0.01 },
              },
              {
                type: 'trapezoidfinset',
                id: 'f1',
                name: 'Fins',
                finCount: 3,
                rootChord: 0.06,
                tipChord: 0.03,
                height: 0.05,
                position: { method: 'middle', offset: 0 },
              },
            ],
          },
        ],
      },
    ],
  } as unknown as RocketTree;

  it('writes a top offset measured from the parent top', () => {
    const { xml } = exportRkt('Middle', tree);
    // (0.3 - 0.03) / 2 + 0.01 = 0.145 m
    expect(xbOf(xml, 'Lug')).toBeCloseTo(145, 6);
    // (0.3 - 0.06) / 2 = 0.12 m
    expect(xbOf(xml, 'Fins')).toBeCloseTo(120, 6);
  });

  it('reads back to the same place', () => {
    const r = importRkt(exportRkt('Middle', tree).xml);
    const tube = find(r.tree.components[0]!.children, 'Airframe');
    expect(find(tube.children, 'Lug').position).toEqual({ method: 'top', offset: expect.closeTo(0.145, 9) as number });
    expect(find(tube.children, 'Fins').position).toEqual({ method: 'top', offset: expect.closeTo(0.12, 9) as number });
  });
});

describe('exportRkt, multi-stage', () => {
  it('writes the sustainer into Stage3Parts, nose-first', () => {
    const two: RocketTree = {
      name: 'Two',
      components: [
        { type: 'stage', id: 'a', name: 'Sustainer', children: [{ type: 'bodytube', id: 't1', name: 'Upper' }] },
        { type: 'stage', id: 'b', name: 'Booster', children: [{ type: 'bodytube', id: 't2', name: 'Lower' }] },
      ],
    };
    const { xml: x } = exportRkt('Two', two);
    expect(x).toContain('<StageCount>2</StageCount>');
    expect(x.indexOf('Upper')).toBeGreaterThan(x.indexOf('<Stage3Parts>'));
    expect(x.indexOf('Upper')).toBeLessThan(x.indexOf('<Stage2Parts>'));
    expect(x.indexOf('Lower')).toBeGreaterThan(x.indexOf('<Stage2Parts>'));

    const r = importRkt(x);
    expect(r.tree.components).toHaveLength(2);
    expect(find(r.tree.components[0]!.children, 'Upper')).toBeTruthy();
    expect(find(r.tree.components[1]!.children, 'Lower')).toBeTruthy();
  });
});

/**
 * RockSim has no cluster: it knows one tube per motor.
 *
 * OpenRocket keeps one inner tube carrying a cluster pattern, and the desktop
 * splits it on the way out (`InnerBodyTubeDTO.handleCluster`). So does this
 * writer: saved as a single tube, a three-motor cluster would name one motor
 * where the design flies three. Everything mounted inside the mount is copied
 * into each member.
 *
 * Checked against the desktop's own output for the same design: three members
 * at 10.9697 mm from the axis, 120 degrees apart, each carrying the engine
 * block. The angles are written in degrees here, which is this writer's one
 * deliberate departure from the format; the places are the same ones.
 */
describe('exportRkt: a clustered motor mount', () => {
  const mount = (cluster: string): ComponentNode =>
    ({
      type: 'innertube',
      id: 'mount',
      name: 'Mount',
      motorMount: true,
      cluster,
      length: 0.1,
      outerRadius: 0.0095,
      thickness: 0.0005,
      position: { method: 'bottom', offset: 0 },
      children: [
        {
          type: 'engineblock',
          id: 'block',
          name: 'Block',
          length: 0.005,
          outerRadius: 0.009,
          thickness: 0.003,
          position: { method: 'top', offset: 0 },
        },
      ],
    }) as unknown as ComponentNode;

  const clustered = (cluster: string): string =>
    exportRkt('Cluster', {
      name: 'Cluster',
      components: [
        {
          type: 'stage',
          id: 's1',
          name: 'Sustainer',
          children: [
            {
              type: 'bodytube',
              id: 'tube',
              name: 'Body',
              length: 0.4,
              outerRadius: 0.04,
              thickness: 0.001,
              children: [mount(cluster)],
            },
          ],
        },
      ],
    } as unknown as RocketTree).xml;

  it('writes one tube per motor, named as the desktop names them', () => {
    const xml = clustered('3-ring');
    for (const n of [1, 2, 3]) expect(xml).toContain(`<Name>Mount #${n}</Name>`);
    // The airframe plus the three members, and no un-split mount left behind.
    expect(xml.match(/<BodyTube>/g)).toHaveLength(4);
    expect(xml).not.toContain('<Name>Mount</Name>');
  });

  it('puts everything inside the mount into EVERY tube, not just the first', () => {
    // An engine block is what the motor pushes against, so a cluster missing
    // two of them is a file describing a different rocket.
    expect(clustered('3-ring').match(/<Name>Block<\/Name>/g)).toHaveLength(3);
  });

  it('places the members where the desktop places them', () => {
    const xml = clustered('3-ring');
    // 10.9697 mm from the axis for a 19 mm tube in a 3-ring, which is the
    // figure OpenRocket 24.12 writes for the same design.
    expect(xml.match(/<RadialLoc>10\.9696/g)).toHaveLength(3);
    // 120 degrees apart, in this writer's own angle unit.
    for (const a of ['-150', '-30', '90']) {
      expect(xml).toContain(`<RadialAngle>${a}</RadialAngle>`);
    }
  });

  it('turns the pattern by the clock angle less the radial direction, as the kernel does', () => {
    // InnerTube.getClusterPoints rotates by `clusterRotation - radialDirection`.
    // With the mount's direction at 90 degrees and no offset, the 3-ring's
    // (-0.5, -0.289), (0.5, -0.289), (0, 0.577) turn to -60, 60 and 180 degrees.
    const xml = exportRkt('Cluster', {
      name: 'Cluster',
      components: [
        {
          type: 'stage',
          id: 's1',
          name: 'Sustainer',
          children: [
            {
              type: 'bodytube',
              id: 'tube',
              name: 'Body',
              length: 0.4,
              outerRadius: 0.04,
              thickness: 0.001,
              children: [{ ...mount('3-ring'), radialDirection: Math.PI / 2 }],
            },
          ],
        },
      ],
    } as unknown as RocketTree).xml;
    const angles = [...xml.matchAll(/<RadialAngle>([^<]+)<\/RadialAngle>/g)].map((m) => Math.round(Number(m[1])));
    expect(angles.slice(0, 3).sort((a, b) => a - b)).toEqual([-60, 60, 180]);
  });

  it('leaves a single mount as one tube', () => {
    const xml = clustered('single');
    expect(xml).toContain('<Name>Mount</Name>');
    expect(xml.match(/<BodyTube>/g)).toHaveLength(2);
    expect(xml.match(/<Name>Block<\/Name>/g)).toHaveLength(1);
  });
});

describe('exportRkt: off-axis placement, as desktop writes it', () => {
  // BasePartDTO writes RadialLoc/RadialAngle for a RingComponent and
  // MassObjectDTO for a mass component or shock cord. ParachuteDTO and
  // StreamerDTO write neither. RadialAngle is degrees, our one deliberate
  // divergence from desktop's radians.
  const PLACED = ['tubecoupler', 'centeringring', 'bulkhead', 'engineblock', 'masscomponent', 'shockcord'];
  const NOT_PLACED = ['parachute', 'streamer'];

  const partXml = (type: string): string => {
    const { xml } = exportRkt('Offset', {
      name: 'Offset',
      components: [
        {
          type: 'stage',
          id: 's1',
          name: 'S',
          children: [
            {
              type: 'bodytube',
              id: 'b1',
              name: 'Body',
              length: 0.3,
              outerRadius: 0.02,
              thickness: 0.001,
              children: [
                { type, id: 'p', name: 'Part', length: 0.02, radialPosition: 0.006, radialDirection: Math.PI / 2 },
              ],
            },
          ],
        },
      ],
    } as unknown as RocketTree);
    // The part's own element: from its name to the next part's name or the end.
    const at = xml.indexOf('<Name>Part</Name>');
    const next = xml.indexOf('<Name>', at + 1);
    return xml.slice(at, next === -1 ? undefined : next);
  };

  it.each(PLACED)('writes the offset of a %s', (type) => {
    const x = partXml(type);
    expect(x).toContain('<RadialLoc>6</RadialLoc>');
    expect(x).toContain('<RadialAngle>90</RadialAngle>');
  });

  it.each(NOT_PLACED)('writes no offset for a %s', (type) => {
    const x = partXml(type);
    expect(x).not.toContain('<RadialLoc>');
    expect(x).not.toContain('<RadialAngle>');
  });

  it.each(PLACED)('reads no offset back for a %s, as desktop reads none', (type) => {
    const { xml } = exportRkt('Offset', {
      name: 'Offset',
      components: [
        {
          type: 'stage',
          id: 's1',
          name: 'S',
          children: [
            {
              type: 'bodytube',
              id: 'b1',
              name: 'Body',
              length: 0.3,
              outerRadius: 0.02,
              thickness: 0.001,
              children: [{ type, id: 'p', name: 'Part', length: 0.02, radialPosition: 0.006 }],
            },
          ],
        },
      ],
    } as unknown as RocketTree);
    const nodes: ComponentNode[] = [];
    const walk = (ns: ComponentNode[] = []) =>
      ns.forEach((n) => {
        nodes.push(n);
        walk(n.children);
      });
    walk(importRkt(xml).tree.components);
    const part = nodes.find((n) => n.name === 'Part');
    expect(part).toBeDefined();
    expect(part?.['radialPosition']).toBeUndefined();
  });
});

// The bridge takes a surface density as given, zero included, so the file
// carries the canopy the app flies rather than the kernel's default fabric.
describe('a canopy with no weight', () => {
  it('goes out at the density the app flies', () => {
    const { xml: out } = exportRkt('x', {
      name: 'x',
      components: [
        {
          type: 'stage',
          id: 's',
          name: 'Sustainer',
          children: [
            {
              type: 'bodytube',
              id: 'b',
              name: 'Airframe',
              length: 0.3,
              outerRadius: 0.0124,
              children: [{ type: 'parachute', id: 'p', name: 'Main', surfaceDensity: 0 }],
            },
          ],
        },
      ] as ComponentNode[],
    });
    const chute = new DOMParser().parseFromString(out, 'text/xml').querySelector('Parachute');
    expect(Number(chute?.querySelector(':scope > Density')?.textContent)).toBe(0);
  });
});

describe('mass and CG overrides through the one UseKnownCG switch', () => {
  /** A one-stage design holding just `part`. */
  const only = (part: ComponentNode, figures?: Parameters<typeof exportRkt>[2]) =>
    exportRkt(
      'x',
      {
        name: 'x',
        components: [{ type: 'stage', id: 's', name: 'Sustainer', children: [part] }] as ComponentNode[],
      },
      figures,
    );

  /**
   * The switch overrides mass and CG together, so a mass-only override needs the
   * part's own CG in KnownCG. Desktop's BasePartDTO writes getOverrideCGX(),
   * which is the part's own CG while the CG is not overridden; a CG of 0 would
   * open with the part's CG moved to its front.
   */
  it('writes the kernel CG of the part for a mass-only override', () => {
    const figures = (id: string) => (id === 'b' ? { mass: 0.02, cgX: 0.15 } : undefined);
    const { xml: out, skipped: s } = only(
      { type: 'bodytube', id: 'b', name: 'Airframe', length: 0.3, outerRadius: 0.0124, overrideMass: 0.05 },
      figures,
    );
    const block = out.slice(out.indexOf('<BodyTube>'), out.indexOf('</BodyTube>'));
    expect(block).toContain('<KnownMass>50</KnownMass>');
    expect(block).toContain('<KnownCG>150</KnownCG>');
    expect(block).toContain('<UseKnownCG>1</UseKnownCG>');
    expect(s).toEqual([]);
  });

  it('leaves out and names a mass-only override with no kernel figures for its CG', () => {
    const { xml: out, skipped: s } = only({
      type: 'bodytube',
      id: 'b',
      name: 'Airframe',
      length: 0.3,
      outerRadius: 0.0124,
      overrideMass: 0.05,
    });
    const block = out.slice(out.indexOf('<BodyTube>'), out.indexOf('</BodyTube>'));
    expect(block).not.toContain('<UseKnownCG>1</UseKnownCG>');
    expect(block).not.toContain('<KnownCG>');
    expect(s).toEqual([{ key: 'errors.rktSkip.massOverride', values: { name: 'Airframe' } }]);
  });

  it('does not write an override mass of 0 for a part that overrides only its CG', () => {
    const { xml: out, skipped: s } = only({
      type: 'bodytube',
      id: 'b',
      name: 'Airframe',
      length: 0.3,
      outerRadius: 0.0124,
      thickness: 0.0004,
      overrideCGX: 0.1,
    } as ComponentNode);
    expect(out).not.toContain('<UseKnownCG>1</UseKnownCG>');
    expect(importRkt(out).tree.components[0]!.children![0]!['overrideMass']).toBeUndefined();
    // The CG override is reported as not exported rather than lost quietly.
    expect(s).toEqual([{ key: 'errors.rktSkip.cgOverride', values: { name: 'Airframe' } }]);
  });

  // BasePartDTO writes getMass() beside the CG, and the kernel's figure for the
  // part is that mass, so with figures in hand the override goes out whole.
  it("pairs a CG-only override with the kernel's mass for the part", () => {
    const { xml: out, skipped: s } = exportRkt(
      'x',
      {
        name: 'x',
        components: [
          {
            type: 'stage',
            id: 's',
            name: 'Sustainer',
            children: [
              { type: 'bodytube', id: 'b', name: 'Airframe', length: 0.3, outerRadius: 0.0124, overrideCGX: 0.1 },
            ],
          },
        ] as ComponentNode[],
      },
      (id) => (id === 'b' ? { mass: 0.025, cgX: 0.15 } : undefined),
    );
    expect(out).toContain('<UseKnownCG>1</UseKnownCG>');
    expect(s).toEqual([]);
    const tube = importRkt(out).tree.components[0]!.children![0]!;
    expect(tube['overrideMass']).toBeCloseTo(0.025, 9);
    expect(tube['overrideCGX']).toBeCloseTo(0.1, 9);
  });

  it('writes KnownMass once on a mass component that also overrides its mass', () => {
    // Inside a body tube, the only place a stage holds a mass object.
    const figures = (id: string) => (id === 'm' ? { mass: 0.02, cgX: 0.015 } : undefined);
    const { xml: out } = only(
      {
        type: 'bodytube',
        id: 'b',
        name: 'Airframe',
        length: 0.3,
        outerRadius: 0.0124,
        thickness: 0.0004,
        children: [
          {
            type: 'masscomponent',
            id: 'm',
            name: 'Altimeter',
            length: 0.03,
            radius: 0.01,
            mass: 0.02,
            overrideMass: 0.05,
          },
        ],
      } as unknown as ComponentNode,
      figures,
    );
    const block = out.slice(out.indexOf('<MassObject>'), out.indexOf('</MassObject>'));
    expect(block.match(/<KnownMass>/g)).toHaveLength(1);
    // BasePartDTO writes getMass(), which is the override when there is one.
    expect(block).toContain('<KnownMass>50</KnownMass>');
    const mass = importRkt(out).tree.components[0]!.children![0]!.children![0]!;
    expect(mass['overrideMass']).toBeCloseTo(0.05, 12);
  });

  it('writes KnownMass once on a shock cord that overrides its mass', () => {
    const { xml: out } = only({
      type: 'shockcord',
      id: 'c',
      name: 'Cord',
      cordLength: 1,
      lineDensity: 0.006,
      overrideMass: 0.01,
    } as ComponentNode);
    const block = out.slice(out.indexOf('<MassObject>'), out.indexOf('</MassObject>'));
    expect(block.match(/<KnownMass>/g)).toHaveLength(1);
  });
});

describe('stage mass and CG overrides', () => {
  // StageDTO writes a mass-overridden stage's mass in grams on the design as
  // StageNMass with UseKnownMass=1, and its override CG in millimeters as
  // Stage3CG for the sustainer and StageNCGAlone for a booster.
  const tree = {
    name: 'Two stage',
    components: [
      {
        type: 'stage',
        id: 's',
        name: 'Sustainer',
        overrideMass: 0.1425,
        overrideSubcomponentsMass: true,
        overrideCGX: 0.21,
        overrideSubcomponentsCG: true,
        children: [{ type: 'bodytube', id: 'u', name: 'Upper', length: 0.3, outerRadius: 0.0124, thickness: 0.0004 }],
      },
      {
        type: 'stage',
        id: 'b',
        name: 'Booster',
        overrideMass: 0.08,
        overrideSubcomponentsMass: true,
        overrideCGX: 0.12,
        overrideSubcomponentsCG: true,
        children: [{ type: 'bodytube', id: 'l', name: 'Lower', length: 0.25, outerRadius: 0.0124, thickness: 0.0004 }],
      },
    ],
  } as unknown as RocketTree;
  const { xml: out, skipped } = exportRkt('Two stage', tree);

  it('writes them on the design, under the names RockSimHandler reads', () => {
    expect(out).toContain('<Stage3Mass>142.5</Stage3Mass>');
    expect(out).toContain('<Stage2Mass>80</Stage2Mass>');
    expect(out).toContain('<Stage3CG>210</Stage3CG>');
    expect(out).toContain('<Stage2CGAlone>120</Stage2CGAlone>');
    expect(out).toContain('<UseKnownMass>1</UseKnownMass>');
    expect(out).not.toContain('Stage1Mass');
    expect(skipped).toEqual([]);
  });

  it('reads back as the same stage overrides', () => {
    const [sustainer, booster] = importRkt(out).tree.components;
    expect(sustainer!['overrideMass']).toBeCloseTo(0.1425, 12);
    expect(sustainer!['overrideCGX']).toBeCloseTo(0.21, 12);
    expect(booster!['overrideMass']).toBeCloseTo(0.08, 12);
    expect(booster!['overrideCGX']).toBeCloseTo(0.12, 12);
  });

  it('writes none for a stage that overrides nothing', () => {
    const plain = exportRkt('One', {
      name: 'One',
      components: [{ type: 'stage', id: 's', children: [tree.components[0]!.children![0]!] }],
    } as unknown as RocketTree).xml;
    expect(plain).not.toMatch(/Stage\dMass|Stage3CG|UseKnownMass/);
  });

  /**
   * `RockSimHandler` turns on `setSubcomponentsOverriddenMass` and
   * `setSubcomponentsOverriddenCG` for every stage figure it reads, so an
   * override of the stage alone opens in desktop as one of the whole stage.
   */
  it('names a stage override that leaves the parts inside out', () => {
    const stage = (extra: Record<string, unknown>) =>
      exportRkt('One', {
        name: 'One',
        components: [{ ...tree.components[0]!, ...extra }],
      } as unknown as RocketTree).skipped;
    const named = [{ key: 'errors.rktSkip.stageOnlyOverride', values: { name: 'Sustainer' } }];
    expect(stage({ overrideSubcomponentsMass: false })).toEqual(named);
    expect(stage({ overrideSubcomponentsCG: false })).toEqual(named);
    expect(stage({ overrideMass: undefined, overrideSubcomponentsCG: undefined })).toEqual(named);
    expect(stage({ name: undefined, overrideSubcomponentsMass: false })).toEqual([
      { key: 'errors.rktSkip.stageOnlyOverride', values: { name: { key: 'part.stage' } } },
    ]);
  });
});

/**
 * RockSim has no repeat count: `LaunchLugDTO` and `CenteringRingDTO` write one
 * part, and `LaunchLugHandler` and `RingHandler` read one, so a line of copies
 * opens in desktop as its first.
 */
describe('a part repeated along its parent', () => {
  const write = (part: ComponentNode) =>
    exportRkt('x', {
      name: 'x',
      components: [
        {
          type: 'stage',
          id: 's',
          children: [
            {
              type: 'bodytube',
              id: 'b',
              name: 'Airframe',
              length: 0.3,
              outerRadius: 0.025,
              thickness: 0.0005,
              children: [part],
            },
          ],
        },
      ],
    } as unknown as RocketTree);

  it('is named for a line of rings, lugs or bulkheads', () => {
    const ring = {
      type: 'centeringring',
      id: 'r',
      name: 'Ring',
      length: 0.005,
      instanceCount: 2,
      instanceSeparation: 0.05,
    };
    expect(write(ring as ComponentNode).skipped).toEqual([
      { key: 'errors.rktSkip.instanceCount', values: { name: 'Ring' } },
    ]);
    const lug = { type: 'launchlug', id: 'l', length: 0.03, outerRadius: 0.003, instanceCount: 3 };
    expect(write(lug as ComponentNode).skipped).toEqual([
      { key: 'errors.rktSkip.instanceCount', values: { name: { key: 'part.launchlug' } } },
    ]);
    const bulkhead = { type: 'bulkhead', id: 'h', name: 'Plate', length: 0.003, instanceCount: 2 };
    expect(write(bulkhead as ComponentNode).skipped).toEqual([
      { key: 'errors.rktSkip.instanceCount', values: { name: 'Plate' } },
    ]);
  });

  it('is not named for a single copy', () => {
    const ring = { type: 'centeringring', id: 'r', name: 'Ring', length: 0.005, instanceCount: 1 };
    expect(write(ring as ComponentNode).skipped).toEqual([]);
  });
});

/**
 * Fields desktop OpenRocket reads differently from how the app's own reader
 * does, each checked against the RockSim handler that reads it.
 */
describe('exportRkt, read by the desktop handlers', () => {
  /** A one-stage design holding `parts`. */
  const write = (parts: ComponentNode[], figures?: Parameters<typeof exportRkt>[2]) =>
    exportRkt(
      'x',
      { name: 'x', components: [{ type: 'stage', id: 's', name: 'Sustainer', children: parts }] } as RocketTree,
      figures,
    );
  const tube = (children: ComponentNode[]): ComponentNode => ({
    type: 'bodytube',
    id: 'b',
    name: 'Airframe',
    length: 0.3,
    outerRadius: 0.025,
    thickness: 0.0005,
    children,
  });
  /** The text of `name` inside the first `<tag>` block. */
  const field = (out: string, tag: string, name: string): string | undefined =>
    new RegExp(`<${tag}>[\\s\\S]*?<${name}>([^<]*)</${name}>[\\s\\S]*?</${tag}>`).exec(out)?.[1];

  /**
   * `MassObjectHandler.mapMassObjectAsShockCord` drops `KnownMass` unless
   * `UseKnownCG` is set and weighs the cord by the line material built from
   * `Material` and `Density`, so the cord's own line material has to be there.
   */
  it('gives a shock cord its line material and density', () => {
    const { xml: out } = write([
      tube([
        {
          type: 'shockcord',
          id: 'c',
          name: 'Cord',
          cordLength: 1.2,
          lineDensity: 0.0042,
          lineMaterialName: 'Kevlar',
          position: { method: 'top', offset: 0.02 },
        } as ComponentNode,
      ]),
    ]);
    expect(field(out, 'MassObject', 'Material')).toBe('Kevlar');
    expect(Number(field(out, 'MassObject', 'Density'))).toBeCloseTo(0.0042, 9);
    expect(field(out, 'MassObject', 'DensityType')).toBe('2');
  });

  it('names a shock cord density that has no material name custom, as the .ork writer does', () => {
    const { xml: out } = write([
      tube([{ type: 'shockcord', id: 'c', name: 'Cord', cordLength: 1, lineDensity: 0.006 } as ComponentNode]),
    ]);
    expect(field(out, 'MassObject', 'Material')).toBe('custom');
    expect(Number(field(out, 'MassObject', 'Density'))).toBeCloseTo(0.006, 9);
  });

  /**
   * `BaseHandler.endHandler` builds a part's material from `Material` and
   * `Density` alone, so a part written without either opens weighing nothing.
   * The kernel takes a material only from a positive density
   * (`ComponentFactory`), and a part without one flies the stock material
   * `ApplicationPreferences.getDefaultComponentMaterial` gives it: cardboard at
   * 680 kg/m3, ripstop nylon at 0.067 kg/m2, elastic cord at 0.0018 kg/m.
   */
  describe('a part with no material of its own', () => {
    it('goes out as the stock bulk material the kernel weighs it with', () => {
      const { xml: out } = write([tube([])]);
      expect(field(out, 'BodyTube', 'Material')).toBe('Cardboard');
      expect(Number(field(out, 'BodyTube', 'Density'))).toBeCloseTo(680, 9);
      expect(field(out, 'BodyTube', 'DensityType')).toBe('0');
    });

    it('goes out as the stock material when it names one with no density, since the kernel ignores the name', () => {
      const { xml: out } = write([{ ...tube([]), materialName: 'Kraft phenolic' }]);
      expect(field(out, 'BodyTube', 'Material')).toBe('Cardboard');
      expect(Number(field(out, 'BodyTube', 'Density'))).toBeCloseTo(680, 9);
    });

    it('keeps a material with a density as it is', () => {
      const { xml: out } = write([{ ...tube([]), materialName: 'Kraft phenolic', density: 950 }]);
      expect(field(out, 'BodyTube', 'Material')).toBe('Kraft phenolic');
      expect(Number(field(out, 'BodyTube', 'Density'))).toBeCloseTo(950, 9);
    });

    it('goes out as the stock canopy for a parachute, in g/cm2', () => {
      const { xml: out } = write([
        tube([{ type: 'parachute', id: 'p', name: 'Chute', diameter: 0.4, lineCount: 6 } as ComponentNode]),
      ]);
      expect(field(out, 'Parachute', 'Material')).toBe('Ripstop nylon');
      expect(Number(field(out, 'Parachute', 'Density'))).toBeCloseTo(0.0067, 9);
      expect(field(out, 'Parachute', 'DensityType')).toBe('1');
    });

    it('goes out as the stock line material for a shock cord', () => {
      const { xml: out } = write([
        tube([{ type: 'shockcord', id: 'c', name: 'Cord', cordLength: 1 } as ComponentNode]),
      ]);
      expect(field(out, 'MassObject', 'Material')).toBe('Elastic cord (round 2 mm, 1/16 in)');
      expect(Number(field(out, 'MassObject', 'Density'))).toBeCloseTo(0.0018, 9);
      expect(field(out, 'MassObject', 'DensityType')).toBe('2');
    });

    it('writes none for a mass component, which states its mass', () => {
      const { xml: out } = write([
        tube([{ type: 'masscomponent', id: 'm', name: 'Altimeter', mass: 0.02, length: 0.03 } as ComponentNode]),
      ]);
      expect(field(out, 'MassObject', 'Material')).toBeUndefined();
      expect(Number(field(out, 'MassObject', 'KnownMass'))).toBeCloseTo(20, 9);
    });
  });

  /**
   * `FinSetHandler.endHandler` overrides an airfoil fin set that has no
   * override of its own with `CalcMass` and `CalcCG`, so both have to carry
   * the kernel's figures or the set weighs 0 g.
   */
  describe('an airfoil fin set', () => {
    const fins = (extra: Partial<ComponentNode> = {}): ComponentNode =>
      ({
        type: 'trapezoidfinset',
        id: 'f',
        name: 'Fins',
        finCount: 3,
        rootChord: 0.06,
        tipChord: 0.03,
        height: 0.045,
        sweep: 0.025,
        thickness: 0.003,
        crossSection: 'airfoil',
        ...extra,
      }) as ComponentNode;
    const figures = (id: string) => (id === 'f' ? { mass: 0.0125, cgX: 0.031 } : undefined);

    it("writes the kernel's mass and CG as CalcMass and CalcCG", () => {
      const { xml: out, skipped: s } = write([tube([fins()])], figures);
      expect(Number(field(out, 'FinSet', 'CalcMass'))).toBeCloseTo(12.5, 9);
      expect(Number(field(out, 'FinSet', 'CalcCG'))).toBeCloseTo(31, 9);
      expect(s).toEqual([]);
    });

    it('names the fin set when there is no build to take the figures from', () => {
      const { xml: out, skipped: s } = write([tube([fins()])]);
      expect(field(out, 'FinSet', 'CalcMass')).toBeUndefined();
      expect(s).toEqual([{ key: 'errors.rktSkip.airfoilMass', values: { name: 'Fins' } }]);
    });

    it('needs neither when the set overrides its own mass', () => {
      const { xml: out, skipped: s } = write([tube([fins({ overrideMass: 0.02 })])], figures);
      expect(field(out, 'FinSet', 'CalcMass')).toBeUndefined();
      expect(s).toEqual([]);
    });
  });

  /**
   * `PodHandler` reads `RadialLoc` as `RadiusMethod.FREE`, a distance from the
   * parent's centerline. `RadiusMethod.RELATIVE` places a pod at the body
   * tube's radius plus the pod's bounding radius plus its offset: 25 mm, plus
   * the 12 mm pod tube, plus 3 mm, is 40 mm.
   */
  describe('a pod', () => {
    const pod = (radiusMethod: string): ComponentNode =>
      ({
        type: 'podset',
        id: 'p',
        name: 'Pod',
        instanceCount: 1,
        radiusMethod,
        radiusOffset: 0.003,
        position: { method: 'top', offset: 0.1 },
        children: [{ type: 'bodytube', id: 'pt', name: 'Pod tube', length: 0.1, outerRadius: 0.012 }],
      }) as ComponentNode;

    it('placed against the surface goes out at its distance from the centerline', () => {
      expect(Number(field(write([tube([pod('relative')])]).xml, 'ExternalPod', 'RadialLoc'))).toBeCloseTo(40, 9);
    });

    it('placed from the centerline goes out as it is', () => {
      expect(Number(field(write([tube([pod('free')])]).xml, 'ExternalPod', 'RadialLoc'))).toBeCloseTo(3, 9);
    });
  });

  /**
   * RockSim has no flipped flag, and desktop's `StageDTO.toNoseConeDTO` writes a
   * flipped nose cone as a transition: base at the front, a point at the rear.
   */
  it('writes a tail cone as a transition, base first', () => {
    const { xml: out } = write([
      tube([]),
      {
        type: 'nosecone',
        id: 't',
        name: 'Tail cone',
        length: 0.08,
        aftRadius: 0.025,
        thickness: 0.002,
        shape: 'ogive',
        flipped: true,
        shoulderRadius: 0.024,
        shoulderLength: 0.02,
      } as ComponentNode,
    ]);
    expect(out).not.toContain('<NoseCone>');
    expect(field(out, 'Transition', 'Name')).toBe('Tail cone');
    expect(Number(field(out, 'Transition', 'FrontDia'))).toBeCloseTo(50, 9);
    expect(Number(field(out, 'Transition', 'RearDia'))).toBeCloseTo(0, 9);
    expect(Number(field(out, 'Transition', 'FrontShoulderDia'))).toBeCloseTo(48, 9);
    expect(Number(field(out, 'Transition', 'FrontShoulderLen'))).toBeCloseTo(20, 9);
    expect(field(out, 'Transition', 'ShapeCode')).toBe('1');
  });
});

/** The rest of what desktop's RockSim handlers read differently. */
describe('exportRkt, read by the desktop handlers: fins, pods and finishes', () => {
  const write = (parts: ComponentNode[], figures?: Parameters<typeof exportRkt>[2]) =>
    exportRkt(
      'x',
      { name: 'x', components: [{ type: 'stage', id: 's', name: 'Sustainer', children: parts }] } as RocketTree,
      figures,
    );
  const tube = (children: ComponentNode[]): ComponentNode => ({
    type: 'bodytube',
    id: 'b',
    name: 'Airframe',
    length: 0.3,
    outerRadius: 0.025,
    thickness: 0.0005,
    children,
  });
  /** Every `<tag>` block in order, as its text. */
  const blocks = (out: string, tag: string): string[] =>
    [...out.matchAll(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g'))].map((m) => m[0]);
  /** The text of `name` directly in a block, or undefined. */
  const value = (block: string, name: string): string | undefined =>
    new RegExp(`<${name}>([^<]*)</${name}>`).exec(block)?.[1];
  const fins = (extra: Partial<ComponentNode> = {}): ComponentNode =>
    ({
      type: 'trapezoidfinset',
      id: 'f',
      name: 'Fins',
      finCount: 3,
      rootChord: 0.06,
      tipChord: 0.03,
      height: 0.045,
      sweep: 0.025,
      thickness: 0.003,
      ...extra,
    }) as ComponentNode;

  /**
   * `ParachuteHandler` builds the line material when `ShroudLineMaterial`
   * closes, from the density read by then, so the density has to come first.
   */
  it("writes a parachute's line density before its line material", () => {
    const { xml: out } = write([
      tube([
        {
          type: 'parachute',
          id: 'p',
          name: 'Chute',
          diameter: 0.4,
          lineDensity: 0.0003,
          lineMaterialName: 'Braided nylon',
        } as ComponentNode,
      ]),
    ]);
    const chute = blocks(out, 'Parachute')[0]!;
    expect(chute.indexOf('<ShroudLineMassPerMM>')).toBeGreaterThan(-1);
    expect(chute.indexOf('<ShroudLineMassPerMM>')).toBeLessThan(chute.indexOf('<ShroudLineMaterial>'));
  });

  /**
   * `FinSetDTO` writes `getTabOffset(AxialMethod.TOP)` and `FinSetHandler` reads
   * it as top: a 40 mm tab centered on a 60 mm root starts 10 mm back, and one
   * against the trailing edge 20 mm back.
   */
  it.each([
    ['middle', 10],
    ['bottom', 20],
    ['top', 0],
  ])('writes a tab placed by %s as its offset from the root front', (method, expected) => {
    const { xml: out } = write([
      tube([fins({ tabLength: 0.04, tabHeight: 0.005, tabOffset: 0, tabOffsetMethod: method })]),
    ]);
    expect(Number(value(blocks(out, 'FinSet')[0]!, 'TabOffset'))).toBeCloseTo(expected, 9);
  });

  /** `RockSimFinishCode.toCode` writes every finish it has no code for as matt (2). */
  it('writes a finish RockSim has no code for as matt', () => {
    const { xml: out } = write([{ ...tube([]), finish: 'rough' }]);
    expect(value(blocks(out, 'BodyTube')[0]!, 'FinishCode')).toBe('2');
  });

  /** A fin set's and a tube fin set's roll is their `rotation`, as the bridge reads it. */
  it('writes a fin set and a tube fin set rotated by their rotation', () => {
    const { xml: out } = write([
      tube([
        fins({ rotation: Math.PI / 4 }),
        { type: 'tubefinset', id: 't', name: 'Tubes', rotation: Math.PI / 2, outerRadius: 0.01 } as ComponentNode,
      ]),
    ]);
    expect(Number(value(blocks(out, 'FinSet')[0]!, 'RadialAngle'))).toBeCloseTo(45, 9);
    expect(Number(value(blocks(out, 'TubeFinSet')[0]!, 'RadialAngle'))).toBeCloseTo(90, 9);
    const back = find(importRkt(out).tree.components, 'Fins');
    expect(back['rotation']).toBeCloseTo(Math.PI / 4, 9);
  });

  const pod = (extra: Partial<ComponentNode> = {}): ComponentNode =>
    ({
      type: 'podset',
      id: 'p',
      name: 'Pod',
      instanceCount: 1,
      radiusMethod: 'free',
      radiusOffset: 0.05,
      position: { method: 'top', offset: 0.1 },
      children: [
        {
          type: 'bodytube',
          id: 'pt',
          name: 'Pod tube',
          length: 0.1,
          outerRadius: 0.012,
          children: [fins({ id: 'pf', name: 'Pod fins', rotation: 0 })],
        },
      ],
      ...extra,
    }) as ComponentNode;

  /**
   * `PodSetDTO.generatePodSetDTOs` writes one pod per instance, as
   * `RocketComponent.splitInstances` makes them: each turned by its share of
   * the circle, named `<name> #<n>`, with the mass override shared.
   */
  it('writes a set of three pods as three pods', () => {
    const podFigures = (id: string) => (id === 'p' ? { mass: 0.01, cgX: 0.05 } : undefined);
    const { xml: out } = write([tube([pod({ instanceCount: 3, overrideMass: 0.03 })])], podFigures);
    const pods = blocks(out, 'ExternalPod');
    expect(pods).toHaveLength(3);
    expect(pods.map((p) => value(p, 'Name'))).toEqual(['Pod #1', 'Pod #2', 'Pod #3']);
    expect(pods.map((p) => Number(value(p, 'RadialAngle') ?? 0))).toEqual(
      [0, 120, 240].map((a) => expect.closeTo(a, 9)),
    );
    for (const p of pods) expect(Number(value(p, 'KnownMass'))).toBeCloseTo(10, 9);
  });

  /**
   * Desktop's LaunchLugHandler applies OD and ID in file order, and
   * LaunchLug.setInnerRadius rebuilds the outer radius as the bore plus the
   * current wall (1 mm on a new lug), so an ID read after the OD would give the
   * lug the bore plus that wall as its outside rather than the stated OD.
   */
  it('writes a launch lug bore before its outside', () => {
    const lug = {
      type: 'launchlug',
      id: 'l',
      name: 'Lug',
      length: 0.03,
      outerRadius: 0.002,
      thickness: 0.0003,
    } as ComponentNode;
    const block = blocks(write([tube([lug])]).xml, 'LaunchLug')[0]!;
    expect(block.indexOf('<ID>')).toBeGreaterThan(-1);
    expect(block.indexOf('<ID>')).toBeLessThan(block.indexOf('<OD>'));
    expect(Number(value(block, 'OD'))).toBeCloseTo(4, 9);
    expect(Number(value(block, 'ID'))).toBeCloseTo(3.4, 9);
  });

  /**
   * RockSim keeps a pod child's angle about the airframe: desktop adds the pod's
   * angle on the way out (`PodSetDTO.addAngleOffsetToChildren`) and takes it off
   * on the way in. A lug with no angle of its own flies at pi, the bridge's
   * default, so it goes out at pi plus the pod's angle.
   */
  it("adds the pod's angle to the angles of the parts inside it, and reads them back", () => {
    const lug = { type: 'launchlug', id: 'l', name: 'Pod lug', length: 0.03, outerRadius: 0.002 } as ComponentNode;
    const turned = pod({ angleOffset: Math.PI / 2 });
    turned.children![0]!.children!.push(lug);
    const { xml: out } = write([tube([turned])]);
    expect(Number(value(blocks(out, 'FinSet')[0]!, 'RadialAngle') ?? 0)).toBeCloseTo(90, 9);
    expect(Number(value(blocks(out, 'LaunchLug')[0]!, 'RadialAngle'))).toBeCloseTo(270, 9);
    const back = importRkt(out).tree.components;
    expect(find(back, 'Pod fins')['rotation']).toBeCloseTo(0, 9);
    expect(find(back, 'Pod lug')['angleOffset']).toBeCloseTo(Math.PI, 9);
  });

  /**
   * `ParallelStageDTO` writes a strap-on booster as a pod that separates
   * (`Detachable` 1), one per instance, and `PodHandler` reads it back as a
   * parallel stage.
   */
  it('writes a strap-on booster as a pod that separates', () => {
    const { xml: out, skipped: s } = write([tube([pod({ type: 'parallelstage', name: 'Booster' })])]);
    expect(s).toEqual([]);
    expect(value(blocks(out, 'ExternalPod')[0]!, 'Detachable')).toBe('1');
    expect(find(importRkt(out).tree.components, 'Booster').type).toBe('parallelstage');
  });
});

/** What RockSim has no element for, named in the result rather than lost quietly. */
describe('exportRkt, overrides RockSim cannot hold', () => {
  // The kernel's figures, as the app passes them, so a mass-only override is written.
  const only = (part: ComponentNode) =>
    exportRkt(
      'x',
      { name: 'x', components: [{ type: 'stage', id: 's', name: 'Sustainer', children: [part] }] } as RocketTree,
      (id) => (id === 'n' ? { mass: 0.03, cgX: 0.06 } : undefined),
    );
  const nose = (extra: Partial<ComponentNode>): ComponentNode =>
    ({ type: 'nosecone', id: 'n', name: 'Nose', length: 0.1, aftRadius: 0.0124, ...extra }) as ComponentNode;

  /**
   * RockSim's one switch covers the part alone (`BaseHandler.setOverride` clears
   * the flags for the parts inside), so an override of everything inside opens as an
   * override of the part, with its children's mass added on top.
   */
  it('names an override that applies to the parts inside', () => {
    const { skipped: s } = only(nose({ overrideMass: 0.05, overrideSubcomponentsMass: true }));
    expect(s).toEqual([{ key: 'errors.rktSkip.subtreeOverride', values: { name: 'Nose' } }]);
  });

  it('names a drag coefficient override, which RockSim has no element for', () => {
    const { skipped: s } = only(nose({ overrideCD: 0.4 }));
    expect(s).toEqual([{ key: 'errors.rktSkip.cdOverride', values: { name: 'Nose' } }]);
  });

  it('names nothing for an override of the part alone', () => {
    expect(only(nose({ overrideMass: 0.05 })).skipped).toEqual([]);
  });
});

/**
 * Desktop's `CustomFinSetDTO.convertFreeFormPoints` writes RockSim's order: the
 * trailing root point first, back to `0,0`, each pair closed by `|`. Desktop's
 * reader and the app's reverse a list that ends at `0,0`, so the outline comes
 * back leading edge first.
 */
describe('exportRkt, a freeform fin outline', () => {
  const freeform = (points: [number, number][]): RocketTree =>
    ({
      name: 'x',
      components: [
        {
          type: 'stage',
          id: 's',
          name: 'Sustainer',
          children: [
            {
              type: 'bodytube',
              id: 'b',
              name: 'Airframe',
              length: 0.3,
              outerRadius: 0.0124,
              children: [{ type: 'freeformfinset', id: 'f', name: 'Fins', finCount: 3, points }],
            },
          ],
        },
      ],
    }) as RocketTree;

  it("is written in RockSim's order, trailing edge first", () => {
    const { xml: out } = exportRkt(
      'x',
      freeform([
        [0, 0],
        [0.02, 0.04],
        [0.05, 0],
      ]),
    );
    expect(out).toContain('<PointList>50,0|20,40|0,0|</PointList>');
  });

  it('starts from the outline the kernel flies, its first point at 0,0', () => {
    const { xml: out } = exportRkt(
      'x',
      freeform([
        [0.01, 0],
        [0.03, 0.04],
        [0.06, 0],
      ]),
    );
    expect(out).toContain('<PointList>50,0|20,40|0,0|</PointList>');
  });

  it('reads back leading edge first', () => {
    const pts: [number, number][] = [
      [0, 0],
      [0.02, 0.04],
      [0.05, 0],
    ];
    const back = find(importRkt(exportRkt('x', freeform(pts)).xml).tree.components, 'Fins');
    expect(back['points']).toEqual(pts);
  });
});

/**
 * RockSim has no automatic values, so a cord length, line length or Cd the
 * kernel works out is written as the number it flies (the kernel's figures, as
 * the app passes them), not the stored one, which is whatever it was when the
 * flag went on. The cord here stores 0.3 m and flies three rocket lengths.
 */
describe('exportRkt, values the kernel works out', () => {
  const blocks = (out: string, tag: string): string[] =>
    [...out.matchAll(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g'))].map((m) => m[0]);
  const value = (block: string, name: string): string | undefined =>
    new RegExp(`<${name}>([^<]*)</${name}>`).exec(block)?.[1];
  const write = (parts: ComponentNode[], figures?: Parameters<typeof exportRkt>[2]) =>
    exportRkt(
      'x',
      {
        name: 'x',
        components: [
          {
            type: 'stage',
            id: 's',
            name: 'Sustainer',
            children: [{ type: 'bodytube', id: 'b', name: 'Tube', length: 0.5, outerRadius: 0.02, children: parts }],
          },
        ],
      } as RocketTree,
      figures,
    );
  const cord = { type: 'shockcord', id: 'c', name: 'Cord', cordLength: 0.3, cordLengthAuto: true } as ComponentNode;
  const chute = {
    type: 'parachute',
    id: 'p',
    name: 'Chute',
    diameter: 0.6,
    lineLength: 0.3,
    lineLengthAuto: true,
  } as ComponentNode;
  const streamer = { type: 'streamer', id: 'st', name: 'Streamer', cd: 0.4, cdAuto: true } as ComponentNode;
  const figures = (id: string) =>
    ({
      c: { mass: 0.01, cgX: 0, cordLength: 3.75 },
      p: { mass: 0.02, cgX: 0, lineLength: 0.9, cd: 0.8 },
      st: { mass: 0.01, cgX: 0, cd: 0.62 },
    })[id];

  it('writes the cord length, line length and Cd the kernel flies', () => {
    const { xml: out, skipped: s } = write([cord, chute, streamer], figures);
    expect(Number(value(blocks(out, 'MassObject')[0]!, 'Len'))).toBeCloseTo(3750, 9);
    expect(Number(value(blocks(out, 'Parachute')[0]!, 'ShroudLineLen'))).toBeCloseTo(900, 9);
    expect(Number(value(blocks(out, 'Streamer')[0]!, 'DragCoefficient'))).toBeCloseTo(0.62, 9);
    expect(s).toEqual([]);
  });

  it('names a part whose automatic value it has no kernel figure for', () => {
    const { skipped: s } = write([chute]);
    expect(s).toEqual([{ key: 'errors.rktSkip.autoValue', values: { name: 'Chute' } }]);
  });
});

/**
 * A part with no position is written where it flies: a fin set's constructor
 * places it at the bottom of its parent (`FinSet`, `AxialMethod.BOTTOM`), so
 * the file says what an explicit bottom, 0 says.
 */
describe('a fin set with no position', () => {
  const withFins = (position?: { method: string; offset: number }): string =>
    exportRkt('Keyless', {
      components: [
        {
          type: 'stage',
          id: 's',
          children: [
            { type: 'nosecone', id: 'n', shape: 'ogive', length: 0.1, aftRadius: 0.02, thickness: 0.002 },
            {
              type: 'bodytube',
              id: 'b',
              length: 0.4,
              outerRadius: 0.02,
              thickness: 0.001,
              children: [
                {
                  type: 'trapezoidfinset',
                  id: 'f',
                  finCount: 3,
                  rootChord: 0.08,
                  tipChord: 0.04,
                  height: 0.05,
                  sweep: 0.03,
                  thickness: 0.003,
                  ...(position ? { position } : {}),
                },
              ],
            },
          ],
        },
      ],
    } as unknown as RocketTree).xml;

  it('goes out at the bottom of its parent, as the kernel places it', () => {
    expect(withFins()).toBe(withFins({ method: 'bottom', offset: 0 }));
    expect(withFins()).not.toBe(withFins({ method: 'top', offset: 0 }));
  });
});
