// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportOrk, importOrk } from '../../../src/services/files/orkFile';
import { walkNodes } from '../../../src/tree/treeWalk';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import { BUILDER_DEFAULT, INSIDE_COLOR_TYPES, partLooks } from '../../../src/services/design/appearance';
import { noteTexts } from '../../testing/importNotes';
import { DEFAULT_PART_COLORS } from '../../../src/services/design/partColors';

/**
 * A part's 3D appearance in a `.ork`: the `<appearance>` and
 * `<insideappearance>` blocks desktop's Appearance tab writes.
 *
 * The expected values are what OpenRocket 24.12 itself loads from this XML
 * (`GeneralRocketLoader` on the release jar, reading each part's
 * `getAppearance()`, `getInsideAppearance()` and the two handler flags), and
 * 24.12 loads the file this app writes from it back to the same values.
 */
const FIXTURE = `<?xml version='1.0' encoding='utf-8'?>
<openrocket version="1.9" creator="OpenRocket 24.12">
  <rocket>
    <name>Probe</name>
    <subcomponents>
      <stage>
        <name>Sustainer</name>
        <subcomponents>
          <nosecone>
            <name>Nose</name>
            <appearance>
              <paint red="10" green="20" blue="30" alpha="255"/>
            </appearance>
            <color red="1" green="2" blue="3"/>
            <length>0.1</length><thickness>0.002</thickness><shape>ogive</shape><aftradius>0.0127</aftradius>
          </nosecone>
          <bodytube>
            <name>Body</name>
            <appearance>
              <paint red="200" green="30" blue="40" alpha="128"/>
              <shine>0.7</shine>
              <opacityaffectstexture>true</opacityaffectstexture>
            </appearance>
            <insideappearance>
              <edgessameasinside>true</edgessameasinside>
              <insidesameasoutside>true</insidesameasoutside>
              <paint red="5" green="6" blue="7" alpha="255"/>
              <shine>0.2</shine>
              <opacityaffectstexture>false</opacityaffectstexture>
            </insideappearance>
            <length>0.3</length><thickness>0.001</thickness><radius>0.0127</radius>
            <subcomponents>
              <trapezoidfinset>
                <name>Fins</name>
                <appearance>
                  <paint red="255" green="0" blue="0" alpha="255"/>
                  <shine>1.5</shine>
                </appearance>
                <insideappearance>
                  <edgesSameAsInside>false</edgesSameAsInside>
                  <insideSameAsOutside>true</insideSameAsOutside>
                  <paint red="0" green="0" blue="255" alpha="255"/>
                  <shine>-1</shine>
                </insideappearance>
                <fincount>3</fincount><rootchord>0.05</rootchord><tipchord>0.02</tipchord><sweeplength>0.02</sweeplength><height>0.03</height><thickness>0.003</thickness>
                <axialoffset method="bottom">0</axialoffset>
              </trapezoidfinset>
              <centeringring>
                <name>Ring</name>
                <appearance>
                  <paint red="12" green="34" blue="56"/>
                  <shine>0.5</shine>
                </appearance>
                <insideappearance>
                  <insidesameasoutside>true</insidesameasoutside>
                  <paint red="9" green="9" blue="9" alpha="255"/>
                </insideappearance>
                <length>0.003</length><outerradius>auto</outerradius><innerradius>0.005</innerradius>
                <axialoffset method="top">0.01</axialoffset>
              </centeringring>
              <launchlug>
                <name>Lug</name>
                <insideappearance>
                  <edgessameasinside>true</edgessameasinside>
                  <paint red="9" green="8" blue="7" alpha="255"/>
                </insideappearance>
                <length>0.03</length><outerradius>0.005</outerradius><thickness>0.001</thickness>
                <axialoffset method="middle">0</axialoffset>
              </launchlug>
            </subcomponents>
          </bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`;

const KEYS = ['color', 'appearance', 'insideAppearance', 'separateInsideOutside', 'edgesSameAsInside'];

