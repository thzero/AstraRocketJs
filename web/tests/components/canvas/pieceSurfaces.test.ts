import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildPieces, isSurfaced, SURFACE, type Piece } from '../../../src/components/canvas/rocketPieces';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';

/**
 * The 3D pieces carry the three surfaces desktop's realistic view paints
 * separately (`Geometry.Surface`: OUTSIDE, INSIDE, EDGES), each a geometry
 * group drawn with that surface's look.
 */

const design = (children: ComponentNode[], chain: ComponentNode[] = []): RocketTree =>
  ({
    components: [
      {
        id: 'stage',
        type: 'stage',
        children: [
          ...chain,
          { id: 'body', type: 'bodytube', length: 0.3, outerRadius: 0.02, thickness: 0.001, children },
        ],
      },
    ],
  }) as unknown as RocketTree;

const pieceOf = (tree: RocketTree, id: string): Piece => buildPieces(tree).pieces.find((p) => p.id === id)!;

/** The vertices of one surface's group, in the piece's own frame (float32, so compared to a micrometer). */
function surfaceVertices(p: Piece, surface: keyof typeof SURFACE): THREE.Vector3[] {
  const g = p.geometry;
  const pos = g.getAttribute('position');
  const out: THREE.Vector3[] = [];
  for (const grp of g.groups.filter((x) => x.materialIndex === SURFACE[surface])) {
    for (let i = grp.start; i < grp.start + grp.count; i++) {
      const idx = g.index ? g.index.getX(i) : i;
      out.push(new THREE.Vector3().fromBufferAttribute(pos, idx));
    }
  }
  return out;
}

/** Distance from the rocket axis (+X). */
const radial = (v: THREE.Vector3) => Math.hypot(v.y, v.z);

describe('a tube', () => {
  const body = pieceOf(design([]), 'body');

  it('is split into its outer wall, its bore and its two ends', () => {
    expect(isSurfaced(body.geometry)).toBe(true);
    for (const v of surfaceVertices(body, 'outside')) expect(radial(v)).toBeCloseTo(0.02, 6);
    for (const v of surfaceVertices(body, 'inside')) expect(radial(v)).toBeCloseTo(0.019, 6);
    const ends = surfaceVertices(body, 'edges');
    expect(ends.length).toBeGreaterThan(0);
    for (const v of ends) expect([0, 0.3].some((x) => Math.abs(v.x - x) < 1e-6)).toBe(true);
  });

  it('has no bore when filled, and its ends close to the axis', () => {
    const filled = pieceOf(
      {
        components: [
          {
            id: 's',
            type: 'stage',
            children: [{ id: 'body', type: 'bodytube', length: 0.3, outerRadius: 0.02, filled: true }],
          },
        ],
      } as unknown as RocketTree,
      'body',
    );
    expect(surfaceVertices(filled, 'inside')).toHaveLength(0);
    expect(Math.min(...surfaceVertices(filled, 'edges').map(radial))).toBeCloseTo(0, 6);
  });
});

describe('a fin set', () => {
  const fin = pieceOf(
    design([
      {
        id: 'fins',
        type: 'trapezoidfinset',
        finCount: 1,
        rootChord: 0.05,
        tipChord: 0.02,
        height: 0.03,
        thickness: 0.004,
      },
    ]),
    'fins',
  );

  it("paints its -z face with the outside look and its +z face with the inside one, as FinRenderer's left and right sides", () => {
    expect(isSurfaced(fin.geometry)).toBe(true);
    // One fin at no rotation lies in the XY plane, so its faces are at z = ±t/2.
    for (const v of surfaceVertices(fin, 'outside')) expect(v.z).toBeCloseTo(-0.002, 6);
    for (const v of surfaceVertices(fin, 'inside')) expect(v.z).toBeCloseTo(0.002, 6);
    expect(surfaceVertices(fin, 'edges').length).toBeGreaterThan(0);
  });
});

describe('a launch lug', () => {
  it('is a tube with its wall, so its bore takes the inside look', () => {
    const lug = pieceOf(
      design([{ id: 'lug', type: 'launchlug', length: 0.03, outerRadius: 0.005, thickness: 0.001, angleOffset: 0 }]),
      'lug',
    );
    expect(isSurfaced(lug.geometry)).toBe(true);
    expect(surfaceVertices(lug, 'inside').length).toBeGreaterThan(0);
  });
});

describe('a nose cone', () => {
  const nose = (extra: Record<string, unknown>) =>
    pieceOf(
      design(
        [],
        [
          {
            id: 'nose',
            type: 'nosecone',
            shape: 'conical',
            length: 0.1,
            aftRadius: 0.02,
            thickness: 0.002,
            ...extra,
          } as ComponentNode,
        ],
      ),
      'nose',
    );

  it('has its wall moved in for the inside and a ring at its base for the edge', () => {
    const n = nose({});
    // Lathe +Y is the rocket axis here; the piece is turned into place by its rotation.
    const r = (v: THREE.Vector3) => Math.hypot(v.x, v.z);
    const base = surfaceVertices(n, 'edges');
    expect(base.length).toBeGreaterThan(0);
    for (const v of base) expect(v.y).toBeCloseTo(0.1, 6);
    expect(Math.max(...base.map(r))).toBeCloseTo(0.02, 6);
    expect(Math.min(...base.map(r))).toBeCloseTo(0.018, 6);
    const inside = surfaceVertices(n, 'inside');
    expect(Math.max(...inside.map(r))).toBeCloseTo(0.018, 6);
  });

  it('has no inside when filled', () => {
    expect(surfaceVertices(nose({ filled: true }), 'inside')).toHaveLength(0);
  });
});

describe("three.js's own primitives", () => {
  it('are not mistaken for surfaced geometry, whatever groups they carry', () => {
    const tree = design([{ id: 'rb', type: 'railbutton', outerDiameter: 0.01, height: 0.008 } as ComponentNode]);
    const button = pieceOf(tree, 'rb');
    expect(button.geometry.groups.length).toBeGreaterThan(0);
    expect(isSurfaced(button.geometry)).toBe(false);
  });
});
