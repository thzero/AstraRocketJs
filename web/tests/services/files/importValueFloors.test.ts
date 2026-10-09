// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { importOrk } from '../../../src/services/files/orkFile';
import { importRkt } from '../../../src/services/files/rktImport';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';
import { MAX_FIN_POINTS } from '../../../src/services/files/ork/importLimits';

/**
 * What a file is allowed to say, as opposed to how big it is allowed to be.
 *
 * `orkImportHostile.test.ts` covers the size axis: the zip-bomb caps, the
 * element count, the nesting depth. This covers the value axis. A bare finite
 * check would let a negative length, radius, thickness, chord, mass or override
 * into the tree, the mesh, the mass integral and the kernel. A negative length
 * is not a small part: it is geometry that inverts, and a negative mass override
 * subtracts from the rocket, moving the CG off the airframe and taking the
 * stability margin with it.
 *
 * The `.rkt` reader floors every dimension (`nonNeg`), and this holds the two
 * formats to the same rule.
 */

const ork = (xml: string): ArrayBuffer => {
  const zipped = zipSync({ 'rocket.ork': strToU8(xml) });
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
};

const wrap = (inner: string, stageExtra = '') =>
  `<?xml version="1.0"?><openrocket version="1.8"><rocket><name>T</name>${stageExtra}<subcomponents><stage><name>S</name><subcomponents>${inner}</subcomponents></stage></subcomponents></rocket></openrocket>`;

/** Every node in the imported tree, depth first. */
const flatten = (nodes: ComponentNode[]): ComponentNode[] =>
  nodes.flatMap((n) => [n, ...flatten((n.children ?? []) as ComponentNode[])]);

const nodeOfType = (xml: string, type: string): ComponentNode => {
  const res = importOrk(ork(wrap(xml)));
  const found = flatten(res.tree.components).find((n) => n.type === type);
  if (!found) throw new Error(`no ${type} in the imported tree`);
  return found;
};

describe('a .ork cannot state a negative dimension', () => {
  it('floors a body tube length, radius and wall', () => {
    const n = nodeOfType(
      '<bodytube><name>B</name><length>-0.3</length><radius>-0.012</radius><thickness>-0.001</thickness></bodytube>',
      'bodytube',
    );
    expect(n['length']).toBe(0);
    expect(n['thickness']).toBe(0);
    // The radius goes through `autoRadiusTag`, which already required `> 0`, so
    // a negative one reads as automatic rather than as a number.
    expect(n['outerRadiusAuto']).toBe(true);
  });

  it('floors every trapezoid fin dimension but the sweep', () => {
    const n = nodeOfType(
      `<trapezoidfinset><name>F</name><fincount>3</fincount>
         <rootchord>-0.05</rootchord><tipchord>-0.03</tipchord>
         <sweeplength>-0.02</sweeplength><height>-0.03</height><thickness>-0.003</thickness>
       </trapezoidfinset>`,
      'trapezoidfinset',
    );
    expect(n['rootChord']).toBe(0);
    expect(n['tipChord']).toBe(0);
    expect(n['height']).toBe(0);
    expect(n['thickness']).toBe(0);
    // Signed on purpose: a negative sweep is a forward-swept fin, a real shape
    // the desktop draws. Flooring this one would silently straighten it.
    expect(n['sweep']).toBe(-0.02);
  });

  it('floors a nose cone length and its shape parameter', () => {
    const n = nodeOfType(
      '<nosecone><name>N</name><length>-0.1</length><shape>ogive</shape><shapeparameter>-1</shapeparameter></nosecone>',
      'nosecone',
    );
    expect(n['length']).toBe(0);
    expect(n['shapeParameter']).toBe(0);
  });

  it('floors a launch lug, where the radius is a plain tag and not an auto one', () => {
    const n = nodeOfType(
      '<launchlug><name>L</name><length>-0.05</length><radius>-0.0022</radius><thickness>-0.0003</thickness></launchlug>',
      'launchlug',
    );
    expect(n['length']).toBe(0);
    expect(n['outerRadius']).toBe(0);
    expect(n['thickness']).toBe(0);
  });

  it('floors a mass component, where the value IS the mass', () => {
    const n = nodeOfType(
      '<masscomponent><name>M</name><mass>-0.05</mass><packedlength>-0.02</packedlength><packedradius>-0.01</packedradius></masscomponent>',
      'masscomponent',
    );
    expect(n['mass']).toBe(0);
    expect(n['length']).toBe(0);
    expect(n['radius']).toBe(0);
  });

  it('drops a negative mass, CG or Cd override rather than flooring it', () => {
    // Dropped, not zeroed: an override of zero is a real instruction ("this part
    // weighs nothing"), and a file that states nonsense asked for no override.
    const n = nodeOfType(
      `<bodytube><name>B</name><length>0.3</length><radius>0.012</radius>
         <overridemass>-0.5</overridemass><overridecg>-0.1</overridecg><overridecd>-1</overridecd>
       </bodytube>`,
      'bodytube',
    );
    expect(n['overrideMass']).toBeUndefined();
    expect(n['overrideCGX']).toBeUndefined();
    expect(n['overrideCD']).toBeUndefined();
  });

  it('keeps a zero override, which is a real instruction', () => {
    const n = nodeOfType(
      '<bodytube><name>B</name><length>0.3</length><radius>0.012</radius><overridemass>0</overridemass></bodytube>',
      'bodytube',
    );
    expect(n['overrideMass']).toBe(0);
  });

  it('floors a deploy altitude, the same field the input floors', () => {
    // The UI control passes `min={alt.toUi(0)}` for this exact reason: a
    // negative altitude never fires the kernel trigger, so the design flies
    // ballistic. The file is the other door into the same field.
    const n = nodeOfType(
      '<parachute><name>P</name><diameter>0.3</diameter><deployevent>altitude</deployevent><deployaltitude>-200</deployaltitude></parachute>',
      'parachute',
    );
    expect(n['deployAltitude']).toBe(0);
  });

  it('leaves a valid design untouched', () => {
    const n = nodeOfType(
      '<bodytube><name>B</name><length>0.3</length><radius>0.024</radius><thickness>0.0015</thickness></bodytube>',
      'bodytube',
    );
    expect(n['length']).toBe(0.3);
    expect(n['outerRadius']).toBe(0.024);
    expect(n['thickness']).toBe(0.0015);
  });
});

