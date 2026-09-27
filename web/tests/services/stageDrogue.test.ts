import { describe, expect, it } from 'vitest';
import type { ComponentNode, RocketTree } from '../../src/engine/openRocketEngine';
import { recoveryDevices, setStageDrogue } from '../../src/services/treeEdit';

/**
 * Dual deployment as a property of the STAGE.
 *
 * The flag is stored per device, but the stage owns the plan: single deployment
 * is no drogue, dual is exactly one. The invariant being tested is that a stage
 * can never hold two, which our per-device checkbox allowed and which
 * OpenRocket's own UI cannot produce.
 */

const chute = (id: string, extra: Record<string, unknown> = {}): ComponentNode =>
  ({ id, type: 'parachute', name: id, diameter: 0.4, lineCount: 6, ...extra }) as unknown as ComponentNode;

const rocket = (): RocketTree =>
  ({
    name: 'R',
    components: [
      {
        id: 'sustainer',
        type: 'stage',
        name: 'Sustainer',
        children: [
          {
            id: 'tube',
            type: 'bodytube',
            length: 0.4,
            outerRadius: 0.026,
            thickness: 0.001,
            // Nested a level down: the stage owns everything INSIDE it, not
            // just its immediate children.
            children: [chute('main'), chute('drogue'), { id: 'cord', type: 'shockcord', cordLength: 2 }],
          },
        ],
      },
      {
        id: 'booster',
        type: 'stage',
        name: 'Booster',
        children: [
          { id: 'boosterTube', type: 'bodytube', length: 0.3, outerRadius: 0.026, children: [chute('boosterChute')] },
        ],
      },
    ],
  }) as unknown as RocketTree;

const find = (tree: RocketTree, id: string): ComponentNode => {
  const walk = (ns: ComponentNode[]): ComponentNode | undefined => {
    for (const n of ns) {
      if (n.id === id) return n;
      const hit = walk((n.children ?? []) as ComponentNode[]);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(tree.components)!;
};

const drogues = (tree: RocketTree, stage: string) =>
  recoveryDevices(tree, stage)
    .filter((d) => d['drogue'] === true)
    .map((d) => d.id);

describe('the recovery devices a stage offers', () => {
  it('finds them at any depth, and only inside that stage', () => {
    expect(recoveryDevices(rocket(), 'sustainer').map((d) => d.id)).toEqual(['main', 'drogue']);
    expect(recoveryDevices(rocket(), 'booster').map((d) => d.id)).toEqual(['boosterChute']);
  });

  it('is not fooled by a shock cord, which is not a recovery device', () => {
    // It packs and deploys with the chute but it is a MassObject upstream, and
    // it cannot be a drogue.
    expect(recoveryDevices(rocket(), 'sustainer').map((d) => d.type)).toEqual(['parachute', 'parachute']);
  });

  it('answers empty for a stage that has none, and for one that does not exist', () => {
    const bare = { name: 'R', components: [{ id: 's', type: 'stage', children: [] }] } as unknown as RocketTree;
    expect(recoveryDevices(bare, 's')).toEqual([]);
    expect(recoveryDevices(rocket(), 'nope')).toEqual([]);
  });
});

describe('choosing the drogue', () => {
  it('marks the one chosen', () => {
    expect(drogues(setStageDrogue(rocket(), 'sustainer', 'drogue'), 'sustainer')).toEqual(['drogue']);
  });

  it('never leaves two in one stage', () => {
    // The state the old per-device checkbox could reach. Whatever it starts as,
    // choosing leaves exactly one.
    const both = setStageDrogue(setStageDrogue(rocket(), 'sustainer', 'drogue'), 'sustainer', 'main');
    expect(drogues(both, 'sustainer')).toEqual(['main']);
  });

  it('clears the whole stage for single deployment', () => {
    const dual = setStageDrogue(rocket(), 'sustainer', 'drogue');
    expect(drogues(setStageDrogue(dual, 'sustainer', null), 'sustainer')).toEqual([]);
  });

  it('writes no flag at all rather than a false one, as the desktop omits it', () => {
    const back = setStageDrogue(setStageDrogue(rocket(), 'sustainer', 'main'), 'sustainer', null);
    expect(find(back, 'main')['drogue']).toBeUndefined();
  });

  it('leaves the other stages alone', () => {
    const t = setStageDrogue(setStageDrogue(rocket(), 'booster', 'boosterChute'), 'sustainer', 'main');
    // Each stage has its own plan: a booster with a drogue and a sustainer with
    // one are two dual-deployment stages, not a conflict.
    expect(drogues(t, 'booster')).toEqual(['boosterChute']);
    expect(drogues(t, 'sustainer')).toEqual(['main']);
  });

  it('returns the same tree when nothing changes, so no undo step is recorded', () => {
    const dual = setStageDrogue(rocket(), 'sustainer', 'main');
    expect(setStageDrogue(dual, 'sustainer', 'main')).toBe(dual);
    const single = rocket();
    expect(setStageDrogue(single, 'sustainer', null)).toBe(single);
  });

  it('is a no-op for a device that is not in that stage', () => {
    // Naming the booster's chute while configuring the sustainer clears the
    // sustainer and marks nothing, rather than reaching into the booster.
    const t = setStageDrogue(setStageDrogue(rocket(), 'sustainer', 'main'), 'sustainer', 'boosterChute');
    expect(drogues(t, 'sustainer')).toEqual([]);
    expect(drogues(t, 'booster')).toEqual([]);
  });
});
