import { describe, expect, it, vi, beforeAll } from 'vitest';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import { syncDerived } from '../../../src/services/design/treeEdit';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import { kernelGeometry, loadEngine } from '../../testing/kernelGeometry';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * A tube fin set with no wall of its own flies the wall its parent hands it.
 *
 * `BodyTube.addChild` gives a wall-less tube fin set the tube's `getThickness()`,
 * which is the tube's radius when the tube is filled (`SymmetricComponent`),
 * and `TubeFinSet.setThickness` clamps that to the fin tube's own radius. The
 * app stores the wall it resolves, and the panel, the drawings and the file
 * state it, so the stored wall has to be the one the kernel reads back.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- the TeaVM bundle is untyped */
let engine: any;
beforeAll(async () => {
  engine = await loadEngine();
});
/* eslint-enable @typescript-eslint/no-explicit-any */

const design = (tube: Record<string, unknown>, fins: Record<string, unknown>): RocketTree =>
  ({
    name: 'Walls',
    components: [
      {
        id: 'stage',
        type: 'stage',
        children: [
          {
            id: 'body',
            type: 'bodytube',
            length: 0.3,
            outerRadius: 0.025,
            thickness: 0.002,
            ...tube,
            children: [{ id: 'fin', type: 'tubefinset', length: 0.05, ...fins }],
          },
        ],
      },
    ],
  }) as unknown as RocketTree;

const finOf = (tree: RocketTree): ComponentNode => tree.components[0]!.children![0]!.children![0]!;

const cases: { title: string; tube: Record<string, unknown>; fins: Record<string, unknown> }[] = [
  { title: 'a filled tube, where the fin tube is wider than the body', tube: { filled: true }, fins: { finCount: 3 } },
  {
    title: 'a filled tube, where the fin tube is narrower than the body',
    tube: { filled: true },
    fins: { finCount: 8 },
  },
  {
    title: 'a filled tube and a fin tube of a stated radius',
    tube: { filled: true },
    fins: { finCount: 8, outerRadius: 0.01 },
  },
  { title: 'a hollow tube', tube: {}, fins: { finCount: 8 } },
];

describe('a tube fin set with no wall key', () => {
  for (const { title, tube, fins } of cases) {
    it(`stores the wall the kernel flies on ${title}`, () => {
      const tree = design(tube, fins);
      const flown = kernelGeometry(engine, tree, { fields: true }).get('fin')!.fields!;
      const stored = finOf(syncDerived(tree))['thickness'];
      expect(typeof flown['thickness']).toBe('number');
      expect(stored).toBeCloseTo(flown['thickness'] as number, 12);
    });
  }
});