describe('a <stage active="false"/> flag addresses a stage or is dropped', () => {
  /**
   * `Number(null)` is 0 and `Number('')` is 0, so a naive read of a flag with no
   * `number` attribute would name stage 0 (the sustainer) and ground it. A flag
   * naming a stage the file does not have is dropped rather than guessed at, and
   * a missing or empty number is no exception.
   */
  const twoStage = (flag: string) =>
    `<?xml version="1.0"?><openrocket version="1.8"><rocket><name>T</name>` +
    `<motorconfiguration configid="c1" default="true"><stage number="0" active="true"/>${flag}</motorconfiguration>` +
    `<subcomponents>` +
    `<stage><name>Sustainer</name><subcomponents><bodytube><name>B1</name><length>0.3</length><radius>0.012</radius></bodytube></subcomponents></stage>` +
    `<stage><name>Booster</name><subcomponents><bodytube><name>B2</name><length>0.2</length><radius>0.012</radius></bodytube></subcomponents></stage>` +
    `</subcomponents></rocket></openrocket>`;

  it('grounds the stage the flag names', () => {
    const res = importOrk(ork(twoStage('<stage number="1" active="false"/>')));
    const stages = res.tree.components.filter((c) => c.type === 'stage');
    expect(res.configs[0]!.grounded).toEqual([stages[1]!.id]);
  });

  it('drops a flag with no number rather than grounding the sustainer', () => {
    const res = importOrk(ork(twoStage('<stage active="false"/>')));
    expect(res.configs[0]!.grounded).toEqual([]);
  });

  it('drops a flag whose number is blank', () => {
    const res = importOrk(ork(twoStage('<stage number="" active="false"/>')));
    expect(res.configs[0]!.grounded).toEqual([]);
  });

  it('drops a flag whose number is not a number', () => {
    const res = importOrk(ork(twoStage('<stage number="nope" active="false"/>')));
    expect(res.configs[0]!.grounded).toEqual([]);
  });
});

