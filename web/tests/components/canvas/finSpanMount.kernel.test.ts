// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import { buildAftScene } from '../../../src/components/canvas/AftView';
import { syncDerived } from '../../../src/services/design/treeEdit';
import type { RocketTree } from '../../../src/engine/openRocketEngine';
import { kernelGeometry, loadEngine, type KernelGeometry } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * Seen from behind, a fin reaches from the body out by its span, the one the
 * kernel reports. For a freeform fin that is `FreeformFinSet.getSpan`
 * (FreeformFinSet.java:428-436): the highest point of the outline as the
 * kernel stores it, after `clampLastPoint` has moved the trailing point onto
 * the parent, less that point's depth below the front. On a tapered parent it
 * is not the stored outline's height. Each span below is read from the kernel's
 * outline (`getComponentGeometry`), or its `height` field for a trapezoid.
 */

const t = ((k: string) => k) as unknown as TFunction;

const FREEFORM = {
  type: 'freeformfinset',
  id: 'fins',
  finCount: 3,
  thickness: 0.003,
  points: [
    [0, 0],
    [0.02, 0.03],
    [0.04, 0.025],
    [0.05, 0],
  ],
  position: { method: 'top', offset: 0.005 },
};

const NOSE = { type: 'nosecone', id: 'n', shape: 'ogive', length: 0.12, aftRadius: 0.025, thickness: 0.002 };
const TUBE = { type: 'bodytube', id: 'b', length: 0.3, outerRadius: 0.025, thickness: 0.001 };

const designs: Record<string, unknown[]> = {
  'a narrowing conical transition': [
    NOSE,
    TUBE,
    {
      type: 'transition',
      id: 'p',
      shape: 'conical',
      length: 0.08,
      foreRadius: 0.025,
      aftRadius: 0.012,
      children: [FREEFORM],
    },
  ],
  'a widening ogive transition': [
    NOSE,
    { ...TUBE, outerRadius: 0.015 },
    {
      type: 'transition',
      id: 'p',
      shape: 'ogive',
      length: 0.08,
      foreRadius: 0.015,
      aftRadius: 0.03,
      children: [FREEFORM],
    },
    { ...TUBE, id: 'tail', outerRadius: 0.03 },
  ],
  'an ogive nose cone': [
    { ...NOSE, id: 'p', children: [{ ...FREEFORM, position: { method: 'top', offset: 0.05 } }] },
    TUBE,
  ],
  'a flipped conical nose cone': [
    NOSE,
    TUBE,
    { ...NOSE, id: 'p', shape: 'conical', flipped: true, length: 0.1, children: [FREEFORM] },
  ],
  'a body tube': [NOSE, { ...TUBE, id: 'p', children: [FREEFORM] }],
  'a body tube, trapezoidal': [
    NOSE,
    {
      ...TUBE,
      id: 'p',
      children: [
        {
          type: 'trapezoidfinset',
          id: 'fins',
          finCount: 3,
          rootChord: 0.06,
          tipChord: 0.03,
          sweep: 0.02,
          height: 0.045,
          thickness: 0.003,
        },
      ],
    },
  ],
};

const build = (chain: unknown[]): RocketTree =>
  syncDerived({ name: 'x', components: [{ type: 'stage', id: 's', children: chain }] } as unknown as RocketTree);

/** The span the kernel reports for the set. */
function kernelSpan(k: KernelGeometry, type: string): number {
  if (type !== 'freeformfinset') return k.fields!['height'] as number;
  const pts = k.finPoints!.map(([, y]) => y!);
  return Math.max(0, ...pts) - Math.min(pts[pts.length - 1]!, 0);
}

describe('the aft view reaches out by the span the kernel reports', () => {
  it.each(Object.keys(designs))('a fin set on %s', async (name) => {
    const tree = build(designs[name]!);
    const k = kernelGeometry(await loadEngine(), tree, { fields: true }).get('fins')!;
    const type = name.endsWith('trapezoidal') ? 'trapezoidfinset' : 'freeformfinset';
    const span = kernelSpan(k, type);
    const fins = buildAftScene(tree.components, undefined, t).outer.filter((s) => s.key.startsWith('fins:'));
    expect(fins).toHaveLength(3);
    for (const s of fins) {
      expect(s.kind).toBe('fin');
      if (s.kind !== 'fin') continue;
      expect(s.to - s.from).toBeCloseTo(span, 9);
    }
  });
});
