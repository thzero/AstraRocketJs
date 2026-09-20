import { describe, it, expect } from 'vitest';
import type { RocketTree } from '../engine/openRocketEngine';
import { KERNEL_BODYTUBE_OUTER_RADIUS, parentRadiusOf } from './finPlanform';

const treeWith = (tube: Record<string, unknown>): RocketTree =>
  ({
    name: 't',
    components: [
      {
        type: 'stage',
        id: 's',
        children: [{ type: 'bodytube', id: 'b', ...tube, children: [{ type: 'trapezoidfinset', id: 'f' }] }],
      },
    ],
  }) as unknown as RocketTree;

describe('parentRadiusOf', () => {
  it('reads the body tube radius the fin is mounted on', () => {
    expect(parentRadiusOf(treeWith({ outerRadius: 0.02 }), 'f')).toBeCloseTo(0.02, 12);
  });
  it('falls back to the kernel body-tube radius, not a chord, when the key is absent', () => {
    // It used to fall back to FIN_DEFAULTS.rootChord (0.05 m), so a radius-less
    // tube clamped the tab at 50 mm where the kernel flies a 12 mm tube.
    expect(parentRadiusOf(treeWith({}), 'f')).toBeCloseTo(KERNEL_BODYTUBE_OUTER_RADIUS, 12);
    expect(KERNEL_BODYTUBE_OUTER_RADIUS).toBe(0.012);
  });
});

describe('finSpan on a hostile outline', () => {
  it('handles a 200k-point freeform outline without a stack overflow', async () => {
    const { finSpan } = await import('./finPlanform');
    // `Math.max(...pts.map())` spread 200k arguments into one call and threw
    // RangeError before the PDF report's own guard was reached.
    const pts: [number, number][] = [];
    for (let i = 0; i < 200_000; i++) pts.push([i * 1e-6, (i % 100) * 1e-4]);
    pts.push([0.2, 0.05]);
    const node = { type: 'freeformfinset', points: pts } as never;
    expect(finSpan(node)).toBeCloseTo(0.05, 12);
  });
});
