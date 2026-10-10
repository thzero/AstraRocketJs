// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { exportRkt } from '../../../src/services/files/rktExport';
import { importRkt } from '../../../src/services/files/rktImport';
import { axialLength, partLength, resolveFilePositions, startFromPosition } from '../../../src/tree/position';
import { positionOf } from '../../../src/tree/nodeProps';
import { isChainType } from '../../../src/tree/componentKinds';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';

/**
 * A tube coupler's own parts in a RockSim file.
 *
 * Desktop's RingHandler reads nothing nested in a `<Ring>`, so the writer puts
 * a coupler's parts beside it in its parent, each at its station from the nose
 * tip, as desktop's TubeCouplerDTO does. Our own reader keeps nested parts, so
 * a plain round trip cannot show the loss; these checks read the XML itself.
 */

const design: RocketTree = {
  name: 'E-bay',
  components: [
    {
      type: 'stage',
      id: 's1',
      name: 'Sustainer',
      children: [
        { type: 'nosecone', id: 'n', name: 'Nose', length: 0.1, aftRadius: 0.02, shape: 'ogive' },
        {
          type: 'bodytube',
          id: 'b',
          name: 'Airframe',
          length: 0.5,
          outerRadius: 0.02,
          thickness: 0.001,
          children: [
            {
              type: 'tubecoupler',
              id: 'tc',
              name: 'Coupler',
              length: 0.15,
              outerRadius: 0.019,
              thickness: 0.001,
              position: { method: 'top', offset: 0.2 },
              children: [
                { type: 'bulkhead', id: 'fp', name: 'Fwd plate', length: 0.005, outerRadius: 0.018 },
                {
                  type: 'bulkhead',
                  id: 'ap',
                  name: 'Aft plate',
                  length: 0.005,
                  outerRadius: 0.018,
                  position: { method: 'bottom', offset: 0 },
                },
                {
                  type: 'masscomponent',
                  id: 'alt',
                  name: 'Altimeter',
                  length: 0.03,
                  mass: 0.02,
                  position: { method: 'middle', offset: 0.01 },
                },
                {
                  type: 'tubecoupler',
                  id: 'tc2',
                  name: 'Inner coupler',
                  length: 0.05,
                  outerRadius: 0.017,
                  thickness: 0.001,
                  position: { method: 'top', offset: 0.04 },
                  children: [
                    {
                      type: 'bulkhead',
                      id: 'ip',
                      name: 'Inner plate',
                      length: 0.004,
                      outerRadius: 0.016,
                      position: { method: 'bottom', offset: 0 },
                    },
                  ],
                },
              ],
            },
          ],
        },
        { type: 'bodytube', id: 'b2', name: 'Aft tube', length: 0.3, outerRadius: 0.02, thickness: 0.001 },
      ],
    },
  ],
} as unknown as RocketTree;

/** Every named part's front station (m from the nose tip), laid out as the app lays it out. */
function stations(tree: RocketTree): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (parent: ComponentNode, start: number, chained: boolean): void => {
    const pLen = axialLength(parent);
    let x = start;
    for (const kid of parent.children ?? []) {
      let at: number;
      if (chained && isChainType(kid.type)) {
        at = x;
        x += partLength(kid);
      } else at = start + startFromPosition(positionOf(kid), axialLength(kid), pLen);
      out.set(kid.name ?? kid.type, at);
      walk(kid, at, false);
    }
  };
  let stageStart = 0;
  for (const stage of resolveFilePositions(tree).components) {
    walk(stage, stageStart, true);
    stageStart += (stage.children ?? []).reduce((s, n) => s + (isChainType(n.type) ? partLength(n) : 0), 0);
  }
  return out;
}

const xml = exportRkt('E-bay', design).xml;
const doc = new DOMParser().parseFromString(xml, 'application/xml');

const nameOf = (el: Element): string | undefined =>
  Array.from(el.children).find((c) => c.tagName === 'Name')?.textContent ?? undefined;
const field = (el: Element, tag: string): string | undefined =>
  Array.from(el.children).find((c) => c.tagName === tag)?.textContent ?? undefined;

/** The parts directly in the airframe's attached parts, in file order. */
function airframeParts(): Element[] {
  const tube = Array.from(doc.getElementsByTagName('BodyTube')).find((e) => nameOf(e) === 'Airframe')!;
  const attached = Array.from(tube.children).find((c) => c.tagName === 'AttachedParts')!;
  return Array.from(attached.children);
}

describe('exportRkt, a tube coupler with parts inside it', () => {
  it('writes the coupler parts after the coupler in its parent, not inside the Ring', () => {
    expect(airframeParts().map(nameOf)).toEqual([
      'Coupler',
      'Fwd plate',
      'Aft plate',
      'Altimeter',
      'Inner coupler',
      'Inner plate',
    ]);
  });

  it('writes each lifted part from the nose tip, at the station it flies', () => {
    const want = stations(design);
    const lifted = airframeParts().slice(1);
    expect(lifted).toHaveLength(5);
    for (const el of lifted) {
      const name = nameOf(el)!;
      expect(field(el, 'LocationMode'), name).toBe('1');
      expect(Number(field(el, 'Xb')), name).toBeCloseTo(want.get(name)! * 1000, 6);
    }
    // Spot values, so the shared layout helper cannot hide a frame error.
    expect(want.get('Aft plate')).toBeCloseTo(0.1 + 0.2 + 0.15 - 0.005, 9);
    expect(want.get('Altimeter')).toBeCloseTo(0.1 + 0.2 + (0.15 - 0.03) / 2 + 0.01, 9);
  });

  it('places an inner coupler and its parts from the inner coupler station', () => {
    const parts = airframeParts();
    const inner = parts.find((e) => nameOf(e) === 'Inner coupler')!;
    const plate = parts.find((e) => nameOf(e) === 'Inner plate')!;
    expect(Number(field(inner, 'Xb'))).toBeCloseTo((0.1 + 0.2 + 0.04) * 1000, 6);
    expect(Number(field(plate, 'Xb'))).toBeCloseTo((0.1 + 0.2 + 0.04 + 0.05 - 0.004) * 1000, 6);
  });

  it('leaves no Ring with attached parts in it', () => {
    for (const ring of Array.from(doc.getElementsByTagName('Ring'))) {
      const attached = Array.from(ring.children).filter((c) => c.tagName === 'AttachedParts');
      expect(
        attached.every((a) => a.children.length === 0),
        nameOf(ring),
      ).toBe(true);
    }
  });

  it('reads back with every part at the station it had', () => {
    const before = stations(design);
    const after = stations(importRkt(xml).tree);
    for (const name of ['Coupler', 'Fwd plate', 'Aft plate', 'Altimeter', 'Inner coupler', 'Inner plate', 'Aft tube']) {
      expect(after.get(name), name).toBeCloseTo(before.get(name)!, 9);
    }
  });

  it('names nothing as skipped, since no part is lost', () => {
    expect(exportRkt('E-bay', design).skipped).toEqual([]);
  });
});
