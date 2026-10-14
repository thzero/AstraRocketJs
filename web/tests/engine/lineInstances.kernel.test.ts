import { describe, it, expect, vi } from 'vitest';
import { loadEngine } from '../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../testing/kernelTimeout';
import { lineInstances } from '../../src/tree/placement';
import type { ComponentNode } from '../../src/engine/openRocketEngine';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * Copies of a part repeated along the body are drawn at the spacing the kernel
 * flies. With no spacing stated that is the constructor's: a lug's length x 2
 * and a rail button's diameter x 6, set before the node's own sizes, and 0 for
 * a ring part. Drawn at 0, two lugs the kernel flies 60 mm apart sit on top of
 * each other in every view.
 */
describe('copies of a part with no spacing of its own', () => {
  const parts: ComponentNode[] = [
    { id: 'p', type: 'launchlug', length: 0.04, outerRadius: 0.004, instanceCount: 2 } as ComponentNode,
    { id: 'p', type: 'railbutton', outerDiameter: 0.012, instanceCount: 2 } as ComponentNode,
    { id: 'p', type: 'centeringring', length: 0.003, instanceCount: 2 } as ComponentNode,
  ];

  it.each(parts)('$type copies are drawn the kernel spacing apart', async (part) => {
    const engine = await loadEngine();
    engine.reset();
    const h = engine.buildRocket(
      JSON.stringify({
        components: [
          { id: 'n', type: 'nosecone', length: 0.1, aftRadius: 0.02, thickness: 0.001, shape: 'ogive' },
          { id: 't', type: 'bodytube', length: 0.4, outerRadius: 0.02, thickness: 0.001, children: [part] },
        ],
      }),
    );
    const fields = JSON.parse(engine.getComponentFields(h, 'p')) as { instanceSeparation: number };
    const [first, second] = lineInstances(part).map((n) => n.position?.offset ?? 0);
    expect(second! - first!).toBeCloseTo(fields.instanceSeparation, 12);
  });
});
