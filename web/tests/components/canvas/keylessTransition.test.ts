import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import { buildSchematicShapes } from '../../../src/components/canvas/schematicShapes';
import { buildPieces } from '../../../src/components/canvas/rocketPieces';
import { buildAftScene } from '../../../src/components/canvas/AftView';

/**
 * A transition end with no radius on record is drawn the way the kernel builds
 * it (ComponentFactory, case "transition", makes it automatic): resolved by
 * `syncAutoRadii`, the one copy of the neighbor rule, which
 * `geometryParity.kernel.test.ts` holds to the kernel for keyless ends.
 */
const fore = { type: 'bodytube', id: 'fore', length: 0.2, outerRadius: 0.03, thickness: 0.001 } as ComponentNode;
const bare = { type: 'transition', id: 'tr', length: 0.05, thickness: 0.001, shape: 'conical' } as ComponentNode;
const aft = { type: 'bodytube', id: 'aft', length: 0.2, outerRadius: 0.02, thickness: 0.001 } as ComponentNode;

describe('a bare transition in the drawings', () => {
  it('is drawn in 2D at its neighbors’ radii', () => {
    const { extents } = buildSchematicShapes({
      chain: [fore, bare, aft],
      ctx: { scale: 1000, cy: 200, x0: 0 },
      scale: 1000,
      w: 800,
      h: 400,
      roll: 0,
      uid: 't',
      setHoverId: () => {},
    });
    const box = extents.get('tr')!.box;
    expect(box.y1 - box.y0).toBeCloseTo(2 * 0.03 * 1000, 6);
  });

  it('is built in 3D at its neighbors’ radii', () => {
    const tree = { name: 'T', components: [{ type: 'stage', id: 's', children: [fore, bare, aft] }] } as RocketTree;
    const { pieces } = buildPieces(tree);
    const box = new THREE.Box3();
    for (const p of pieces.filter((q) => q.id === 'tr')) {
      p.geometry.computeBoundingBox();
      box.union(p.geometry.boundingBox!);
    }
    // The lathe turns about its own axis; z is radial however the piece is oriented.
    expect(box.max.z).toBeCloseTo(0.03, 4);
  });

  it('is drawn in the aft view at its neighbors’ radii', () => {
    const components = [{ type: 'stage', id: 's', children: [fore, bare, aft] }] as ComponentNode[];
    const hull = buildAftScene(components, undefined, ((k: string) => k) as never).hulls.find((h) => h.key === 'tr:0');
    expect(hull?.kind === 'circle' ? hull.r : undefined).toBeCloseTo(0.03, 12);
  });

  it('follows a flipped nose cone ahead of it by its tip, as the kernel does', () => {
    // A tail cone's aft end is its tip, so the bare fore end resolves to 0.
    const tail = { type: 'nosecone', id: 'n', length: 0.1, aftRadius: 0.025, flipped: true } as ComponentNode;
    const tree = {
      name: 'T',
      components: [{ type: 'stage', id: 's', children: [fore, tail, bare, aft] }],
    } as RocketTree;
    const box = new THREE.Box3();
    for (const p of buildPieces(tree).pieces.filter((q) => q.id === 'tr')) {
      p.geometry.computeBoundingBox();
      box.union(p.geometry.boundingBox!);
    }
    // The aft end still follows the 20 mm tube behind it.
    expect(box.max.z).toBeCloseTo(0.02, 4);
  });
});
