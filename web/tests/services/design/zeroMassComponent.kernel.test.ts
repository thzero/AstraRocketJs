// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { defaultNode } from '../../../src/services/design/treeEdit';
import { badDimensions } from '../../../src/services/design/requiredComponent';
import { designBlocker } from '../../../src/services/flight/runnability';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import { kernelGeometry, loadEngine } from '../../testing/kernelGeometry';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * Desktop's new mass component weighs 0 g (24.12 `MassComponent()` stores
 * `dconst_0` into `mass`), and desktop flies it. The kernel builds one too, so
 * the run check lets a design carrying one through.
 */
const design = (mass: ComponentNode, inMount: boolean): RocketTree =>
  ({
    components: [
      {
        type: 'stage',
        id: 's',
        children: [
          { type: 'nosecone', id: 'n', length: 0.1, aftRadius: 0.0125, thickness: 0.001 },
          {
            type: 'bodytube',
            id: 'b',
            length: 0.3,
            outerRadius: 0.0125,
            thickness: 0.0003,
            children: [
              {
                type: 'innertube',
                id: 'mm',
                length: 0.07,
                outerRadius: 0.0095,
                thickness: 0.0003,
                motorMount: true,
                position: { method: 'bottom', offset: 0 },
                ...(inMount ? { children: [{ ...mass, id: 'm' }] } : {}),
              },
              ...(inMount ? [] : [{ ...mass, id: 'm' }]),
            ],
          },
        ],
      },
    ],
  }) as unknown as RocketTree;

/* eslint-disable @typescript-eslint/no-explicit-any -- the TeaVM bundle is untyped */
const staticInfo = (engine: any, tree: RocketTree): { mass: number; error?: string } => {
  engine.reset();
  return JSON.parse(engine.getStaticInfo(engine.buildRocket(JSON.stringify(tree)))) as {
    mass: number;
    error?: string;
  };
};
/* eslint-enable @typescript-eslint/no-explicit-any */

const without = (tree: RocketTree): RocketTree => {
  const strip = (nodes: ComponentNode[]): ComponentNode[] =>
    nodes
      .filter((n) => n.id !== 'm')
      .map((n) => (Array.isArray(n.children) ? { ...n, children: strip(n.children as ComponentNode[]) } : n));
  return { ...tree, components: strip(tree.components as ComponentNode[]) } as RocketTree;
};

describe('a mass component of 0 g', () => {
  const variants: [string, ComponentNode][] = [
    ['the editor default at 0 g', { ...defaultNode('masscomponent'), mass: 0 }],
    ['a point mass at 0 g', { ...defaultNode('masscomponent'), mass: 0, length: 0 }],
    ['a long one at 0 g', { ...defaultNode('masscomponent'), mass: 0, length: 0.08 }],
  ];

  for (const inMount of [false, true]) {
    for (const [label, node] of variants) {
      it(`${label}, ${inMount ? 'in the motor mount' : 'in the body tube'}, is built by the kernel and not a blocker`, async () => {
        const tree = design(node, inMount);
        const engine = await loadEngine();
        const k = kernelGeometry(engine, tree, { fields: true }).get('m')!;
        // The kernel holds the part at 0 g and adds nothing to the rocket's mass.
        expect(k.fields?.['mass']).toBe(0);
        const info = staticInfo(engine, tree);
        expect(info.error).toBeUndefined();
        expect(info.mass).toBeCloseTo(staticInfo(engine, without(tree)).mass, 12);
        expect(badDimensions(tree)).toEqual([]);
        expect(designBlocker(tree)).toBeNull();
      });
    }
  }
});
