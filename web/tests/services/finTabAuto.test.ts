import { describe, expect, it } from 'vitest';
import type { ComponentNode, RocketTree } from '../../src/engine/openRocketEngine';
import { autoFinTab, canAutoFinTab } from '../../src/services/finTabAuto';

/**
 * Calculate automatically, for a through-the-wall fin tab.
 *
 * The tab has to fit between the centering rings, reach down to the motor mount
 * and no further, and stay inside the root chord. The cases below are the ones
 * upstream's own comment enumerates, which is where the interest is: a ring
 * straddling an end of the root, a ring outside it entirely, two rings glued
 * together, and a ring no wider than the tube it is centering.
 *
 * All dimensions in meters. The body is a 300 mm tube of 26 mm radius and the
 * mount is a 19 mm-diameter tube, so a full-depth tab is 26 - 9.5 = 16.5 mm.
 */

const node = (o: Record<string, unknown>): ComponentNode => o as unknown as ComponentNode;

const MOUNT_R = 0.0095;
const BODY_R = 0.026;

const fins = (extra: Record<string, unknown> = {}) =>
  node({ id: 'fins', type: 'trapezoidfinset', finCount: 3, rootChord: 0.1, tipChord: 0.05, height: 0.05, ...extra });

/** A 300 mm body tube holding `inside`, with the fin set on its outside. */
const body = (inside: ComponentNode[], fin: ComponentNode = fins(), bodyExtra: Record<string, unknown> = {}) =>
  ({
    name: 'R',
    components: [
      {
        id: 'st',
        type: 'stage',
        children: [
          {
            id: 'tube',
            type: 'bodytube',
            length: 0.3,
            outerRadius: BODY_R,
            thickness: 0.001,
            children: [...inside, fin],
            ...bodyExtra,
          },
        ],
      },
    ],
  }) as unknown as RocketTree;

const mount = (extra: Record<string, unknown> = {}) =>
  node({
    id: 'mount',
    type: 'innertube',
    length: 0.2,
    outerRadius: MOUNT_R,
    position: { method: 'bottom', offset: 0 },
    ...extra,
  });

const ring = (id: string, offset: number, thickness = 0.003, outerRadius = 0.025) =>
  node({ id, type: 'centeringring', length: thickness, outerRadius, position: { method: 'top', offset } });

const tab = (tree: RocketTree) => autoFinTab(tree, 'fins')!;

describe('when it is offered at all', () => {
  const tube = node({ type: 'bodytube' });
  it('is offered for a planar fin set on a symmetric body', () => {
    expect(canAutoFinTab(fins(), tube)).toBe(true);
    expect(canAutoFinTab(node({ type: 'freeformfinset' }), tube)).toBe(true);
    expect(canAutoFinTab(fins(), node({ type: 'nosecone' }))).toBe(true);
  });

  it('is not offered for tube fins, which have no tab, or with no parent', () => {
    expect(canAutoFinTab(node({ type: 'tubefinset' }), tube)).toBe(false);
    expect(canAutoFinTab(fins(), null)).toBe(false);
    expect(canAutoFinTab(fins(), node({ type: 'podset' }))).toBe(false);
  });
});

describe('the depth of the tab', () => {
  it('reaches from the body down to the motor mount', () => {
    // 26 mm of body radius less the 9.5 mm mount tube.
    expect(tab(body([mount()]))['tabHeight']).toBeCloseTo(BODY_R - MOUNT_R, 12);
  });

  it('is the whole body radius when there is no mount tube under the fin', () => {
    expect(tab(body([]))['tabHeight']).toBeCloseTo(BODY_R, 12);
  });

  it('ignores a mount tube that does not reach under the fin', () => {
    // A 40 mm tube at the very front of a 300 mm body, with the fin at the back.
    const forward = mount({ length: 0.04, position: { method: 'top', offset: 0 } });
    expect(tab(body([forward], fins({ position: { method: 'bottom', offset: 0 } })))['tabHeight']).toBeCloseTo(
      BODY_R,
      12,
    );
  });

  it('takes the NARROWER end of a tapering body, not the wider one', () => {
    // A boat tail: 26 mm down to 16 mm. Cutting to the wider end would put the
    // tab through the skin at the back.
    const boat = {
      name: 'R',
      components: [
        {
          id: 'st',
          type: 'stage',
          children: [
            {
              id: 'tr',
              type: 'transition',
              shape: 'conical',
              length: 0.2,
              foreRadius: BODY_R,
              aftRadius: 0.016,
              children: [
                mount({ length: 0.2, position: { method: 'top', offset: 0 } }),
                fins({ position: { method: 'top', offset: 0.05 } }),
              ],
            },
          ],
        },
      ],
    } as unknown as RocketTree;
    // The fin runs 50 to 150 mm along a 200 mm cone, where the radius falls from
    // 23.5 to 18.5 mm; the tab is cut to the aft end.
    expect(tab(boat)['tabHeight']).toBeCloseTo(0.0185 - MOUNT_R, 6);
  });
});

