import { describe, it, expect, vi } from 'vitest';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import { stageParts } from '../../../src/services/report/reportModel';
import { loadEngine } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * The parts table names the material the kernel holds for each part.
 *
 * A parachute's and a streamer's `getMaterial()` is the canopy's surface
 * material (`RecoveryDevice`), and a shock cord's is its line material
 * (`ShockCord`), the materials desktop's dialogs show for them. The bridge reads
 * it back as `materialName` and `density`. Materials other than the kernel's
 * defaults, so a fallback cannot pass by coincidence.
 */
const SOFT: ComponentNode[] = [
  {
    type: 'parachute',
    id: 'chute',
    name: 'Chute',
    diameter: 0.3,
    surfaceMaterialName: 'Silk',
    surfaceDensity: 0.021,
    lineMaterialName: 'Kevlar thread',
    lineDensity: 0.0009,
  },
  { type: 'streamer', id: 'streamer', name: 'Streamer', surfaceMaterialName: 'Mylar', surfaceDensity: 0.021 },
  { type: 'shockcord', id: 'cord', name: 'Cord', lineMaterialName: 'Tubular nylon', lineDensity: 0.013 },
] as unknown as ComponentNode[];

const tree = {
  name: 'T',
  components: [
    {
      type: 'stage',
      id: 's',
      name: 'S',
      children: [{ type: 'bodytube', id: 'b', length: 0.3, outerRadius: 0.025, thickness: 0.001, children: SOFT }],
    },
  ],
} as unknown as RocketTree;

describe('the parts table material for soft goods', () => {
  it('is the material the kernel holds for each part', async () => {
    const engine = await loadEngine();
    engine.reset();
    const handle = engine.buildRocket(JSON.stringify(tree));
    const rows = stageParts(tree.components[0]!, { componentInfo: () => ({ mass: 0 }) });
    for (const id of ['chute', 'streamer', 'cord']) {
      const kernel = JSON.parse(engine.getComponentFields(handle, id)) as { materialName: string; density: number };
      const node = SOFT.find((n) => n.id === id)!;
      const row = rows.find((r) => r.name === node.name)!;
      expect({ id, material: row.material, density: row.density }).toEqual({
        id,
        material: kernel.materialName,
        density: expect.closeTo(kernel.density, 9) as number,
      });
    }
  });
});
