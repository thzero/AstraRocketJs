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
