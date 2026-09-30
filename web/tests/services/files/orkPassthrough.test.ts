// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { exportOrk, importOrk } from '../../../src/services/files/orkFile';
import {
  KNOWN_COMPONENT_TAGS,
  KNOWN_DOCUMENT_TAGS,
  KNOWN_ROCKET_TAGS,
} from '../../../src/services/files/ork/passthrough';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';

/**
 * What a `.ork` carries that this app has no model for.
 *
 * The desktop's Appearance tab is the case that exists today: paint, shine and a
 * decal per part. Reading it would mean building an editor for it; ignoring it
 * meant every save threw it away, so a design that came here for one dimension
 * went back stripped of its paint. It is carried as raw XML instead.
 *
 * jsdom, because the reader uses `XMLSerializer` to keep the elements.
 */

/** A minimal one-tube design, with `extra` spliced into the body tube. */
const orkWith = (extra: string): string => `<?xml version='1.0' encoding='utf-8'?>
<openrocket version="1.9" creator="OpenRocket 24.12">
  <rocket>
    <name>Appearance test</name>
    <subcomponents>
      <stage>
        <name>Sustainer</name>
        <subcomponents>
          <bodytube>
            <name>Body tube</name>
            <length>0.3</length>
            <thickness>0.001</thickness>
            <outerradius>0.026</outerradius>
${extra}
          </bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`;

const APPEARANCE = `            <appearance>
              <paint red="200" green="30" blue="40" alpha="255"/>
              <shine>0.3</shine>
              <opacityaffectstexture>true</opacityaffectstexture>
            </appearance>`;

const tube = (tree: RocketTree): ComponentNode => (tree.components[0]!.children as ComponentNode[])[0]!;

const roundTrip = (xml: string): string => {
  const res = importOrk(xml);
  return exportOrk({ name: res.name, tree: res.tree });
};

describe('appearance settings survive a round trip', () => {
  it('keeps the paint and the shine, values and all', () => {
    const out = roundTrip(orkWith(APPEARANCE));
    expect(out).toContain('<appearance>');
    expect(out).toContain('<paint red="200" green="30" blue="40" alpha="255"/>');
    expect(out).toContain('<shine>0.3</shine>');
  });

  it('keeps an inside appearance too', () => {
    const inside = `            <insideappearance>
              <edgessameasinside>false</edgessameasinside>
              <paint red="1" green="2" blue="3" alpha="255"/>
            </insideappearance>`;
    const out = roundTrip(orkWith(inside));
    expect(out).toContain('<insideappearance>');
    expect(out).toContain('<edgessameasinside>false</edgessameasinside>');
  });

  it('keeps an element no version of this app has ever seen', () => {
    // The point of carrying by exclusion rather than by a list of known extras:
    // a newer OpenRocket's new tag survives without a code change here.
    const out = roundTrip(orkWith('            <unknown-element>42</unknown-element>'));
    expect(out).toContain('<unknown-element>42</unknown-element>');
  });

  it('is invisible to the app: nothing but the one raw key', () => {
    const t = tube(importOrk(orkWith(APPEARANCE)).tree);
    // No `paint`, no `shine`, no `appearance` object - the panel and the engine
    // see exactly what they saw before.
    expect(Object.keys(t).filter((k) => /paint|shine|appearance/i.test(k))).toEqual([]);
    expect(Array.isArray(t['xmlExtra'])).toBe(true);
  });

  it('adds nothing at all to a design that had none', () => {
    const t = tube(importOrk(orkWith('')).tree);
    expect(t['xmlExtra']).toBeUndefined();
  });

  it('survives two round trips without duplicating or nesting', () => {
    const once = roundTrip(orkWith(APPEARANCE));
    const twice = roundTrip(once);
    expect(twice.match(/<appearance>/g)).toHaveLength(1);
    expect(twice.match(/<shine>/g)).toHaveLength(1);
  });
});

describe('a decal, whose image we do not keep', () => {
  const WITH_DECAL = `            <appearance>
              <paint red="9" green="9" blue="9" alpha="255"/>
              <shine>0.5</shine>
              <decal name="decals/flames.png" rotation="0.0" edgemode="REPEAT">
                <center x="0.0" y="0.0"/>
                <offset x="0.0" y="0.0"/>
                <scale x="1.0" y="1.0"/>
              </decal>
            </appearance>`;

  it('drops the reference rather than writing one that points at nothing', () => {
    // The image is a separate member of the `.ork` zip and we keep no members
    // but the XML, so a preserved <decal name=...> would name a file that is not
    // in the file we write.
    const out = roundTrip(orkWith(WITH_DECAL));
    expect(out).not.toContain('<decal');
    expect(out).not.toContain('flames.png');
  });

  it('keeps the rest of the appearance it was inside', () => {
    const out = roundTrip(orkWith(WITH_DECAL));
    expect(out).toContain('<paint red="9" green="9" blue="9" alpha="255"/>');
    expect(out).toContain('<shine>0.5</shine>');
  });

  it('says so in the import notes, both halves', () => {
    const notes = importOrk(orkWith(WITH_DECAL)).notes.join('\n');
    expect(notes).toMatch(/appearance setting/i);
    expect(notes).toMatch(/decal/i);
  });

  it('says nothing for a design that carries neither', () => {
    const notes = importOrk(orkWith('')).notes.join('\n');
    expect(notes).not.toMatch(/appearance|decal/i);
  });
});