describe('where the tab sits along the root', () => {
  it('is the whole root chord when no ring is in the way', () => {
    const t = tab(body([mount()], fins({ position: { method: 'top', offset: 0.1 } })));
    expect(t['tabOffsetMethod']).toBe('top');
    expect(t['tabOffset']).toBe(0);
    expect(t['tabLength']).toBeCloseTo(0.1, 12);
  });

  it('runs between two rings that bracket the fin root', () => {
    // Rings at 100 and 190 mm, 3 mm thick; the fin root runs 100 to 200 mm.
    const t = tab(
      body([mount(), ring('r1', 0.1), ring('r2', 0.19)], fins({ position: { method: 'top', offset: 0.1 } })),
    );
    // From the aft face of the front ring to the fore face of the back one.
    expect(t['tabOffset']).toBeCloseTo(0.003, 12);
    expect(t['tabLength']).toBeCloseTo(0.19 - 0.103, 12);
  });

  it('stops at the trailing edge when the aft ring is past it', () => {
    // Front ring at 100 mm, back ring at 250 mm, fin root 100 to 200 mm.
    const t = tab(
      body([mount(), ring('r1', 0.1), ring('r2', 0.25)], fins({ position: { method: 'top', offset: 0.1 } })),
    );
    expect(t['tabOffset']).toBeCloseTo(0.003, 12);
    expect(t['tabLength']).toBeCloseTo(0.2 - 0.103, 12);
  });

  it('starts at the leading edge when the forward ring is ahead of the root', () => {
    // Ring at 50 mm, well clear of a root that starts at 100 mm.
    const t = tab(
      body([mount(), ring('r1', 0.05), ring('r2', 0.15)], fins({ position: { method: 'top', offset: 0.1 } })),
    );
    expect(t['tabOffset']).toBe(0);
    expect(t['tabLength']).toBeCloseTo(0.05, 12);
  });

  it('treats two rings glued face to face as one obstruction', () => {
    // 3 mm rings at 100 and 103 mm: one 6 mm block, not a zero-length gap
    // between them. A third ring at 190 mm gives the tab its far end.
    const t = tab(
      body(
        [mount(), ring('r1', 0.1), ring('r2', 0.103), ring('r3', 0.19)],
        fins({ position: { method: 'top', offset: 0.1 } }),
      ),
    );
    expect(t['tabOffset']).toBeCloseTo(0.006, 12);
    expect(t['tabLength']).toBeCloseTo(0.19 - 0.106, 12);
  });

  it('ignores a ring no wider than the tube it centers', () => {
    // A ring flush with the mount tube blocks nothing: the tab already clears it
    // at the depth the tube forces.
    const flush = ring('r1', 0.15, 0.003, MOUNT_R);
    const t = tab(body([mount(), flush], fins({ position: { method: 'top', offset: 0.1 } })));
    expect(t['tabOffset']).toBe(0);
    expect(t['tabLength']).toBeCloseTo(0.1, 12);
  });

  it('never returns a negative length', () => {
    // Rings overlapping the whole root from both ends.
    const t = tab(
      body(
        [mount(), ring('r1', 0.09, 0.02), ring('r2', 0.1, 0.02)],
        fins({ position: { method: 'top', offset: 0.1 } }),
      ),
    );
    expect(t['tabLength'] as number).toBeGreaterThanOrEqual(0);
  });
});

describe('when there is nothing to compute', () => {
  it('answers null for a fin set on a pod rather than a body', () => {
    const t = {
      name: 'R',
      components: [{ id: 'st', type: 'stage', children: [{ id: 'pod', type: 'podset', children: [fins()] }] }],
    } as unknown as RocketTree;
    expect(autoFinTab(t, 'fins')).toBeNull();
  });

  it('answers null for a part that is not there', () => {
    expect(autoFinTab(body([mount()]), 'nope')).toBeNull();
  });
});