describe('a RockSim <Color> is normalized or dropped', () => {
  /**
   * The value lands in the node key the schematic hands to SVG `fill` and the 3D
   * view hands to a three.js material, and the `.ork` reader builds `#rrggbb`
   * for the same key. The `.ork` writer's `colorXml` matches
   * `/^#?([0-9a-f]{6})$/i` and silently drops anything else, so a verbatim
   * RockSim color would be lost when the design is saved as `.ork`.
   */
  const rkt = (color: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><RockSimDocument><FileVersion>4</FileVersion>
     <DesignInformation><RocketDesign><Name>C</Name><StageCount>1</StageCount><Stage3Parts>
       <BodyTube><Name>B</Name><Len>300</Len><OD>24.8</OD><ID>21.6</ID><Color>${color}</Color></BodyTube>
     </Stage3Parts></RocketDesign></DesignInformation></RockSimDocument>`;

  const colorOf = (raw: string): unknown => {
    const res = importRkt(rkt(raw));
    return flatten(res.tree.components).find((n) => n.type === 'bodytube')?.['color'];
  };

  it('keeps a hex value, normalized to the one spelling the app means', () => {
    expect(colorOf('#1A2B3C')).toBe('#1a2b3c');
    expect(colorOf('1a2b3c')).toBe('#1a2b3c');
    expect(colorOf('#ABC')).toBe('#aabbcc');
  });

  it('maps a basic color NAME, which is what RockSim writes', () => {
    // Both consumers parse CSS names, so a raw name would render and then vanish
    // on export. Mapped rather than dropped, so the color survives the trip.
    expect(colorOf('Black')).toBe('#000000');
    expect(colorOf('red')).toBe('#ff0000');
  });

  it('drops anything no consumer can read', () => {
    expect(colorOf('chartreuse-ish')).toBeUndefined();
    expect(colorOf('url(#x)')).toBeUndefined();
    expect(colorOf('  ')).toBeUndefined();
  });
});

describe('the freeform point cap bounds what is BUILT, not just what is kept', () => {
  /**
   * The cap has to apply while parsing: `raw.split('|')` would materialize every
   * pair before the first cap test, so a crafted `<PointList>` of a few megabytes
   * would allocate millions of substrings only to keep the first few hundred.
   */
  const rktWithPoints = (points: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><RockSimDocument><FileVersion>4</FileVersion>
     <DesignInformation><RocketDesign><Name>C</Name><StageCount>1</StageCount><Stage3Parts>
       <BodyTube><Name>B</Name><Len>300</Len><OD>24.8</OD><ID>21.6</ID><AttachedParts>
         <CustomFinSet><Name>F</Name><FinCount>3</FinCount><ShapeCode>2</ShapeCode><PointList>${points}</PointList></CustomFinSet>
       </AttachedParts></BodyTube>
     </Stage3Parts></RocketDesign></DesignInformation></RockSimDocument>`;

  const pointsOf = (raw: string): [number, number][] | undefined => {
    const res = importRkt(rktWithPoints(raw));
    return flatten(res.tree.components).find((n) => n.type === 'freeformfinset')?.['points'] as
      [number, number][] | undefined;
  };

  it('reads an ordinary outline unchanged', () => {
    expect(pointsOf('0,0|50,30|50,0')).toEqual([
      [0, 0],
      [0.05, 0.03],
      [0.05, 0],
    ]);
  });

  it('stops at the cap and says so, on a list past it', () => {
    const over = MAX_FIN_POINTS + 500;
    const many = Array.from({ length: over }, (_, i) => `${i},${i}`).join('|');
    const res = importRkt(rktWithPoints(many));
    const pts = flatten(res.tree.components).find((n) => n.type === 'freeformfinset')?.['points'] as
      [number, number][] | undefined;
    expect(pts).toHaveLength(MAX_FIN_POINTS);
    expect(res.notes.some((n) => n.includes('points'))).toBe(true);
  });

  it('skips a malformed pair without ending the scan', () => {
    expect(pointsOf('0,0|bogus|50,30|50,0')).toEqual([
      [0, 0],
      [0.05, 0.03],
      [0.05, 0],
    ]);
  });
});

/**
 * A negative separation altitude reads the way a negative deployment altitude
 * does: floored to 0, in the design and in every configuration's override.
 * Dropping it at the design level would make the stage fall back to 200 m while
 * the configuration recorded 0 m: one file, two answers.
 */
describe('a .ork cannot state a negative separation altitude', () => {
  it('floors it on the stage the way deployment is floored', () => {
    const xml = `<?xml version="1.0"?><openrocket version="1.8"><rocket><name>T</name><subcomponents>
      <stage><name>S</name><subcomponents><bodytube><name>B</name><length>0.3</length><radius>0.012</radius></bodytube></subcomponents></stage>
      <stage><name>Booster</name><separationevent>altitude</separationevent><separationaltitude>-5</separationaltitude>
        <subcomponents><bodytube><name>BB</name><length>0.3</length><radius>0.012</radius></bodytube></subcomponents></stage>
    </subcomponents></rocket></openrocket>`;
    const booster = importOrk(ork(xml)).tree.components[1]!;
    expect(booster['separationAltitude']).toBe(0);
  });
});