describe('the known-tag set is the whole contract', () => {
  it('claims every tag our own writer puts inside a component', () => {
    // A tag we emit AND treat as unknown would appear twice in the file. This is
    // the drift guard: add a tag to the writer without adding it to the set and
    // this fails, rather than the output quietly doubling.
    const xml = exportOrk({
      name: 'Kitchen sink',
      tree: {
        name: 'Kitchen sink',
        components: [
          {
            id: 's',
            type: 'stage',
            children: [
              { id: 'n', type: 'nosecone', shape: 'ogive', length: 0.1, aftRadius: 0.026, thickness: 0.001 },
              {
                id: 'b',
                type: 'bodytube',
                length: 0.3,
                outerRadius: 0.026,
                thickness: 0.001,
                motorMount: true,
                children: [
                  { id: 'f', type: 'trapezoidfinset', finCount: 3, rootChord: 0.05, tipChord: 0.02, height: 0.04 },
                  { id: 'r', type: 'centeringring', length: 0.003, outerRadius: 0.025, innerRadius: 0.0095 },
                  { id: 'p', type: 'parachute', diameter: 0.4, lineCount: 6, cd: 0.8 },
                  { id: 'c', type: 'shockcord', cordLength: 2 },
                  { id: 'm', type: 'masscomponent', mass: 0.02, length: 0.02, radius: 0.01 },
                  { id: 'l', type: 'launchlug', length: 0.03, outerRadius: 0.005, thickness: 0.0005 },
                  { id: 'rb', type: 'railbutton', outerDiameter: 0.01, innerDiameter: 0.006 },
                ],
              },
              { id: 't', type: 'transition', shape: 'conical', length: 0.05, foreRadius: 0.026, aftRadius: 0.016 },
            ],
          },
        ],
      } as unknown as RocketTree,
    });

    // Exactly the contract: the DIRECT children of a component element, which is
    // the only level `readPassthrough` looks at. Component type names live under
    // <subcomponents> and a motor mount's fields under <motormount>, so neither
    // is a component child and neither belongs in the set.
    const doc = new DOMParser().parseFromString(xml.replace(/^\s*<\?xml[^?]*\?>/, ''), 'text/xml');
    const components = Array.from(doc.querySelectorAll('subcomponents > *'));
    expect(components.length).toBeGreaterThan(8); // the fixture really did export
    const missing = new Set<string>();
    for (const comp of components) {
      for (const child of Array.from(comp.children)) {
        const tag = child.tagName.toLowerCase();
        if (!KNOWN_COMPONENT_TAGS.has(tag)) missing.add(tag);
      }
    }
    expect([...missing]).toEqual([]);
  });
});

/**
 * A `.ork` from the desktop can carry things we do not model at three levels, and
 * only one of them is a component. `<photostudio>` in particular sits beside
 * `<rocket>`, so the component-level pass could never see it: a saved Photo
 * Studio shot was dropped on every save until this existed.
 */

/** A design with `rocketExtra` inside <rocket> and `docExtra> beside it. */
const docWith = (rocketExtra: string, docExtra: string): string => `<?xml version='1.0' encoding='utf-8'?>
<openrocket version="1.9" creator="OpenRocket 24.12">
  <rocket>
    <name>Levels test</name>
${rocketExtra}
    <subcomponents>
      <stage>
        <name>Sustainer</name>
        <subcomponents>
          <bodytube>
            <name>Body tube</name>
            <length>0.3</length>
            <thickness>0.001</thickness>
            <outerradius>0.026</outerradius>
          </bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
${docExtra}
</openrocket>`;

const PHOTO = `  <photostudio>
    <roll>0.5</roll>
    <yaw>1.25</yaw>
    <sky>info.openrocket.swing.gui.figure3d.photo.sky.Mountains</sky>
    <flame>true</flame>
  </photostudio>`;

