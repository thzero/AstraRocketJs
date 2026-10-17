import { describe, expect, it, vi } from 'vitest';
import type { RocketTree } from '../../src/engine/openRocketEngine';
import { syncDerived } from '../../src/services/design/treeEdit';
import { finMountOf, finOutlinePoints, finRootPoints } from '../../src/tree/finPlanform';
import { kernelGeometry, loadEngine } from '../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * A stored cant past the panel's limit, as a file can carry it, is drawn as
 * the kernel flies it: `FinSet.setCantAngle` clamps it to 15 degrees
 * (FinSet.java:244), so the root and outline points match the kernel's
 * `getComponentGeometry` for that fin set, not for the stored angle.
 */
const design = (cantDeg: number): RocketTree =>
  syncDerived({
    name: 'x',
    components: [
      {
        type: 'stage',
        id: 's',
        children: [
          { type: 'nosecone', id: 'n', length: 0.1, aftRadius: 0.04, thickness: 0.002 },
          {
            type: 'bodytube',
            id: 'b',
            length: 0.4,
            outerRadius: 0.04,
            thickness: 0.001,
            children: [
              {
                type: 'trapezoidfinset',
                id: 'fins',
                finCount: 3,
                rootChord: 0.1,
                tipChord: 0.04,
                height: 0.05,
                sweep: 0.03,
                thickness: 0.003,
                cant: (cantDeg * Math.PI) / 180,
                position: { method: 'bottom', offset: 0 },
              },
            ],
          },
        ],
      },
    ],
  } as unknown as RocketTree);

describe('a stored cant past 15 degrees', () => {
  it.each([25, -25])('draws a %s degree cant at the kernel limit', async (deg) => {
    const tree = design(deg);
    const engine = await loadEngine();
    const k = kernelGeometry(engine, tree).get('fins')!;
    const fin = tree.components[0]!.children![1]!.children![0]!;
    const mount = finMountOf(tree, 'fins')!;
    for (const [app, kernel] of [
      [finRootPoints(fin, mount), k.rootPoints],
      [finOutlinePoints(fin, mount), k.finPoints],
    ] as const) {
      expect(kernel!.length).toBeGreaterThan(2);
      expect(app!.length).toBe(kernel!.length);
      app!.forEach(([x, y], i) => {
        expect(x).toBeCloseTo(kernel![i]![0]!, 9);
        expect(y).toBeCloseTo(kernel![i]![1]!, 9);
      });
    }
  });
});
