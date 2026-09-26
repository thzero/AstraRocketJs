// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { exportOrk, importOrk } from '../../src/services/orkFile';
import { COMPONENT_DEFAULTS } from '../../src/services/componentDefaults';
import { KERNEL_DEFAULTS } from '../../src/tree/kernelDefaults';
import type { ComponentNode, RocketTree } from '../../src/engine/openRocketEngine';
import type { LaunchConditions } from '../../src/services/orkTree';

/**
 * Round trips for the fields a code audit found the .ork writer replacing with
 * constants, or the reader parsing three different ways. Each case is the
 * regression test for one finding; the desktop-form fixture in
 * orkDesktopFixture.test.ts is the one that would have caught them first.
 */

const node = (o: object) => o as unknown as ComponentNode;

const findByType = (t: RocketTree, type: string): ComponentNode | undefined => {
  const walk = (ns: ComponentNode[]): ComponentNode | undefined => {
    for (const n of ns) {
      if (n.type === type) return n;
      const hit = walk(n.children ?? []);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(t.components);
};

const wrap = (kids: ComponentNode[]): RocketTree =>
  ({
    components: [
      node({
        type: 'stage',
        id: 's1',
        name: 'S',
        children: [node({ type: 'bodytube', id: 'body', length: 0.3, outerRadius: 0.013, children: kids })],
      }),
    ],
  }) as unknown as RocketTree;

const base: LaunchConditions = {
  launchRodLengthM: 1,
  launchRodAngleDeg: 3,
  windAverage: 4,
  windStdDev: 0.4,
  launchAltitudeM: 100,
  latitudeDeg: 28.61,
  longitudeDeg: -80.6,
  temperatureC: null,
  pressureHPa: null,
};

describe('launch fields the app edits (finding 2)', () => {
  const launch: LaunchConditions = {
    ...base,
    launchIntoWind: true,
    launchRodDirectionDeg: 135,
    windDirectionDeg: 45,
    longitudeDeg: -0.1278,
  };
  const xml = exportOrk({ name: 'L', tree: wrap([]), launch });
  const back = importOrk(xml).launch!;

  it('writes the rod heading in degrees and the wind heading in radians, as OpenRocketSaver does', () => {
    expect(xml).toContain('<launchroddirection>135</launchroddirection>');
    expect(xml).toContain(`<winddirection>${Math.PI / 4}</winddirection>`);
    expect(xml).toContain(`<direction>${Math.PI / 4}</direction>`);
    expect(xml).toContain('<launchintowind>true</launchintowind>');
    expect(xml).toContain('<launchlongitude>-0.1278</launchlongitude>');
  });

  it('brings all four back', () => {
    expect(back.launchIntoWind).toBe(true);
    expect(back.launchRodDirectionDeg).toBe(135);
    expect(back.windDirectionDeg).toBeCloseTo(45, 10);
    expect(back.longitudeDeg).toBe(-0.1278);
  });

  it('falls back to the desktop defaults when they were never set', () => {
    const plain = exportOrk({ name: 'L', tree: wrap([]), launch: base });
    expect(plain).toContain('<launchintowind>false</launchintowind>');
    expect(plain).toContain('<launchroddirection>90</launchroddirection>');
    expect(plain).toContain(`<winddirection>${Math.PI / 2}</winddirection>`);
    expect(plain).toContain('<launchlongitude>-80.6</launchlongitude>');
    expect(plain).not.toContain('>null<');
    expect(plain).not.toContain('>undefined<');
  });
});

describe('recovery packed size (finding 3)', () => {
  const tree = wrap([
    node({ type: 'parachute', id: 'c', diameter: 0.4, length: 0.06, packedRadius: 0.02 }),
    node({ type: 'streamer', id: 's', length: 0.045, packedRadius: 0.015 }),
    node({ type: 'shockcord', id: 'k', length: 0.03, packedRadius: 0.01 }),
  ]);
  const xml = exportOrk({ name: 'R', tree });
  const back = importOrk(xml).tree;

  it('writes the node values, not the MassObject constructor constants', () => {
    expect(xml).toContain('<packedlength>0.06</packedlength>');
    expect(xml).toContain('<packedradius>0.02</packedradius>');
    expect(xml).toContain('<packedlength>0.045</packedlength>');
    expect(xml).toContain('<packedradius>0.015</packedradius>');
    expect(xml).toContain('<packedlength>0.03</packedlength>');
    expect(xml).toContain('<packedradius>0.01</packedradius>');
  });

  it('reads them back on all three devices', () => {
    expect(findByType(back, 'parachute')!['length']).toBe(0.06);
    expect(findByType(back, 'parachute')!['packedRadius']).toBe(0.02);
    expect(findByType(back, 'streamer')!['length']).toBe(0.045);
    expect(findByType(back, 'streamer')!['packedRadius']).toBe(0.015);
    expect(findByType(back, 'shockcord')!['length']).toBe(0.03);
    expect(findByType(back, 'shockcord')!['packedRadius']).toBe(0.01);
  });

  it('keeps the stock size for a device that never said, without growing a key', () => {
    const stock = importOrk(exportOrk({ name: 'R', tree: wrap([node({ type: 'parachute', id: 'c' })]) })).tree;
    const c = findByType(stock, 'parachute')!;
    expect(c['length']).toBe(COMPONENT_DEFAULTS.recovery.packedLength);
    expect(c['packedRadius']).toBeUndefined();
  });
});

describe('rail button geometry and material (finding 4)', () => {
  const tree = wrap([
    node({
      type: 'railbutton',
      id: 'rb',
      outerDiameter: 0.0135,
      innerDiameter: 0.0065,
      height: 0.012,
      baseHeight: 0.003,
      flangeHeight: 0.0025,
      screwHeight: 0.001,
      materialName: 'Aluminum',
      density: 2700,
      materialGroup: 'Metals',
      angleOffset: Math.PI,
    }),
  ]);
  const xml = exportOrk({ name: 'B', tree });
  const back = findByType(importOrk(xml).tree, 'railbutton')!;

  it('writes every dimension and the material from the node', () => {
    expect(xml).toContain('<outerdiameter>0.0135</outerdiameter>');
    expect(xml).toContain('<innerdiameter>0.0065</innerdiameter>');
    expect(xml).toContain('<height>0.012</height>');
    expect(xml).toContain('<baseheight>0.003</baseheight>');
    expect(xml).toContain('<flangeheight>0.0025</flangeheight>');
    expect(xml).toContain('<screwheight>0.001</screwheight>');
    expect(xml).toContain('<material type="bulk" density="2700" group="Metals">Aluminum</material>');
    expect(xml).not.toContain('Delrin');
  });

  it('reads them all back', () => {
    expect(back['outerDiameter']).toBe(0.0135);
    expect(back['innerDiameter']).toBe(0.0065);
    expect(back['height']).toBe(0.012);
    expect(back['baseHeight']).toBe(0.003);
    expect(back['flangeHeight']).toBe(0.0025);
    expect(back['screwHeight']).toBe(0.001);
    expect(back['materialName']).toBe('Aluminum');
    expect(back.density).toBe(2700);
    expect(back['materialGroup']).toBe('Metals');
  });

  it('writes the desktop constructor values for a button that never set them', () => {
    const plain = exportOrk({ name: 'B', tree: wrap([node({ type: 'railbutton', id: 'rb' })]) });
    expect(plain).toContain('<material type="bulk" density="1420" group="Plastics">Delrin</material>');
    expect(plain).toContain('<innerdiameter>0.008</innerdiameter>');
    expect(plain).toContain('<height>0.0097</height>');
    expect(plain).toContain('<screwheight>0</screwheight>');
    // ...and the reader does not grow keys for values equal to those defaults.
    const b = findByType(importOrk(plain).tree, 'railbutton')!;
    expect(b['innerDiameter']).toBeUndefined();
    expect(b['height']).toBeUndefined();
  });
});

describe('fin set angle (finding 11)', () => {
  it('writes the same degrees in <angleoffset> and <rotation>, as RocketComponentSaver does', () => {
    const tree = wrap([node({ type: 'trapezoidfinset', id: 'f', rotation: Math.PI / 4 })]);
    const xml = exportOrk({ name: 'F', tree });
    expect(xml).toContain('<angleoffset method="relative">45</angleoffset>');
    expect(xml).toContain('<rotation>45</rotation>');
    expect(xml).not.toContain('<angleoffset method="relative">0.0</angleoffset>');
    const tubes = exportOrk({ name: 'F', tree: wrap([node({ type: 'tubefinset', id: 't', rotation: Math.PI / 6 })]) });
    expect(tubes).toContain('<angleoffset method="fixed">29.999999999999996</angleoffset>');
    expect(tubes).toContain('<rotation>29.999999999999996</rotation>');
  });
});

describe('one finite-number parse (finding 12)', () => {
  const sim = (inner: string) =>
    `<openrocket><rocket><name>N</name><subcomponents><stage><name>S</name><subcomponents>` +
    `<bodytube><name>B</name><length>0.3</length><radius>0.012</radius></bodytube></subcomponents></stage>` +
    `</subcomponents></rocket><simulations><simulation><name>x</name><conditions>${inner}</conditions></simulation></simulations></openrocket>`;

  it('does not let Infinity through a wind level', () => {
    const xml = sim(
      '<wind model="multilevel" altituderef="MSL"><windlevel altitude="Infinity" speed="1e309" direction="NaN" standarddeviation=""/></wind>' +
        '<windmodeltype>MultiLevel</windmodeltype>',
    );
    const level = importOrk(xml).launch!.windLevels![0]!;
    expect(level).toEqual({ altitudeM: 0, speed: 0, directionDeg: 0, stddev: 0 });
  });

  it('reads a blank axial offset as 0 and a bad one as 0, never NaN', () => {
    const part = (v: string) =>
      `<openrocket><rocket><name>N</name><subcomponents><stage><name>S</name><subcomponents>` +
      `<bodytube><name>B</name><length>0.3</length><radius>0.012</radius><subcomponents>` +
      `<launchlug><axialoffset method="middle">${v}</axialoffset><length>0.03</length></launchlug>` +
      `</subcomponents></bodytube></subcomponents></stage></subcomponents></rocket></openrocket>`;
    for (const v of ['', 'Infinity', 'abc', '   ']) {
      expect(findByType(importOrk(part(v)).tree, 'launchlug')!.position!.offset).toBe(0);
    }
    expect(findByType(importOrk(part(' 0.02 ')).tree, 'launchlug')!.position!.offset).toBe(0.02);
  });

  it('reads a pod offset the same way', () => {
    const pod =
      `<openrocket><rocket><name>N</name><subcomponents><stage><name>S</name><subcomponents>` +
      `<bodytube><name>B</name><length>0.3</length><radius>0.012</radius><subcomponents>` +
      `<podset><name>P</name><radiusoffset method="relative">Infinity</radiusoffset><angleoffset method="relative"></angleoffset>` +
      `<subcomponents><bodytube><length>0.1</length><radius>0.005</radius></bodytube></subcomponents></podset>` +
      `</subcomponents></bodytube></subcomponents></stage></subcomponents></rocket></openrocket>`;
    const p = findByType(importOrk(pod).tree, 'podset')!;
    expect(p['radiusOffset']).toBe(0);
    expect(p['angleOffset']).toBe(0);
  });
});

describe('creator attribute (finding 14)', () => {
  it('names this app, not a program that does not exist', () => {
    const xml = exportOrk({ name: 'C', tree: wrap([]) });
    expect(xml).toMatch(/<openrocket version="1\.10" creator="AstraRocketJs">/);
    expect(xml).not.toContain('ArsRocketJs');
  });
});

describe('shared defaults (finding 15)', () => {
  const bare = (tag: string, inner = '') =>
    `<openrocket><rocket><name>N</name><subcomponents><stage><name>S</name><subcomponents>` +
    `<bodytube><name>B</name><length>0.3</length><radius>0.012</radius><subcomponents>` +
    `<${tag}>${inner}</${tag}></subcomponents></bodytube></subcomponents></stage></subcomponents></rocket></openrocket>`;

  it('reads an engine block with no wall at the kernel default the DXF already cut at', () => {
    const eb = findByType(importOrk(bare('engineblock')).tree, 'engineblock')!;
    expect(eb['thickness']).toBe(KERNEL_DEFAULTS.engineblock.thickness);
    expect(eb['length']).toBe(KERNEL_DEFAULTS.engineblock.length);
  });

  it('reads and writes a bulkhead with no length at the same value', () => {
    const bh = findByType(importOrk(bare('bulkhead')).tree, 'bulkhead')!;
    expect(bh['length']).toBe(KERNEL_DEFAULTS.bulkhead.length);
    const xml = exportOrk({ name: 'D', tree: wrap([node({ type: 'bulkhead', id: 'b' })]) });
    expect(xml).toContain(`<length>${KERNEL_DEFAULTS.bulkhead.length}</length>`);
  });

  it('agrees with the kernel on the nose cone', () => {
    const nc = importOrk(
      `<openrocket><rocket><name>N</name><subcomponents><stage><name>S</name><subcomponents><nosecone/>` +
        `<bodytube><length>0.3</length><radius>0.012</radius></bodytube></subcomponents></stage></subcomponents></rocket></openrocket>`,
    );
    const n = findByType(nc.tree, 'nosecone')!;
    expect(n['length']).toBe(KERNEL_DEFAULTS.nosecone.length);
    expect(n['thickness']).toBe(KERNEL_DEFAULTS.nosecone.thickness);
    expect(n['aftRadius']).toBe(KERNEL_DEFAULTS.nosecone.aftRadius);
  });
});