describe('the levels above a component', () => {
  it('keeps a Photo Studio setup, which is not a component child at all', () => {
    const out = roundTrip(docWith('', PHOTO));
    expect(out).toContain('<photostudio>');
    expect(out).toContain('<yaw>1.25</yaw>');
    expect(out).toContain('<sky>info.openrocket.swing.gui.figure3d.photo.sky.Mountains</sky>');
  });

  it('keeps the document preferences and the custom expressions', () => {
    const extra = `  <datatypes>
    <type source="customexpression"><name>Thrust to weight</name><symbol>TW</symbol></type>
  </datatypes>
  <docprefs>
    <docmaterials><material type="bulk" density="680.0">Plywood (birch)</material></docmaterials>
  </docprefs>`;
    const out = roundTrip(docWith('', extra));
    expect(out).toContain('<datatypes>');
    expect(out).toContain('<docprefs>');
    expect(out).toContain('Thrust to weight');
  });

  it('keeps a kit name, which lives inside <rocket> and had nowhere to go', () => {
    const out = roundTrip(docWith('    <kitname>Estes Alpha III</kitname>', ''));
    expect(out).toContain('<kitname>Estes Alpha III</kitname>');
  });

  it('says in the notes which whole features it has no editor for', () => {
    const notes = importOrk(docWith('', PHOTO)).notes.join('\n');
    expect(notes).toMatch(/no editor for/i);
    expect(notes).toContain('photostudio');
  });

  it('adds nothing and says nothing for a design carrying none of it', () => {
    const res = importOrk(docWith('', ''));
    expect(res.tree.xmlExtra).toBeUndefined();
    expect(res.tree.docExtra).toBeUndefined();
    expect(res.notes.join('\n')).not.toMatch(/no editor for/i);
  });

  it('survives two round trips without duplicating', () => {
    const twice = roundTrip(roundTrip(docWith('    <kitname>Alpha</kitname>', PHOTO)));
    expect(twice.match(/<photostudio>/g)).toHaveLength(1);
    expect(twice.match(/<kitname>/g)).toHaveLength(1);
  });
});

describe('what the stability calibers are measured against', () => {
  it('keeps a custom reference length instead of re-measuring the design', () => {
    // A writer that emits a hardcoded `maximum` brings a design whose calibers
    // were set against a fixed length back measured against its widest body tube -
    // a different stability number for the same rocket.
    const ref = `    <referencetype>custom</referencetype>
    <customreference>0.0331</customreference>`;
    const res = importOrk(docWith(ref, ''));
    expect(res.tree.referenceType).toBe('custom');
    expect(res.tree.customReference).toBeCloseTo(0.0331, 9);
    const out = exportOrk({ name: res.name, tree: res.tree });
    expect(out).toContain('<referencetype>custom</referencetype>');
    expect(out).toContain('<customreference>0.0331</customreference>');
  });

  it('writes the element once, not twice, since it is a known tag and not carried', () => {
    // `nosecone`, `maximum` and `custom` are the whole vocabulary
    // (ReferenceType.java); this is the one that is neither our default nor the
    // custom-length case.
    const out = roundTrip(docWith('    <referencetype>nosecone</referencetype>', ''));
    expect(out.match(/<referencetype>/g)).toHaveLength(1);
    expect(out).toContain('<referencetype>nosecone</referencetype>');
  });

  it('leaves the default off the tree and still writes it', () => {
    const res = importOrk(docWith('    <referencetype>maximum</referencetype>', ''));
    // `maximum` is what this app measures against, so recording it would put the
    // same word on every tree for nothing.
    expect(res.tree.referenceType).toBeUndefined();
    expect(exportOrk({ name: res.name, tree: res.tree })).toContain('<referencetype>maximum</referencetype>');
  });
});

describe('the upper known-tag sets', () => {
  it('claim every tag our own writer puts at those levels', () => {
    const xml = exportOrk({
      name: 'Frame',
      tree: {
        name: 'Frame',
        designer: 'Someone',
        comment: 'A note',
        revision: 'rev 2',
        components: [
          { id: 's', type: 'stage', children: [{ id: 'b', type: 'bodytube', length: 0.3, outerRadius: 0.026 }] },
        ],
      } as unknown as RocketTree,
    });
    const doc = new DOMParser().parseFromString(xml.replace(/^\s*<\?xml[^?]*\?>/, ''), 'text/xml');
    const kids = (sel: string) => Array.from(doc.querySelectorAll(sel)).map((e) => e.tagName.toLowerCase());
    expect(kids('openrocket > *').filter((t) => !KNOWN_DOCUMENT_TAGS.has(t))).toEqual([]);
    expect(kids('openrocket > rocket > *').filter((t) => !KNOWN_ROCKET_TAGS.has(t))).toEqual([]);
  });
});
