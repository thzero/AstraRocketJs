import { describe, it, expect, vi } from 'vitest';
import { loadEngine } from '../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../testing/kernelTimeout';
import { findNode, updateNode } from '../../src/services/design/treeEdit';
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
const airframe = () => stage([nose(), tube('up', 0.031, 0.0009), transition(), tube('low', 0.02, 0.0006)]);

const CASES: { name: string; tree: RocketTree; id: string; side: '' | 'fore' | 'aft' }[] = [
  { name: "a nose cone's shoulder", tree: stage([nose(), tube('t', 0.031, 0.0008)]), id: 'nose', side: '' },
  { name: "a transition's fore shoulder", tree: airframe(), id: 'trans', side: 'fore' },
  { name: "a transition's aft shoulder", tree: airframe(), id: 'trans', side: 'aft' },
  { name: 'a nose cone with nothing behind it', tree: stage([nose()]), id: 'nose', side: '' },
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
