// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildPieces, piecesBounds } from '../../../src/components/canvas/rocketPieces';
import { buildSchematicShapes } from '../../../src/components/canvas/schematicShapes';
import { buildAftScene } from '../../../src/components/canvas/AftView';
import { axialChain } from '../../../src/tree/position';
import { syncDerived } from '../../../src/services/design/treeEdit';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import { kernelGeometry, loadEngine, type KernelGeometry } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';

/**
 * Internal parts nested in an inner tube, a coupler or a mass component, as the
 * kernel places them: a child sits once per instance of its parent
 * (`RocketComponent.getComponentLocations`), so an engine block in a clustered
 * mount is in every tube of the cluster. Every expected station, radius and
 * cluster place below is read from the kernel through the bridge
 * (`getComponentInfo` for the station, `getComponentGeometry` for the radius,
 * the length and `InnerTube.getInstanceOffsets`). The designs are synced as
 * the app holds every design, so automatic radii are filled in.
 */

const tree: RocketTree = syncDerived({
  name: 'nested',
  components: [
    {
      type: 'stage',
      id: 's',
      children: [
        { type: 'nosecone', id: 'n', length: 0.12, aftRadius: 0.03, thickness: 0.002 },
        {
          type: 'bodytube',
          id: 'b',
          length: 0.5,
          outerRadius: 0.03,
          thickness: 0.001,
          children: [
            {
              type: 'innertube',
              id: 'mm',
              length: 0.1,
              outerRadius: 0.0095,
              thickness: 0.0005,
              motorMount: true,
              cluster: 'double',
              clusterRotation: 0.5,
              position: { method: 'bottom', offset: 0 },
              children: [
                {
                  type: 'engineblock',
                  id: 'eb',
                  length: 0.006,
                  thickness: 0.002,
                  position: { method: 'top', offset: 0.02 },
                },
              ],
            },
            {
              type: 'tubecoupler',
              id: 'cp',
              length: 0.08,
              thickness: 0.001,
              position: { method: 'top', offset: 0.05 },
              children: [{ type: 'bulkhead', id: 'bh', length: 0.006, position: { method: 'middle', offset: 0 } }],
            },
            {
              type: 'masscomponent',
              id: 'mc',
              length: 0.04,
              radius: 0.015,
              mass: 0.05,
              position: { method: 'top', offset: 0.2 },
              children: [
                {
                  type: 'bulkhead',
                  id: 'mbh',
                  length: 0.004,
                  outerRadius: 0.01,
                  position: { method: 'top', offset: 0.01 },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
} as unknown as RocketTree);

let kernel: Map<string, KernelGeometry> | undefined;
const geo = async (id: string): Promise<KernelGeometry> => {
  kernel ??= kernelGeometry(await loadEngine(), tree);
  return kernel.get(id)!;
};

/** The cluster places of the mount, [y, z], as the kernel puts them. */
const clusterOf = async (): Promise<[number, number][]> => {
  const points = (await geo('mm')).clusterPoints!;
  // Two places off the axis, both out of the y = 0 and z = 0 planes, so a part
  // drawn on the centerline or in only one view's plane cannot pass.
  expect(points).toHaveLength(2);
  for (const [y, z] of points) {
    expect(Math.abs(y)).toBeGreaterThan(1e-3);
    expect(Math.abs(z)).toBeGreaterThan(1e-3);
  }
  return points;
};

describe('the 3D view builds parts nested in internal parts', () => {
  it(
    'puts an engine block in every tube of a clustered mount',
    async () => {
      const eb = await geo('eb');
      const points = await clusterOf();
      const pieces = buildPieces(tree).pieces.filter((p) => p.id === 'eb');
      expect(pieces).toHaveLength(points.length);
      const centers = pieces.map((p) => {
        const box = piecesBounds([p]);
        expect(box.min.x).toBeCloseTo(eb.positionX!, 6);
        expect(box.max.x).toBeCloseTo(eb.positionX! + eb.length, 6);
        expect((box.max.y - box.min.y) / 2).toBeCloseTo(eb.outerRadius!, 6);
        return [(box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2] as const;
      });
      for (const [y, z] of points) {
        expect(centers.some(([cy, cz]) => Math.abs(cy - y) < 1e-6 && Math.abs(cz - z) < 1e-6)).toBe(true);
      }
    },
    KERNEL_TEST_TIMEOUT_MS,
  );

  it(
    'puts a bulkhead inside a coupler and inside a mass component',
    async () => {
      for (const id of ['bh', 'mbh']) {
        const g = await geo(id);
        const pieces = buildPieces(tree).pieces.filter((p) => p.id === id);
        expect(pieces, id).toHaveLength(1);
        const box = piecesBounds(pieces);
        expect(box.min.x, id).toBeCloseTo(g.positionX!, 6);
        expect(box.max.x, id).toBeCloseTo(g.positionX! + g.length, 6);
        expect(box.max.y, id).toBeCloseTo(g.outerRadius!, 6);
        expect(box.min.y, id).toBeCloseTo(-g.outerRadius!, 6);
      }
    },
    KERNEL_TEST_TIMEOUT_MS,
  );
});

describe("the side view draws an inner tube's children in each tube of the cluster", () => {
  it(
    'spans every cluster place, not the centerline',
    async () => {
      const eb = await geo('eb');
      const points = await clusterOf();
      const scale = 1000;
      const cy = 300;
      const { extents } = buildSchematicShapes({
        chain: axialChain(tree),
        ctx: { scale, cy, x0: 0 },
        scale,
        w: 1000,
        h: 600,
        roll: 0,
        uid: 't',
        setHoverId: () => {},
      });
      const box = extents.get('eb')!.box;
      const ys = points.map(([y]) => y);
      expect(box.x0).toBeCloseTo(eb.positionX! * scale, 6);
      expect(box.x1).toBeCloseTo((eb.positionX! + eb.length) * scale, 6);
      expect(box.y0).toBeCloseTo(cy - (Math.max(...ys) + eb.outerRadius!) * scale, 6);
      expect(box.y1).toBeCloseTo(cy - (Math.min(...ys) - eb.outerRadius!) * scale, 6);
    },
    KERNEL_TEST_TIMEOUT_MS,
  );
});

describe('the aft view draws parts nested in internal parts', () => {
  const t = ((k: string) => k) as never;
  const circlesOf = (components: ComponentNode[], id: string) =>
    buildAftScene(components, undefined, t)
      .inner.filter((s) => s.key.startsWith(`${id}:0`))
      .flatMap((s) => (s.kind === 'circle' ? [s] : []));

  it(
    'puts an engine block in every tube of a clustered mount',
    async () => {
      const eb = await geo('eb');
      const points = await clusterOf();
      const circles = circlesOf(tree.components, 'eb');
      expect(circles).toHaveLength(points.length);
      expect(new Set(circles.map((c) => c.key)).size).toBe(circles.length);
      for (const c of circles) expect(c.r).toBeCloseTo(eb.outerRadius!, 9);
      // The aft view turns the kernel's frame a quarter turn so 0 degrees is
      // up, the reference its fins and clusters share: (y, z) is drawn at (-z, y).
      for (const [y, z] of points) {
        expect(circles.some((c) => Math.abs(c.y + z) < 1e-9 && Math.abs(c.z - y) < 1e-9)).toBe(true);
      }
    },
    KERNEL_TEST_TIMEOUT_MS,
  );

  it(
    'draws a bulkhead inside a coupler and inside a mass component',
    async () => {
      for (const id of ['bh', 'mbh']) {
        const circles = circlesOf(tree.components, id);
        expect(circles, id).toHaveLength(1);
        expect(circles[0]!.r, id).toBeCloseTo((await geo(id)).outerRadius!, 9);
      }
    },
    KERNEL_TEST_TIMEOUT_MS,
  );

  it(
    'draws a body tube with no radius on record at the radius it flies at',
    async () => {
      const bare = syncDerived({
        name: 'bare',
        components: [
          {
            type: 'stage',
            id: 's',
            children: [
              { type: 'nosecone', id: 'n', length: 0.1, aftRadius: 0.02, thickness: 0.002 },
              { type: 'bodytube', id: 'tube', length: 0.3, thickness: 0.0005 },
            ],
          },
        ],
      } as unknown as RocketTree);
      const flown = kernelGeometry(await loadEngine(), bare).get('tube')!.outerRadius!;
      const hull = buildAftScene(bare.components, undefined, t).hulls.find((h) => h.key === 'tube:0');
      expect(hull?.kind === 'circle' ? hull.r : undefined).toBeCloseTo(flown, 12);
    },
    KERNEL_TEST_TIMEOUT_MS,
  );
});

describe('the aft view keys every copy of a repeated part apart', () => {
  const t = ((k: string) => k) as never;
  // A two-instance pod set whose pod carries a loaded motor mount: the pod's
  // tube, the mount and the motor are each drawn once per instance.
  const podded: ComponentNode[] = [
    { id: 'nose', type: 'nosecone', length: 0.1, aftRadius: 0.02 } as ComponentNode,
    {
      id: 'core',
      type: 'bodytube',
      length: 0.3,
      outerRadius: 0.02,
      children: [
        {
          id: 'pods',
          type: 'podset',
          instanceCount: 2,
          children: [
            {
              id: 'pod-tube',
              type: 'bodytube',
              length: 0.2,
              outerRadius: 0.01,
              children: [{ id: 'mm', type: 'innertube', length: 0.07, outerRadius: 0.009, motorMount: true }],
            },
          ],
        } as unknown as ComponentNode,
      ],
    } as ComponentNode,
  ];

  it('gives each pod instance, and the motor in each, a key of its own', () => {
    const scene = buildAftScene(podded, { mm: { diameter: 0.018, length: 0.07 } } as never, t);
    const keys = [...scene.hulls, ...scene.inner, ...scene.outer].map((s) => s.key);
    // React reconciles each layer by key; a repeated key drops or reuses a shape.
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
    expect(keys.filter((k) => k.startsWith('pod-tube:'))).toHaveLength(2);
    expect(keys.filter((k) => k.startsWith('mm:motor:'))).toHaveLength(2);
  });
});
