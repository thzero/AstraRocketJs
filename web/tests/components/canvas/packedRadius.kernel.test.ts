// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { buildPieces, piecesBounds } from '../../../src/components/canvas/rocketPieces';
import { buildSchematicShapes } from '../../../src/components/canvas/schematicShapes';
import { axialChain } from '../../../src/tree/position';
import { syncDerived } from '../../../src/services/design/treeEdit';
import type { RocketTree } from '../../../src/engine/openRocketEngine';
import { kernelGeometry, loadEngine } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * A packed part with a stated radius is drawn at that radius, however close
 * it comes to the tube wall. The kernel flies the stated value unchanged
 * (`MassObject.setRadius` floors it at 0 and applies no other bound), so the
 * expected radius is the node's own, and the kernel's reading of it is
 * asserted first through `getComponentFields`.
 */

const S = 1000;
const CY = 200;
const TUBE_R = 0.013;
const WEIGHT_R = 0.0125;

const tree: RocketTree = syncDerived({
  name: 'weight',
  components: [
    {
      type: 'stage',
      id: 'stage',
      children: [
        { type: 'nosecone', id: 'nose', shape: 'ogive', length: 0.08, aftRadius: TUBE_R, thickness: 0.002 },
        {
          type: 'bodytube',
          id: 'tube',
          length: 0.3,
          outerRadius: TUBE_R,
          thickness: 0.001,
          children: [
            {
              type: 'masscomponent',
              id: 'weight',
              length: 0.02,
              radius: WEIGHT_R,
              mass: 0.02,
              position: { method: 'top', offset: 0.02 },
            },
          ],
        },
      ],
    },
  ],
} as unknown as RocketTree);

describe('a nose weight nearly as wide as its tube', () => {
  it('flies at its stated radius', async () => {
    const g = kernelGeometry(await loadEngine(), tree, { fields: true }).get('weight')!;
    expect(g.fields!['radius']).toBeCloseTo(WEIGHT_R, 12);
    expect(g.radius).toBeCloseTo(WEIGHT_R, 12);
  });

  it('is drawn at that radius in the side view', () => {
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
    const box = extents.get('weight')!.box;
    expect((box.y1 - box.y0) / 2 / S).toBeCloseTo(WEIGHT_R, 9);
  });

  it('is built at that radius in 3D', () => {
    const pieces = buildPieces(tree).pieces.filter((p) => p.id === 'weight');
    expect(pieces).toHaveLength(1);
    const box = piecesBounds(pieces);
    expect((box.max.y - box.min.y) / 2).toBeCloseTo(WEIGHT_R, 9);
    expect((box.max.z - box.min.z) / 2).toBeCloseTo(WEIGHT_R, 9);
  });
});
