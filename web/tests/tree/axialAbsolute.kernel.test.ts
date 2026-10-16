import { describe, expect, it, vi } from 'vitest';
import type { ComponentNode, ComponentPosition, RocketTree } from '../../src/engine/openRocketEngine';
import { axialFrameOf, axialFrames, rebasePosition } from '../../src/tree/axialRebase';
import { parentRadiusOf } from '../../src/tree/finPlanform';
import { axialLength } from '../../src/tree/position';
import { syncDerived } from '../../src/services/design/treeEdit';
import { KERNEL_TEST_TIMEOUT_MS } from '../testing/kernelTimeout';
import { kernelGeometry, loadEngine, walkTree } from '../testing/kernelGeometry';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * A part placed `absolute` is where the kernel flies it.
 *
 * The kernel measures an ABSOLUTE offset from the rocket's origin, the nose
 * tip, whatever the parent: `RocketComponent.setAxialOffset` stores the offset
 * less the parent's first location (`getComponentLocations()[0].getX()`). The
 * stations here are the kernel's own, read back through the bridge
 * (`getComponentInfo` positionX), for parts nested two deep, inside a pod's
 * second tube, and on a transition, where the station also decides the bore a
 * ring fills and the radius a fin tab is clamped to.
 */

const abs = (offset: number): ComponentPosition => ({ method: 'absolute', offset });

function design(noseLength: number): RocketTree {
  const part = (o: object) => o as unknown as ComponentNode;
  return {
    components: [
      part({
        type: 'stage',
        id: 'stage',
        children: [
          { type: 'nosecone', id: 'nose', shape: 'ogive', length: noseLength, aftRadius: 0.02, thickness: 0.002 },
          { type: 'bodytube', id: 'fwd', length: 0.3, outerRadius: 0.02, thickness: 0.001 },
          {
            type: 'transition',
            id: 'tail',
            shape: 'conical',
            length: 0.1,
            foreRadius: 0.02,
            aftRadius: 0.03,
            thickness: 0.001,
            children: [
              {
                type: 'bulkhead',
                id: 'plug',
                length: 0.004,
                outerRadiusAuto: true,
                outerRadius: 0.01,
                position: abs(0.47),
              },
              {
                type: 'freeformfinset',
                id: 'tailFins',
                finCount: 3,
                points: [
                  [0, 0],
                  [0.02, 0.03],
                  [0.05, 0],
                ],
                thickness: 0.003,
                tabHeight: 0.2,
                tabLength: 0.02,
                tabOffsetMethod: 'top',
                tabOffset: 0.01,
                position: abs(0.42),
              },
            ],
          },
          {
            type: 'bodytube',
            id: 'aft',
            length: 0.4,
            outerRadius: 0.03,
            thickness: 0.001,
            children: [
              {
                type: 'innertube',
                id: 'mount',
                length: 0.2,
                outerRadius: 0.01,
                thickness: 0.0005,
                position: { method: 'top', offset: 0.15 },
                children: [{ type: 'engineblock', id: 'block', length: 0.005, thickness: 0.002, position: abs(0.7) }],
              },
              { type: 'centeringring', id: 'ring', length: 0.005, position: abs(0.6) },
              {
                type: 'trapezoidfinset',
                id: 'fins',
                finCount: 3,
                rootChord: 0.08,
                tipChord: 0.04,
                sweep: 0.02,
                height: 0.05,
                thickness: 0.003,
                position: abs(0.8),
              },
              {
                type: 'podset',
                id: 'pod',
                instanceCount: 2,
                radiusMethod: 'relative',
                radiusOffset: 0.01,
                position: abs(0.6),
                children: [
                  { type: 'nosecone', id: 'podNose', shape: 'ogive', length: 0.05, aftRadius: 0.01, thickness: 0.001 },
                  {
                    type: 'bodytube',
                    id: 'podTube',
                    length: 0.15,
                    outerRadius: 0.01,
                    thickness: 0.001,
                    children: [{ type: 'masscomponent', id: 'podMass', length: 0.02, position: abs(0.7) }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ],
  } as unknown as RocketTree;
}

async function stations(tree: RocketTree) {
  const kernel = kernelGeometry(await loadEngine(), tree);
  const frames = axialFrames(tree);
  return walkTree(tree)
    .filter((v) => v.node.type !== 'stage')
    .map((v) => ({ id: v.id, app: frames.get(v.id)?.start, kernel: kernel.get(v.id)?.positionX }));
}

describe('absolute placement against the kernel', () => {
  it('places every absolute part at the kernel station, nested parents and a pod included', async () => {
    const rows = await stations(syncDerived(design(0.1)));
    for (const row of rows) expect(row.app, row.id).toBeCloseTo(row.kernel!, 12);
    // The absolute parts sit at their offsets from the nose tip.
    const at = Object.fromEntries(rows.map((r) => [r.id, r.kernel]));
    expect([at['block'], at['ring'], at['fins'], at['pod'], at['podMass'], at['plug'], at['tailFins']]).toEqual([
      0.7, 0.6, 0.8, 0.6, 0.7, 0.47, 0.42,
    ]);
  });

  // An absolute part stays put when the parts ahead of it grow; a part placed
  // from its parent moves with it.
  it('keeps an absolute part at its station when its parent moves', async () => {
    const rows = await stations(syncDerived(design(0.15)));
    for (const row of rows) expect(row.app, row.id).toBeCloseTo(row.kernel!, 12);
    const at = Object.fromEntries(rows.map((r) => [r.id, r.kernel]));
    expect(at['ring']).toBeCloseTo(0.6, 12);
    expect(at['mount']).toBeCloseTo(0.15 + 0.3 + 0.1 + 0.15, 12);
  });

  it('sizes a ring and clamps a tab on a transition by the absolute station', async () => {
    const tree = syncDerived(design(0.1));
    const kernel = kernelGeometry(await loadEngine(), tree);
    const plug = walkTree(tree).find((v) => v.id === 'plug')!.node;
    expect(plug['outerRadius']).toBeCloseTo(kernel.get('plug')!.outerRadius!, 12);
    expect(parentRadiusOf(tree, 'tailFins')).toBeCloseTo(kernel.get('tailFins')!.maxTabHeight!, 12);
  });

  // The editor's method switch keeps the part where it is, so the design it
  // writes flies the part at the same station as before the switch.
  it('switching a nested part to absolute in the editor keeps the kernel station', async () => {
    const before = syncDerived(design(0.1));
    const engine = await loadEngine();
    const was = kernelGeometry(engine, before).get('mount')!.positionX!;
    const mount = walkTree(before).find((v) => v.id === 'mount')!.node;
    const position = rebasePosition(mount.position!, 'absolute', axialLength(mount), axialFrameOf(before, 'aft')!);
    expect(position).toEqual({ method: 'absolute', offset: was });
    const after = structuredClone(before);
    walkTree(after).find((v) => v.id === 'mount')!.node.position = position;
    expect(kernelGeometry(engine, after).get('mount')!.positionX).toBeCloseTo(was, 12);
    expect(axialFrameOf(after, 'mount')!.start).toBeCloseTo(was, 12);
  });
});
