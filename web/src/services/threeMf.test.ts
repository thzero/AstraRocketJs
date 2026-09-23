// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildThreeMf, threeMfModelXml } from './threeMf';
import { makeWatertight, solidForNode } from './solidMesh';
import { printableParts } from './rocketPrintExport';
import type { ComponentNode, RocketTree } from '../engine/openRocketEngine';

/**
 * The 3MF writer, checked against the format rather than against itself.
 *
 * There is no round trip to lean on here — nothing in the app reads 3MF — so
 * the file is unzipped, its model parsed as XML, and the parts a slicer
 * actually needs are asserted: the three OPC members, the declared unit, one
 * named object per part, and a triangle list whose indices are in range. A
 * writer that emits plausible-looking XML with out-of-range indices produces a
 * file that opens and slices to nothing.
 */

const nose = (): THREE_GEOMETRY =>
  makeWatertight(
    solidForNode({ type: 'nosecone', id: 'n', length: 0.1, aftRadius: 0.0124, thickness: 0.0015, shape: 'ogive' })!,
  );
type THREE_GEOMETRY = ReturnType<typeof makeWatertight>;

const parts = [
  { name: 'Nose cone', geometry: nose(), color: '#b9c2cc' },
  { name: 'Second part', geometry: nose() },
];

const archive = unzipSync(buildThreeMf(parts));
const model = strFromU8(archive['3D/3dmodel.model']!);
const doc = new DOMParser().parseFromString(model, 'text/xml');

describe('buildThreeMf', () => {
  it('writes the three members an OPC package needs', () => {
    // A 3MF missing the content types or the relationship is a zip, not a 3MF,
    // and slicers reject it before they ever look at the geometry.
    expect(Object.keys(archive).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
    expect(strFromU8(archive['[Content_Types].xml']!)).toContain('3dmanufacturing-3dmodel+xml');
    expect(strFromU8(archive['_rels/.rels']!)).toContain('/3D/3dmodel.model');
  });

  it('produces a model that parses, in millimeters', () => {
    expect(doc.querySelector('parsererror')).toBeNull();
    // The unit is the difference between a 100 mm nose cone and a 100 m one.
    expect(doc.documentElement.getAttribute('unit')).toBe('millimeter');
  });

  it('gives every part its own named object and build item', () => {
    // The whole reason to prefer 3MF over STL: the slicer's object list reads
    // "Nose cone", not "part1.stl".
    const objects = Array.from(doc.querySelectorAll('object'));
    expect(objects.map((o) => o.getAttribute('name'))).toEqual(['Nose cone', 'Second part']);
    expect(doc.querySelectorAll('build > item')).toHaveLength(2);

    // Object ids are unique, and each item points at one that exists.
    const ids = objects.map((o) => o.getAttribute('id'));
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of Array.from(doc.querySelectorAll('build > item'))) {
      expect(ids).toContain(item.getAttribute('objectid'));
    }
  });

  it('keeps every triangle index inside its own vertex list', () => {
    for (const obj of Array.from(doc.querySelectorAll('object'))) {
      const count = obj.querySelectorAll('vertices > vertex').length;
      expect(count).toBeGreaterThan(3);
      for (const tri of Array.from(obj.querySelectorAll('triangles > triangle'))) {
        for (const a of ['v1', 'v2', 'v3']) {
          const v = Number(tri.getAttribute(a));
          expect(Number.isInteger(v) && v >= 0 && v < count, `${a}=${v} of ${count}`).toBe(true);
        }
      }
    }
  });

  it('converts meters to millimeters', () => {
    // The nose cone is 0.1 m long on the X axis; 3MF must see 100.
    const xs = Array.from(doc.querySelectorAll('object vertices > vertex')).map((v) => Number(v.getAttribute('x')));
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(100, 3);
  });

  it('carries the part color, and falls back to neutral', () => {
    const bases = Array.from(doc.querySelectorAll('basematerials > base'));
    expect(bases[0]!.getAttribute('displaycolor')).toBe('#B9C2CCFF');
    expect(bases[1]!.getAttribute('displaycolor')).toBe('#CFCABFFF');
  });

  it('drops each part onto the plate when asked, and not when not', () => {
    const transformOf = (xml: string): number[] =>
      xml
        .match(/transform="([^"]+)"/)![1]!
        .split(' ')
        .map(Number);
    // Placed: centered on X/Y and resting at Z = 0, so the translation is
    // non-zero on at least the axis the part is long on.
    const placed = transformOf(threeMfModelXml(parts, { placeOnPlate: true }));
    expect(placed.slice(9).some((v) => v !== 0)).toBe(true);
    // Not placed: the identity, so the part keeps its position in the rocket.
    expect(transformOf(threeMfModelXml(parts, { placeOnPlate: false })).slice(9)).toEqual([0, 0, 0]);
  });

  it('refuses to write an empty package', () => {
    // A zip with no objects opens and slices to nothing, which is a worse
    // outcome than an error.
    expect(() => buildThreeMf([])).toThrow(/nothing to export/i);
  });
});

describe('printableParts', () => {
  const tree: RocketTree = {
    name: 'Printable',
    components: [
      {
        type: 'stage',
        id: 's',
        children: [
          { type: 'nosecone', id: 'n', name: 'Nose' },
          {
            type: 'bodytube',
            id: 'b',
            name: 'Body',
            children: [
              { type: 'trapezoidfinset', id: 'f', name: 'Fins' },
              { type: 'parachute', id: 'p', name: 'Chute' },
              { type: 'masscomponent', id: 'm', name: 'Altimeter' },
              { type: 'centeringring', id: 'r', name: 'Ring' },
            ],
          },
        ],
      } as ComponentNode,
    ],
  };

  it('lists what has a solid and leaves out what does not', () => {
    const names = printableParts(tree).map((p) => p.name);
    expect(names).toEqual(['Nose', 'Body', 'Fins', 'Ring']);
    // A parachute and a mass component have no body to print, so offering them
    // a tick box would be offering a control that does nothing.
    expect(names).not.toContain('Chute');
    expect(names).not.toContain('Altimeter');
  });

  it('indents a part under the printable part it sits inside', () => {
    const byName = Object.fromEntries(printableParts(tree).map((p) => [p.name, p.depth]));
    expect(byName['Nose']).toBe(0);
    expect(byName['Body']).toBe(0);
    expect(byName['Fins']).toBe(1);
  });
});