/** Each named part's appearance keys, the ones it has. */
function looksByName(tree: RocketTree): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const n of walkNodes(tree.components)) {
    if (n.type === 'stage') continue;
    out[n.name!] = Object.fromEntries(KEYS.filter((k) => n[k] !== undefined).map((k) => [k, n[k]]));
  }
  return out;
}

/** What 24.12 loads from FIXTURE, in the app's terms. */
const DESKTOP = {
  // A block that states only a paint keeps the builder's 0.3 shine.
  Nose: { color: '#010203', appearance: { paint: '#0a141e', alpha: 255, shine: 0.3 } },
  Body: {
    appearance: { paint: '#c81e28', alpha: 128, shine: 0.7, opacityAffectsTexture: true },
    insideAppearance: { paint: '#050607', alpha: 255, shine: 0.2 },
    separateInsideOutside: true,
    edgesSameAsInside: true,
  },
  // Shine clamped to 0-1 by the Appearance constructor; the flags read in their
  // 22.02 beta spellings.
  Fins: {
    appearance: { paint: '#ff0000', alpha: 255, shine: 1 },
    insideAppearance: { paint: '#0000ff', alpha: 255, shine: 0 },
    separateInsideOutside: true,
  },
  // No alpha attribute is opaque. A centering ring has no inside, so the inside
  // block is not applied to it.
  Ring: { appearance: { paint: '#0c2238', alpha: 255, shine: 0.5 } },
  // An inside block with no outside one: the outside stays on the default.
  Lug: { insideAppearance: { paint: '#090807', alpha: 255, shine: 0.3 }, edgesSameAsInside: true },
};

describe('reading a desktop appearance', () => {
  it('reads every part as 24.12 does', () => {
    expect(looksByName(importOrk(FIXTURE).tree)).toEqual(DESKTOP);
  });

  it('reads a paint that is not a color as the builder default, keeping the rest of the block', () => {
    // `ORColor.fromXMLAttributes` returns no color for a channel outside 0-255,
    // and `AppearanceHandler` then leaves the builder's paint in place.
    const xml = FIXTURE.replace('<paint red="12" green="34" blue="56"/>', '<paint red="300" green="34" blue="56"/>');
    expect(looksByName(importOrk(xml).tree)['Ring']).toEqual({
      appearance: { paint: BUILDER_DEFAULT.paint, alpha: 255, shine: 0.5 },
    });
  });

  it('notes nothing about the appearance itself, only a decal it cannot keep', () => {
    expect(noteTexts(importOrk(FIXTURE).notes).join('\n')).not.toMatch(/appearance|decal/i);
  });
});

describe('writing it back', () => {
  const written = () => exportOrk({ name: 'Probe', tree: importOrk(FIXTURE).tree });

  it('reads back to the same values', () => {
    expect(looksByName(importOrk(written()).tree)).toEqual(DESKTOP);
  });

  it('writes the blocks as 24.12 does, inside block flags first', () => {
    const out = written().replace(/^\s+/gm, '');
    expect(out).toContain(
      '<appearance>\n<paint red="200" green="30" blue="40" alpha="128"/>\n<shine>0.7</shine>\n' +
        '<opacityaffectstexture>true</opacityaffectstexture>\n</appearance>\n' +
        '<insideappearance>\n<edgessameasinside>true</edgessameasinside>\n' +
        '<insidesameasoutside>true</insidesameasoutside>\n<paint red="5" green="6" blue="7" alpha="255"/>\n' +
        '<shine>0.2</shine>\n</insideappearance>',
    );
  });

  it('writes the newer opacity flag only when it was set, since 24.12 has no such element', () => {
    const out = written();
    expect(out.match(/<opacityaffectstexture>/g)).toHaveLength(1);
  });

  it('writes nothing for a part on the defaults', () => {
    const tree = importOrk(
      FIXTURE.replace(/<appearance>[\s\S]*?<\/appearance>/g, '').replace(
        /<insideappearance>[\s\S]*?<\/insideappearance>/g,
        '',
      ),
    ).tree;
    const out = exportOrk({ name: 'Probe', tree });
    expect(out).not.toMatch(/appearance>/);
  });

  it('drops the inside flags with an inside left on the default, as desktop saves only inside that block', () => {
    const tree = importOrk(FIXTURE).tree;
    const body = [...walkNodes(tree.components)].find((n) => n.name === 'Body')!;
    delete body['insideAppearance'];
    const back = looksByName(importOrk(exportOrk({ name: 'Probe', tree })).tree)['Body'];
    expect(back).toEqual({ appearance: DESKTOP.Body.appearance });
  });
});

