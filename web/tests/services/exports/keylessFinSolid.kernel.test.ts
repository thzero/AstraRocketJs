// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import { solidFor } from '../../../src/services/exports/rocketPrintExport';
import { syncDerived } from '../../../src/services/design/treeEdit';
import { kernelGeometry, loadEngine } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * A planar fin set with no `rootChord` key flies at the bridge's default root
 * chord, so the printable fin is that fin: every point of the outline the
 * kernel flies (`getComponentGeometry`'s `finPoints`) is a vertex of the
 * solid, on both faces.
 */

const fins: Record<string, Record<string, unknown>> = {
  'a trapezoid with no root chord': { type: 'trapezoidfinset', tipChord: 0.02, sweep: 0.015, height: 0.03 },
  'a trapezoid with no dimensions': { type: 'trapezoidfinset' },
  'an ellipse with no root chord': { type: 'ellipticalfinset', height: 0.025 },
  'a trapezoid with every dimension': {
    type: 'trapezoidfinset',
    rootChord: 0.07,
    tipChord: 0.03,
    sweep: 0.03,
    height: 0.04,
  },
};

const design = (fin: Record<string, unknown>): RocketTree =>
  syncDerived({
    name: 'x',
    components: [
      {
        type: 'stage',
        id: 's',
        children: [
          { type: 'nosecone', id: 'n', length: 0.1, aftRadius: 0.02, thickness: 0.002 },
          {
            type: 'bodytube',
            id: 'b',
            length: 0.3,
            outerRadius: 0.02,
            thickness: 0.001,
            children: [{ id: 'fins', finCount: 3, thickness: 0.003, ...fin }],
          },
        ],
      },
    ],
  } as unknown as RocketTree);

describe('the printable fin of a fin set with no root chord key', () => {
  it.each(Object.keys(fins))('%s is the fin the kernel flies', async (name) => {
    const tree = design(fins[name]!);
    const k = kernelGeometry(await loadEngine(), tree, { fields: true }).get('fins')!;
    const node = tree.components[0]!.children![1]!.children![0] as ComponentNode;
    const geo = solidFor(tree, node);
    expect(geo).not.toBeNull();
    const a = geo!.getAttribute('position');
    const verts = Array.from({ length: a.count }, (_, i) => [a.getX(i), a.getY(i), a.getZ(i)]);
    const half = (k.fields!['thickness'] as number) / 2;
    expect(k.finPoints!.length).toBeGreaterThan(2);
    for (const [x, y] of k.finPoints!) {
      for (const z of [half, -half]) {
        const hit = verts.some(
          ([vx, vy, vz]) => Math.abs(vx! - x!) < 1e-6 && Math.abs(vy! - y!) < 1e-6 && Math.abs(vz! - z) < 1e-6,
        );
        expect(hit, `${name}: (${x}, ${y}, ${z})`).toBe(true);
      }
    }
  });
});
