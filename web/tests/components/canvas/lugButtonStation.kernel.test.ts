// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import { buildPieces, piecesBounds } from '../../../src/components/canvas/rocketPieces';
import { buildSchematicShapes } from '../../../src/components/canvas/schematicShapes';
import { buildAftScene } from '../../../src/components/canvas/AftView';
import { axialChain } from '../../../src/tree/position';
import { syncDerived } from '../../../src/services/design/treeEdit';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import { kernelGeometry, loadEngine, type KernelGeometry } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * A rail button and a launch lug stand where the kernel stands them, in every
 * view. The kernel positions a rail button as a part of no axial length
 * (`RailButton` never sets `RocketComponent.length`) and bounds each instance
 * one radius either side of that station (`RailButton.getInstanceBoundingBox`),
 * so the drawn button is centered on the station. A lug's length is real, so
 * its center is the station plus half the length the kernel holds. Every
 * expected station and length is read from the kernel through the bridge
 * (`getComponentFields`), for each axial method the editor offers. The aft
 * view carries no axial station: the kernel mounts a button or lug on a body
 * tube only (`BodyTube.isCompatible`), whose radius is the same at every
 * station, so there the button is checked against the tube's kernel radius.
 */

const S = 1000;
const CY = 200;
const t = ((k: string) => k) as unknown as TFunction;

const BUTTON_DIA = 0.0097;
const LUG_LEN = 0.035;

const METHODS: [string, number][] = [
  ['top', 0.1],
  ['bottom', -0.02],
  ['middle', 0.015],
  // From the nose tip, inside the tube (which runs 0.1 to 0.4).
  ['absolute', 0.25],
];

const button = (id: string, method: string, offset: number): ComponentNode =>
  ({
    type: 'railbutton',
    id,
    outerDiameter: BUTTON_DIA,
    angleOffset: 0,
    position: { method, offset },
  }) as ComponentNode;

const lug = (id: string, method: string, offset: number): ComponentNode =>
  ({
    type: 'launchlug',
    id,
    length: LUG_LEN,
    outerRadius: 0.003,
    thickness: 0.0005,
    angleOffset: 0,
    position: { method, offset },
  }) as ComponentNode;

const tree: RocketTree = syncDerived({
  name: 'stations',
  components: [
    {
      type: 'stage',
      id: 'stage',
      children: [
        { type: 'nosecone', id: 'nose', shape: 'ogive', length: 0.1, aftRadius: 0.025, thickness: 0.002 },
        {
          type: 'bodytube',
          id: 'tube',
          length: 0.3,
          outerRadius: 0.025,
          thickness: 0.001,
          children: [
            ...METHODS.map(([m, o]) => button(`rb-${m}`, m, o)),
            ...METHODS.map(([m, o]) => lug(`lug-${m}`, m, o)),
          ],
        },
      ],
    },
  ],
} as unknown as RocketTree);

let kernel: Map<string, KernelGeometry> | undefined;
const geo = async (id: string): Promise<KernelGeometry> => {
  kernel ??= kernelGeometry(await loadEngine(), tree, { fields: true });
  return kernel.get(id)!;
};

/** The part's axial center as the kernel holds it: its front plus half its length. */
const kernelCenter = async (id: string): Promise<number> => {
  const g = await geo(id);
  const x = g.fields!['positionX'] as number;
  const len = g.fields!['length'] as number;
  expect(x, id).toBeCloseTo(g.positionX!, 12);
  return x + len / 2;
};

const sideCenter = (id: string): number => {
  const { extents } = buildSchematicShapes({
    chain: axialChain(tree),
    ctx: { scale: S, cy: CY, x0: 0 },
    scale: S,
    w: 1000,
    h: 400,
    roll: 0,
    uid: 't',
    setHoverId: () => {},
  });
  const box = extents.get(id)!.box;
  return (box.x0 + box.x1) / 2 / S;
};

const solidCenter = (id: string): number => {
  const pieces = buildPieces(tree).pieces.filter((p) => p.id === id);
  expect(pieces, id).toHaveLength(1);
  const box = piecesBounds(pieces);
  return (box.min.x + box.max.x) / 2;
};

describe('a rail button stands centered on the station the kernel positions it at', () => {
  it('has no axial length in the kernel', async () => {
    for (const [m] of METHODS) expect((await geo(`rb-${m}`)).fields!['length'], m).toBe(0);
  });

  for (const [m] of METHODS) {
    it(`at ${m}, in the side view`, async () => {
      expect(sideCenter(`rb-${m}`)).toBeCloseTo(await kernelCenter(`rb-${m}`), 9);
    });

    it(`at ${m}, in 3D`, async () => {
      expect(solidCenter(`rb-${m}`)).toBeCloseTo(await kernelCenter(`rb-${m}`), 9);
    });
  }

  it('stands on the kernel radius of its tube in the aft view', async () => {
    const tube = await geo('tube');
    for (const [m] of METHODS) {
      const shape = buildAftScene(tree.components, undefined, t).outer.find((s) => s.key === `rb-${m}:0`);
      expect(shape?.kind, m).toBe('fin');
      if (shape?.kind !== 'fin') continue;
      expect(shape.from, m).toBeCloseTo(tube.outerRadius!, 12);
      expect(shape.thick, m).toBeCloseTo(BUTTON_DIA, 12);
    }
  });
});

describe('a launch lug stands centered half its kernel length aft of its station', () => {
  for (const [m] of METHODS) {
    it(`at ${m}, in the side view`, async () => {
      expect(sideCenter(`lug-${m}`)).toBeCloseTo(await kernelCenter(`lug-${m}`), 9);
    });

    it(`at ${m}, in 3D`, async () => {
      expect(solidCenter(`lug-${m}`)).toBeCloseTo(await kernelCenter(`lug-${m}`), 9);
    });
  }
});
