import { describe, it, expect } from 'vitest';
import type { ComponentNode, RocketTree } from '../engine/openRocketEngine';
import { exportOrk } from './orkExport';
import { wireLoadedOrk } from './wireLoadedOrk';
import type { LoadedOrk } from './loadOrk';
import type { LaunchConditions } from './orkTree';

const node = (o: object) => o as unknown as ComponentNode;

/** A fin set positioned in the ROCKET frame, the way a desktop `.ork` can. */
const absoluteTree = () =>
  ({
    components: [
      node({ type: 'nosecone', id: 'nose', length: 0.3, outerRadius: 0.012 }),
      node({
        type: 'bodytube',
        id: 'body',
        length: 0.4,
        outerRadius: 0.012,
        children: [
          node({
            type: 'trapezoidfinset',
            id: 'fins',
            rootChord: 0.05,
            position: { method: 'absolute', offset: 0.35 },
          }),
        ],
      }),
    ],
  }) as unknown as RocketTree;

const xmlFor = (tree: RocketTree) => exportOrk({ name: 'Rocket', tree } as never);

/**
 * An imported `absolute` position is rewritten into the parent frame on load,
 * because the editor works only in that frame and leaving it made the app draw
 * a part where the engine does not fly it.
 *
 * That rewrite must not leak into what we write back out: `.ork` round-trips
 * are meant to be byte-stable, so the original is kept on the position and the
 * exporter restores it.
 */
describe('exportOrk — imported absolute positions', () => {
  const load = (tree: RocketTree) =>
    wireLoadedOrk(
      { name: 'Rocket', notes: [], tree, motors: {}, motorSpecs: {} } as unknown as LoadedOrk,
      {} as unknown as LaunchConditions,
    ).tree;

  it('writes the original absolute offset back out, unchanged', () => {
    const xml = xmlFor(load(absoluteTree()));
    expect(xml).toContain('<axialoffset method="absolute">0.35</axialoffset>');
    expect(xml).toContain('<position type="absolute">0.35</position>');
  });

  it('round-trips the axial offsets byte-for-byte', () => {
    const before = xmlFor(absoluteTree());
    const after = xmlFor(load(absoluteTree()));
    const offsets = (s: string) => s.match(/<(?:axialoffset|position)[^>]*>[^<]*<\/(?:axialoffset|position)>/g);
    expect(offsets(after)).toEqual(offsets(before));
  });

  it('writes the CURRENT position once the user has moved the part', () => {
    const tree = load(absoluteTree());
    const fins = tree.components[1]!.children![0]! as ComponentNode;
    // A drag in the editor rewrites `offset` and leaves the import marker be;
    // the marker no longer matches, so the edited value is the truthful one.
    fins.position = { ...fins.position!, offset: 0.12 };

    const xml = xmlFor(tree);
    expect(xml).toContain('<axialoffset method="top">0.12</axialoffset>');
    // Narrow: the <rocket> element legitimately carries its own
    // method="absolute" offset, so only the fin set's original must be gone.
    expect(xml).not.toContain('>0.35<');
  });
});