describe('which parts have an inside', () => {
  it('is every rocketcomponent class that implements InsideColorComponent, by our type names', () => {
    const dir = join(__dirname, '../../../../engine-java/src/java/info/openrocket/core/rocketcomponent');
    const classes = readdirSync(dir)
      .filter((f) => f.endsWith('.java'))
      .filter((f) => /class \w+[^{]*implements[^{]*\bInsideColorComponent\b/.test(readFileSync(join(dir, f), 'utf8')))
      .map((f) => f.replace('.java', ''))
      .sort();
    expect(classes).toEqual(['BodyTube', 'FinSet', 'InnerTube', 'LaunchLug', 'NoseCone', 'Transition', 'TubeFinSet']);
    // FinSet is the three planar fin sets.
    expect([...INSIDE_COLOR_TYPES].sort()).toEqual(
      [
        'bodytube',
        'trapezoidfinset',
        'ellipticalfinset',
        'freeformfinset',
        'innertube',
        'launchlug',
        'nosecone',
        'transition',
        'tubefinset',
      ].sort(),
    );
  });
});

describe('what each surface is drawn with', () => {
  // RealisticRenderer.renderComponent: an inside appearance applies only when
  // the two are separate, and the edges follow the inside only when
  // edgesSameAsInside is set.
  const node = (extra: Record<string, unknown>) =>
    ({
      type: 'bodytube',
      appearance: { paint: '#ff0000', alpha: 255, shine: 0.5 },
      insideAppearance: { paint: '#0000ff', alpha: 51, shine: 0.1 },
      ...extra,
    }) as unknown as ComponentNode;
  const red = { color: '#ff0000', shine: 0.5, opacity: 1 };
  const blue = { color: '#0000ff', shine: 0.1, opacity: 0.2 };

  it('draws everything with the outside unless the two are separate', () => {
    expect(partLooks(node({ edgesSameAsInside: true }))).toEqual({ outside: red, inside: red, edges: red });
  });

  it('draws the inside with its own once separate, and the edges with the outside', () => {
    expect(partLooks(node({ separateInsideOutside: true }))).toEqual({ outside: red, inside: blue, edges: red });
  });

  it('draws the edges with the inside when asked', () => {
    expect(partLooks(node({ separateInsideOutside: true, edgesSameAsInside: true }))).toEqual({
      outside: red,
      inside: blue,
      edges: blue,
    });
  });

  it('ignores an inside on a part that has none', () => {
    const ring = { ...node({ separateInsideOutside: true, edgesSameAsInside: true }), type: 'centeringring' };
    expect(partLooks(ring as ComponentNode)).toEqual({ outside: red, inside: red, edges: red });
  });

  it("draws a part with no appearance in its type's default: the palette color and desktop's default shine", () => {
    // DefaultAppearance: ESTES_BT for a body tube (0.3), BALSA for fins (no shine).
    const tube = partLooks({ type: 'bodytube' } as ComponentNode, { ...DEFAULT_PART_COLORS, body: '#123456' });
    expect(tube.outside).toEqual({ color: '#123456', shine: 0.3, opacity: 1 });
    expect(partLooks({ type: 'trapezoidfinset' } as ComponentNode).outside.shine).toBe(0);
  });
});
