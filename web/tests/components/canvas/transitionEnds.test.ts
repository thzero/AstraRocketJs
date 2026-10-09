import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import { transitionEnds } from '../../../src/components/canvas/transitionEnds';
import { buildSchematicShapes } from '../../../src/components/canvas/schematicShapes';
import { buildPieces } from '../../../src/components/canvas/rocketPieces';
import { KERNEL_AUTO_RADIUS } from '../../../src/services/design/autoRadius';

/**
 * A transition end with no radius on record is drawn the way the kernel builds
 * it: matched to the part beside it, or SymmetricComponent.DEFAULT_RADIUS with
 * no part there (ComponentFactory, case "transition"). Never a radius of the
 * drawing's own invention.
 */
const fore = { type: 'bodytube', id: 'fore', length: 0.2, outerRadius: 0.03, thickness: 0.001 } as ComponentNode;
const bare = { type: 'transition', id: 'tr', length: 0.05, thickness: 0.001, shape: 'conical' } as ComponentNode;
const aft = { type: 'bodytube', id: 'aft', length: 0.2, outerRadius: 0.02, thickness: 0.001 } as ComponentNode;

describe('transitionEnds', () => {
  it('matches each bare end to the part beside it', () => {
    expect(transitionEnds(bare, fore, aft)).toEqual({ fore: 0.03, aft: 0.02 });
  });

  it('takes the kernel default radius where there is no part', () => {
    expect(transitionEnds(bare, undefined, undefined)).toEqual({ fore: KERNEL_AUTO_RADIUS, aft: KERNEL_AUTO_RADIUS });
  });

  it('keeps a radius on record', () => {
    expect(transitionEnds({ ...bare, foreRadius: 0.01, aftRadius: 0.015 }, fore, aft)).toEqual({
      fore: 0.01,
      aft: 0.015,
    });
  });

  it('reads a nose cone base ahead of it', () => {
    const nose = { type: 'nosecone', id: 'n', length: 0.1, aftRadius: 0.025 } as ComponentNode;
    expect(transitionEnds(bare, nose, aft).fore).toBe(0.025);
  });
});

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
});
