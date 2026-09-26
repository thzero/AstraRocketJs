// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { exportRkt } from '../../src/services/rktExport';
import { importRkt } from '../../src/services/rktImport';
import type { ComponentNode, RocketTree } from '../../src/engine/openRocketEngine';

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
          shape: 'ogive',
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
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<RockSimDocument>');
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
    // Turning it on makes RockSim stop computing mass AND CG from geometry, so
    // it must not appear on a part we had no measured figures for.
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
