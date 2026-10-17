import { describe, it, expect, vi } from 'vitest';
import { loadEngine } from '../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../testing/kernelTimeout';
import { findNode, updateNode } from '../../src/services/design/treeEdit';
import { syncAutoShoulders } from '../../src/services/design/autoShoulder';
import type { ComponentNode, RocketTree } from '../../src/engine/openRocketEngine';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * A shoulder typed in from length 0 carries what desktop's setter gives it
 * (`Transition.setForeShoulderLength`, `setAftShoulderLength`): the neighbor's
 * wall, a radius of the neighbor's radius less that wall, and a cap.
 *
 * The kernel is the oracle: the bridge's setShoulderLength runs the same setter
 * on the part in a built rocket and reads back what it seeded. (buildRocket
 * cannot show it: it sets the length before the part is attached, when there
 * is no neighbor to take from.)
 */
const stage = (children: ComponentNode[]): RocketTree =>
  ({ components: [{ id: 'st', type: 'stage', children }] }) as unknown as RocketTree;
/** A rocket of several stages, front to back. */
const stages = (...rows: ComponentNode[][]): RocketTree =>
  ({
    components: rows.map((children, i) => ({ id: `st${i}`, type: 'stage', children })),
  }) as unknown as RocketTree;
const nose = (): ComponentNode =>
  ({
    id: 'nose',
    type: 'nosecone',
    length: 0.1,
    aftRadius: 0.031,
    thickness: 0.0015,
    shape: 'ogive',
  }) as ComponentNode;
const tube = (id: string, outerRadius: number, thickness: number): ComponentNode =>
  ({ id, type: 'bodytube', length: 0.3, outerRadius, thickness }) as ComponentNode;
const transition = (): ComponentNode =>
  ({
    id: 'trans',
    type: 'transition',
    length: 0.05,
    foreRadius: 0.031,
    aftRadius: 0.02,
    thickness: 0.0012,
    shape: 'conical',
  }) as ComponentNode;
/** A pod set holding a transition and a tube, at the bottom of the tube it hangs on less 50 mm. */
const pod = (radiusMethod: string, instanceCount: number, radiusOffset: number): ComponentNode =>
  ({
    id: 'pod',
    type: 'podset',
    instanceCount,
    radiusMethod,
    radiusOffset,
    position: { method: 'bottom', offset: 0.05 },
    children: [transition(), tube('pt', 0.02, 0.0005)],
  }) as ComponentNode;
const airframe = () => stage([nose(), tube('up', 0.031, 0.0009), transition(), tube('low', 0.02, 0.0006)]);

const CASES: { name: string; tree: RocketTree; id: string; side: '' | 'fore' | 'aft' }[] = [
  { name: "a nose cone's shoulder", tree: stage([nose(), tube('t', 0.031, 0.0008)]), id: 'nose', side: '' },
  { name: "a transition's fore shoulder", tree: airframe(), id: 'trans', side: 'fore' },
  { name: "a transition's aft shoulder", tree: airframe(), id: 'trans', side: 'aft' },
  { name: 'a nose cone with nothing behind it', tree: stage([nose()]), id: 'nose', side: '' },
  {
    name: "a booster's top transition, plugging into the sustainer's tube",
    tree: stages([nose(), tube('up', 0.031, 0.0009)], [transition(), tube('low', 0.02, 0.0006)]),
    id: 'trans',
    side: 'fore',
  },
  {
    name: "a sustainer's last transition, plugging into the booster's tube past an empty stage",
    tree: stages([nose(), tube('up', 0.031, 0.0009), transition()], [], [tube('low', 0.02, 0.0006)]),
    id: 'trans',
    side: 'aft',
  },
  {
    name: 'a nose cone ahead of a wider tube in the next stage',
    tree: stages([nose()], [tube('t', 0.04, 0.0008)]),
    id: 'nose',
    side: '',
  },
  {
    name: 'a fore shoulder behind a tube wider than its own end',
    tree: stage([nose(), tube('up', 0.031, 0.0009), { ...transition(), foreRadius: 0.02 }, tube('low', 0.02, 0.0006)]),
    id: 'trans',
    side: 'fore',
  },
  {
    name: 'a nose cone ahead of an automatic tube, reading through it to the transition behind',
    tree: stage([
      nose(),
      { ...tube('up', 0.031, 0.0009), outerRadiusAuto: true } as ComponentNode,
      { ...transition(), foreRadius: 0.033 },
      tube('low', 0.02, 0.0006),
    ]),
    id: 'nose',
    side: '',
  },
  {
    name: 'a fore shoulder behind a solid tube',
    tree: stage([
      nose(),
      { ...tube('up', 0.031, 0.0009), filled: true } as ComponentNode,
      transition(),
      tube('low', 0.02, 0.0006),
    ]),
    id: 'trans',
    side: 'fore',
  },
  {
    name: 'the first transition of a coaxial pod set, plugging into the nose cone ahead of the tube it hangs on',
    tree: stage([
      nose(),
      {
        ...tube('up', 0.025, 0.0009),
        children: [pod('coaxial', 1, 0)],
      } as ComponentNode,
    ]),
    id: 'trans',
    side: 'fore',
  },
  {
    name: 'the first transition of a pod set off the axis, with nothing in line ahead',
    tree: stage([nose(), { ...tube('up', 0.031, 0.0009), children: [pod('relative', 2, 0.01)] } as ComponentNode]),
    id: 'trans',
    side: 'fore',
  },
];

