// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { exportRkt } from '../../../src/services/files/rktExport';
import { importRkt } from '../../../src/services/files/rktImport';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';

/**
 * The writer, checked two ways.
 *
 * A ROUND TRIP proves the pair agree with each other, which is necessary and
 * not sufficient: reader and writer can share a wrong unit factor and still
 * round-trip perfectly. `rktImport.test.ts` is the other half — it reads a
 * fixture written from RockSim's own schema, so between them a factor can only
 * be wrong in one place at a time. The literal-output checks below pin the few
 * fields where the two sides are NOT symmetric (diameters, shock-cord mass,
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
          // POWER, not ogive: a shape parameter only round-trips on a shape
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
              angleOffset: Math.PI / 6,
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
    // STARTS with the root element, nothing in front of it. Desktop
    // OpenRocket identifies a RockSim file by its first eleven bytes being
    // `<RockSimDoc` exactly (`GeneralRocketLoader.ROCKSIM_SIGNATURE`), unlike
    // the OpenRocket check beside it, which scans the buffer. An XML
    // declaration in front made every `.rkt` this app wrote open as
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
    // …but a parachute's `Dia` is a diameter on both sides and is NOT doubled.
    expect(xml).toContain('<Dia>400</Dia>');
  });

  it('writes masses in grams and angles in degrees', () => {
    expect(xml).toContain('<KnownMass>9.5</KnownMass>'); // 0.0095 kg
    expect(xml).toContain('<CantAngle>1.5</CantAngle>');
    expect(xml).toContain('<RadialAngle>30</RadialAngle>');
    // A shock cord states its MASS in RockSim: 0.006 kg/m over 1 m.
    expect(xml).toContain('<KnownMass>6</KnownMass>');
  });

  it('sets UseKnownCG only on the part that actually overrides', () => {
    // Turning it on makes RockSim stop computing mass AND CG from geometry, so it
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
    expect(s).toContain('railbutton');
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
    ['Fins', ['rootChord', 'tipChord', 'height', 'sweep', 'thickness', 'cant', 'angleOffset', 'tabLength']],
    ['Motor mount', ['length', 'outerRadius', 'thickness', 'motorOverhang']],
    ['Aft ring', ['length', 'outerRadius', 'innerRadius']],
    ['Chute', ['diameter', 'cd', 'lineLength', 'spillHoleDiameter', 'lineDensity', 'surfaceDensity']],
    ['Lug', ['length', 'outerRadius', 'thickness', 'angleOffset']],
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
 * OpenRocket keeps ONE inner tube carrying a cluster pattern, and the desktop
 * splits it on the way out (`InnerBodyTubeDTO.handleCluster`). This writer did
 * not, so a three-motor cluster was saved as a single tube and the file named
 * one motor where the design flies three. Everything mounted inside the mount
 * went with that one tube too.
 *
 * Checked against the desktop's own output for the same design: three members
 * at 10.9697 mm from the axis, 120 degrees apart, each carrying the engine
 * block. The angles are written in degrees here, which is this writer's one
 * deliberate departure from the format; the places are the same ones.
 */
describe('exportRkt — a clustered motor mount', () => {
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

describe('exportRkt — off-axis placement, as desktop writes it', () => {
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
