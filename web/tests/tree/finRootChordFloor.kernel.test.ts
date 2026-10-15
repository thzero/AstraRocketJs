import { describe, expect, it, vi, beforeAll } from 'vitest';
import type { ComponentNode, RocketTree } from '../../src/engine/openRocketEngine';
import { finMountOf, finOutlinePoints, finRootPoints } from '../../src/tree/finPlanform';
import { KERNEL_TEST_TIMEOUT_MS } from '../testing/kernelTimeout';
import { kernelGeometry, loadEngine, type KernelGeometry } from '../testing/kernelGeometry';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * A fin set whose stored root chord is negative draws the fin the kernel flies.
 *
 * `TrapezoidFinSet.setLength` floors the chord at zero (TrapezoidFinSet.java:90),
 * and the bridge refuses a negative `rootChord` before any fin set sees one, so
 * the kernel's geometry is read at the floor while the app reads the stored
 * value; a stored workspace or a hand-built tree is where a negative chord comes
 * from. Every drawing and cut reader goes through `finRootPoints`, so how it
 * samples a negative interval decides whether the view draws or throws.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- the TeaVM bundle is untyped */
let engine: any;
beforeAll(async () => {
  engine = await loadEngine();
});
/* eslint-enable @typescript-eslint/no-explicit-any */

const design = (fin: Record<string, unknown>): RocketTree =>
  ({
    name: 'Floor',
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
            thickness: 0.001,
            children: [{ id: 'fin', ...fin }],
          },
        ],
      },
    ],
  }) as unknown as RocketTree;

const finOf = (tree: RocketTree): ComponentNode => tree.components[0]!.children![0]!.children![0]!;

type Pts = [number, number][];
/** The first way the app's points differ from the kernel's, or null when they agree to 1e-12. */
const pointsMiss = (app: Pts | null, kernel: KernelGeometry['rootPoints']): string | null => {
  if (!app || !kernel) return `app ${JSON.stringify(app)} vs kernel ${JSON.stringify(kernel)}`;
  if (app.length !== kernel.length) return `${app.length} points, kernel has ${kernel.length}`;
  for (let i = 0; i < app.length; i++) {
    const [x, y] = app[i]!;
    const [kx, ky] = kernel[i]!;
    if (kx === null || ky === null || Math.abs(x - kx) > 1e-12 || Math.abs(y - ky) > 1e-12)
      return `point ${i}: app [${x}, ${y}], kernel [${kx}, ${ky}]`;
  }
  return null;
};

const cases: { title: string; fin: Record<string, unknown> }[] = [
  {
    title: 'a canted trapezoid',
    fin: {
      type: 'trapezoidfinset',
      finCount: 3,
      tipChord: 0.02,
      sweep: 0.01,
      height: 0.03,
      thickness: 0.003,
      cant: 0.1,
      position: { method: 'top', offset: 0.1 },
    },
  },
  {
    title: 'an uncanted trapezoid',
    fin: {
      type: 'trapezoidfinset',
      finCount: 3,
      tipChord: 0.02,
      sweep: 0.01,
      height: 0.03,
      thickness: 0.003,
      position: { method: 'top', offset: 0.1 },
    },
  },
  {
    title: 'a canted elliptical fin',
    fin: {
      type: 'ellipticalfinset',
      finCount: 3,
      height: 0.03,
      thickness: 0.003,
      cant: 0.1,
      position: { method: 'top', offset: 0.1 },
    },
  },
];

describe('a negative root chord', () => {
  for (const { title, fin } of cases) {
    it(`draws ${title} with the root and outline the kernel flies at a zero chord`, () => {
      const stored = design({ ...fin, rootChord: -0.01 });
      const flown = kernelGeometry(engine, design({ ...fin, rootChord: 0 })).get('fin')!;
      const mount = finMountOf(stored, 'fin')!;
      expect(pointsMiss(finRootPoints(finOf(stored), mount), flown.rootPoints)).toBeNull();
      expect(pointsMiss(finOutlinePoints(finOf(stored), mount), flown.finPoints)).toBeNull();
    });
  }
});