const key = (side: string, k: string) => (side ? `${side}Shoulder${k}` : `shoulder${k}`);

describe('a shoulder grown from length 0', () => {
  it.each(CASES)('$name takes the wall, radius and cap the kernel seeds', async ({ tree, id, side }) => {
    const engine = await loadEngine();
    const length = 0.04;

    // The kernel's seed, on the part in place.
    engine.reset();
    const h = engine.buildRocket(JSON.stringify(tree));
    const kernel = JSON.parse(engine.setShoulderLength(h, id, side, length)) as Record<string, unknown>;
    expect(kernel['error']).toBeUndefined();
    expect(kernel[key(side, 'Thickness')]).toBeGreaterThan(0);

    // The app's edit.
    const edited = findNode(updateNode(tree, id, { [key(side, 'Length')]: length }), id)!;
    expect(edited[key(side, 'Radius')]).toBeCloseTo(kernel[key(side, 'Radius')] as number, 9);
    expect(edited[key(side, 'Thickness')]).toBeCloseTo(kernel[key(side, 'Thickness')] as number, 9);
    expect(edited[key(side, 'Capped')]).toBe(kernel[key(side, 'Capped')]);
  });

  it('clears the radius, wall and cap when the length goes back to 0', async () => {
    const tree = stage([nose(), tube('t', 0.031, 0.0008)]);
    const grown = updateNode(tree, 'nose', { shoulderLength: 0.04 });
    const back = findNode(updateNode(grown, 'nose', { shoulderLength: 0 }), 'nose')!;

    const engine = await loadEngine();
    engine.reset();
    const h = engine.buildRocket(JSON.stringify(grown));
    const kernel = JSON.parse(engine.setShoulderLength(h, 'nose', '', 0)) as Record<string, unknown>;
    expect([back['shoulderRadius'], back['shoulderThickness'], back['shoulderCapped']]).toEqual([
      kernel['shoulderRadius'],
      kernel['shoulderThickness'],
      kernel['shoulderCapped'],
    ]);
  });

  it('keeps a radius and wall the edit states itself', () => {
    const tree = stage([nose(), tube('t', 0.031, 0.0008)]);
    const n = findNode(
      updateNode(tree, 'nose', { shoulderLength: 0.04, shoulderRadius: 0.02, shoulderThickness: 0.003 }),
      'nose',
    )!;
    expect([n['shoulderRadius'], n['shoulderThickness']]).toEqual([0.02, 0.003]);
  });
});

/**
 * An automatic shoulder fits the bore of the part it plugs into, found the way
 * the kernel finds it (`getPreviousSymmetricComponent`, which walks into the
 * stage ahead), with the bore read back from the kernel's geometry.
 */
describe('an automatic shoulder', () => {
  it("fits the sustainer's tube from the top of the booster", async () => {
    const tree = stages(
      [nose(), tube('up', 0.031, 0.0009)],
      [
        { ...transition(), foreShoulderAuto: true, foreShoulderLength: 0.03 } as ComponentNode,
        tube('low', 0.02, 0.0006),
      ],
    );
    const engine = await loadEngine();
    engine.reset();
    const h = engine.buildRocket(JSON.stringify(tree));
    const bore = (JSON.parse(engine.getComponentGeometry(h, 'up')) as { innerRadius: number }).innerRadius;
    const fitted = findNode(syncAutoShoulders(tree), 'trans')!;
    expect(fitted['foreShoulderRadius']).toBeCloseTo(bore, 9);
  });
});
