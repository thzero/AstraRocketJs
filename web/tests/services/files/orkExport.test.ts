import { describe, it, expect } from 'vitest';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import { exportOrk } from '../../../src/services/files/orkExport';
import { wireLoadedOrk } from '../../../src/services/files/wireLoadedOrk';
import type { LoadedOrk } from '../../../src/services/files/loadOrk';
import type { LaunchConditions } from '../../../src/services/design/orkTree';

const node = (o: object) => o as unknown as ComponentNode;

/** A fin set positioned in the rocket frame, the way a desktop `.ork` can. */
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
 * An imported `absolute` position stays absolute on load: every reader measures
 * it from the nose tip, as the kernel does, and the editor offers the method.
 * What goes back out is what the file said, or the user's edit of it, in the
 * same frame: `.ork` round-trips are meant to be byte-stable.
 */
describe('exportOrk: imported absolute positions', () => {
  const load = (tree: RocketTree) =>
    wireLoadedOrk(
      {
        name: 'Rocket',
        notes: [],
        tree,
        motors: {},
        configs: [{ id: 'cfg-1', name: null, motors: {} }],
        chosenConfigId: 'cfg-1',
      } as unknown as LoadedOrk,
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
    // An edit in the editor rewrites `offset` in the method the part shows.
    fins.position = { ...fins.position!, offset: 0.42 };

    const xml = xmlFor(tree);
    expect(xml).toContain('<axialoffset method="absolute">0.42</axialoffset>');
    // Narrow: the <rocket> element legitimately carries its own
    // method="absolute" offset, so only the fin set's original must be gone.
    expect(xml).not.toContain('>0.35<');
  });
});

/**
 * `<isdrogue>` decides which recovery warnings a flight can raise at all: the
 * kernel judges a stage with a drogue against the dual-deployment thresholds and
 * everything else against the single one. Losing the flag on a round trip
 * silently downgrades a dual-deployment design to single deployment, so the
 * element has to survive both ways.
 */
describe('exportOrk - the drogue flag', () => {
  const chuteTree = (drogue?: boolean) =>
    ({
      components: [
        node({ type: 'nosecone', id: 'nose', length: 0.3, outerRadius: 0.012 }),
        node({
          type: 'bodytube',
          id: 'body',
          length: 0.4,
          outerRadius: 0.012,
          children: [node({ type: 'parachute', id: 'chute', diameter: 0.3, ...(drogue == null ? {} : { drogue }) })],
        }),
      ],
    }) as unknown as RocketTree;

  it('writes the element only for a drogue, as the desktop saver does', () => {
    expect(xmlFor(chuteTree(true))).toContain('<isdrogue>true</isdrogue>');
    // Not `<isdrogue>false</isdrogue>`: RecoveryDeviceSaver omits it entirely
    // for a main, and a file that differs from the desktop's is a diff to explain.
    expect(xmlFor(chuteTree(false))).not.toContain('isdrogue');
    expect(xmlFor(chuteTree())).not.toContain('isdrogue');
  });
});

/**
 * A design can be saved mid-edit with a required launch field still blank,
 * even though it cannot be flown. `LaunchConditions` models those holes as
 * `null`, and a hole is written as zero rather than blocking the save, never as
 * the literal string "null" where a number belongs.
 *
 * A "null" would be dropped silently on re-import (numTag -> NaN -> fallback),
 * and desktop OpenRocket 24.12 logs a parse warning on every one.
 */
describe('exportOrk - a blank launch field', () => {
  const blank = (): LaunchConditions =>
    ({
      launchRodLengthM: null,
      launchRodAngleDeg: null,
      windAverage: null,
      windStdDev: null,
      launchAltitudeM: null,
      latitudeDeg: null,
    }) as unknown as LaunchConditions;

  const xml = () => exportOrk({ name: 'Rocket', tree: absoluteTree(), launch: blank() } as never);

  it('never writes the literal string "null" into the file', () => {
    expect(xml()).not.toContain('>null<');
  });

  it('writes zero for each of the six nullable conditions', () => {
    const out = xml();
    for (const tag of [
      'launchrodlength',
      'launchrodangle',
      'launchaltitude',
      'launchlatitude',
      'speed',
      'standarddeviation',
    ]) {
      expect(out).toContain(`<${tag}>0</${tag}>`);
    }
  });
});
