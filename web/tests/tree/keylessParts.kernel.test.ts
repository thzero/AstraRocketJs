import { describe, expect, it, vi } from 'vitest';
import type { ComponentNode, ComponentType, RocketTree } from '../../src/engine/openRocketEngine';
import { defaultNode, findNode, syncDerived } from '../../src/services/design/treeEdit';
import { stageParts } from '../../src/services/report/reportModel';
import { axialFrames } from '../../src/tree/axialRebase';
import { anyOuterRadius, chainOuterRadius } from '../../src/tree/nodeProps';
import { KERNEL_TEST_TIMEOUT_MS } from '../testing/kernelTimeout';
import { kernelGeometry, loadEngine } from '../testing/kernelGeometry';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * Parts whose node leaves a key out, and shoulders the kernel holds to a
 * cone's base, read the way the kernel builds them. Every expected value is
 * read back from the kernel through the bridge.
 */

const part = (o: object) => o as unknown as ComponentNode;
const stage = (children: object[]): RocketTree =>
  ({ components: [part({ type: 'stage', id: 'stage', children })] }) as unknown as RocketTree;
const NOSE = { type: 'nosecone', id: 'nose', shape: 'ogive', length: 0.1, aftRadius: 0.03, thickness: 0.002 };

describe('a part with no position key', () => {
  // Each type the kernel builds with its constructor's axial method when the
  // bridge is given no position: bottom, middle or top.
  const TYPES: ComponentType[] = [
    'trapezoidfinset',
    'ellipticalfinset',
    'freeformfinset',
    'tubefinset',
    'innertube',
    'tubecoupler',
    'centeringring',
    'bulkhead',
    'engineblock',
    'launchlug',
    'railbutton',
    'masscomponent',
    'parachute',
    'podset',
  ];

  it('stands where the kernel puts it, in a tube longer than the part', async () => {
    const engine = await loadEngine();
    for (const type of TYPES) {
      const node: Record<string, unknown> = { ...defaultNode(type), id: 'probe' };
      delete node['position'];
      const tree = syncDerived(
        stage([
          NOSE,
          { type: 'bodytube', id: 'tube', length: 0.4, outerRadius: 0.03, thickness: 0.001, children: [node] },
        ]),
      );
      const kernel = kernelGeometry(engine, tree).get('probe')!.positionX!;
      expect(axialFrames(tree).get('probe')?.start, type).toBeCloseTo(kernel, 12);
    }
  });
});

describe('a body tube with no radius key', () => {
  it('reads as the radius the kernel builds it at', async () => {
    const tree = stage([NOSE, { type: 'bodytube', id: 'tube', length: 0.3, thickness: 0.001 }]);
    const kernel = kernelGeometry(await loadEngine(), tree).get('tube')!.outerRadius!;
    expect(chainOuterRadius(findNode(tree, 'tube')!)).toBeCloseTo(kernel, 12);
  });
});

describe('a nose cone with no radius key', () => {
  it('reads as the base radius the kernel builds it at, by every radius reader', async () => {
    const tree = stage([
      { type: 'nosecone', id: 'nose', shape: 'ogive', length: 0.1, thickness: 0.002 },
      { type: 'bodytube', id: 'tube', length: 0.3, outerRadius: 0.012, thickness: 0.001 },
    ]);
    const kernel = kernelGeometry(await loadEngine(), tree, { fields: true }).get('nose')!;
    const nose = findNode(tree, 'nose')!;
    expect(kernel.aftRadius).toBeGreaterThan(0);
    expect(kernel.fields!['aftRadius']).toBeCloseTo(kernel.aftRadius!, 12);
    expect(chainOuterRadius(nose)).toBeCloseTo(kernel.aftRadius!, 12);
    expect(anyOuterRadius(nose)).toBeCloseTo(kernel.aftRadius!, 12);
  });
});

describe('a freeform fin span in the parts table', () => {
  it('is FreeformFinSet.getSpan on a boattail, the trailing point moved below the root', async () => {
    const tree = stage([
      NOSE,
      { type: 'bodytube', id: 'tube', length: 0.3, outerRadius: 0.03, thickness: 0.001 },
      {
        type: 'transition',
        id: 'tail',
        shape: 'conical',
        length: 0.1,
        foreRadius: 0.03,
        aftRadius: 0.015,
        thickness: 0.001,
        children: [
          {
            type: 'freeformfinset',
            id: 'fins',
            finCount: 3,
            thickness: 0.003,
            points: [
              [0, 0],
              [0.03, 0.04],
              [0.06, 0],
            ],
            position: { method: 'bottom', offset: 0 },
          },
        ],
      },
    ]);
    const k = kernelGeometry(await loadEngine(), tree).get('fins')!;
    const ys = k.finPoints!.map(([, y]) => y!);
    const last = ys[ys.length - 1]!;
    // The fixture puts the trailing point below the root, so the subtracted term counts.
    expect(last).toBeLessThan(0);
    const kernelSpan = Math.max(0, ...ys) - Math.min(last, 0);
    const row = stageParts(tree.components[0]!, { componentInfo: () => ({ mass: 0 }) }, tree).find(
      (r) => r.type === 'freeformfinset',
    )!;
    expect(row.span).toBeCloseTo(kernelSpan, 12);
  });
});

describe('a nose cone shoulder against its base', () => {
  /** The kernel's shoulder radius for the cone `nose` in this design. */
  const kernelShoulder = async (tree: RocketTree) =>
    kernelGeometry(await loadEngine(), tree, { fields: true }).get('nose')!.fields!['shoulderRadius'] as number;

  it("stops an automatic shoulder at the base, NoseCone.setShoulderRadius's clamp", async () => {
    const shoulder = { shoulderLength: 0.02, shoulderThickness: 0.001 };
    // A 13 mm cone on a 50 mm tube: the bore behind it is 49 mm.
    const tree = syncDerived(
      stage([
        { ...NOSE, aftRadius: 0.013, shoulderAuto: true, ...shoulder },
        { type: 'bodytube', id: 'tube', length: 0.3, outerRadius: 0.05, thickness: 0.001 },
      ]),
    );
    // The clamp, from the kernel: a flipped cone's stated shoulder goes
    // through the clamping setter (`settleFlippedShoulders`).
    const clamp = await kernelShoulder(
      stage([
        { type: 'bodytube', id: 'tube', length: 0.3, outerRadius: 0.05, thickness: 0.001 },
        { ...NOSE, aftRadius: 0.013, flipped: true, shoulderRadius: 0.049, ...shoulder },
      ]),
    );
    expect(clamp).toBeCloseTo(0.013, 12);
    expect(findNode(tree, 'nose')!['shoulderRadius']).toBeCloseTo(clamp, 12);
  });

  it.each([
    ['stated', { shoulderRadius: 0.029 }],
    ['automatic', { shoulderAuto: true }],
  ])('holds a flipped cone to its base with a %s shoulder', async (_, kind) => {
    const tree = syncDerived(
      stage([
        { ...NOSE, id: 'front' },
        { type: 'bodytube', id: 'tube', length: 0.3, outerRadius: 0.03, thickness: 0.001 },
        { ...NOSE, aftRadius: 0.02, flipped: true, shoulderLength: 0.02, shoulderThickness: 0.001, ...kind },
      ]),
    );
    const kernel = await kernelShoulder(tree);
    expect(kernel).toBeCloseTo(0.02, 12);
    expect(findNode(tree, 'nose')!['shoulderRadius']).toBeCloseTo(kernel, 12);
  });
});
