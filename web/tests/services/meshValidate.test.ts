import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ComponentNode } from '../../src/engine/openRocketEngine';
import { describeIssues, isValidSolid, meshTolerances, validateSolid } from '../../src/services/meshValidate';
import { countBoundaryEdges, isSimplePolygon, makeWatertight, solidForNode } from '../../src/services/solidMesh';

/**
 * The mesh validator, and every solid the exporter can produce, checked with it.
 *
 * Three bugs in `solidMesh` all shared the property that the exporter's own
 * check passed anyway, because `countBoundaryEdges` asks only "is every edge
 * used twice". These tests do two jobs: prove the validator actually detects
 * each failure mode (a gate nobody has seen fail is not a gate), and then hold
 * every real component to it.
 */

const node = (props: Record<string, unknown>): ComponentNode => ({ id: 'n1', ...props }) as unknown as ComponentNode;

/** A closed, consistently wound tetrahedron: the smallest valid solid. */
function tetra(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], 3));
  g.setIndex([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]);
  return g;
}

describe('validateSolid detects what countBoundaryEdges cannot', () => {
  it('passes a closed, consistently wound solid', () => {
    expect(validateSolid(tetra())).toEqual([]);
    expect(isValidSolid(tetra())).toBe(true);
  });

  it('catches an empty mesh, which an edge count calls watertight', () => {
    // The scaled-down-design bug: every triangle dropped as degenerate leaves
    // an index with no unused edges at all, so an edge count reports success.
    const g = tetra();
    g.setIndex([]);
    expect(validateSolid(g).map((i) => i.kind)).toContain('empty');
  });

  it('catches a hole', () => {
    const g = tetra();
    g.setIndex([0, 2, 1, 0, 1, 3, 0, 3, 2]); // one face removed
    expect(validateSolid(g).map((i) => i.kind)).toContain('non-manifold-edge');
  });

  it('catches a flipped face that leaves every edge used exactly twice', () => {
    // This is the cap-fan failure in miniature: the edge COUNT is still
    // perfect, but two faces traverse the same edge the same way, so the
    // surface has no consistent inside.
    const g = tetra();
    g.setIndex([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 3, 2]); // last face reversed
    const kinds = validateSolid(g).map((i) => i.kind);
    expect(kinds).toContain('inconsistent-winding');
    // ...and prove the old question would have been satisfied: every
    // undirected edge is still shared by exactly two faces.
    expect(kinds).not.toContain('non-manifold-edge');
  });

  it('catches a non-finite vertex and a collapsed triangle', () => {
    const g = tetra();
    const pos = g.getAttribute('position');
    pos.setXYZ(3, NaN, 0, 0);
    expect(validateSolid(g).map((i) => i.kind)).toContain('non-finite');

    const flat = new THREE.BufferGeometry();
    flat.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 2, 0, 0], 3));
    flat.setIndex([0, 1, 2]);
    expect(validateSolid(flat).map((i) => i.kind)).toContain('degenerate-triangle');
  });

  it('describes its findings in one line for an export error', () => {
    const g = tetra();
    g.setIndex([]);
    expect(describeIssues(validateSolid(g))).toMatch(/no triangles/);
  });
});

describe('meshTolerances scale with the model', () => {
  it('keeps the historical tolerance for a normal-sized part and tightens for a tiny one', () => {
    const big = new THREE.BufferGeometry();
    big.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1], 3));
    expect(meshTolerances(big).weld).toBeCloseTo(1e-6, 12);

    const tiny = new THREE.BufferGeometry();
    tiny.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1e-3, 0, 0], 3));
    // A part a thousand times smaller gets a tolerance a thousand times finer,
    // instead of one that erases the whole model.
    expect(meshTolerances(tiny).weld).toBeLessThan(1e-8);
    expect(meshTolerances(tiny).weld).toBeGreaterThan(0);
  });
});

describe('every exported component is a valid solid', () => {
  const parts: Array<[string, ComponentNode, number | null]> = [
    ['nose cone', node({ type: 'nosecone', shape: 'ogive', length: 0.1, aftRadius: 0.012, thickness: 0.001 }), null],
    ['nose cone (conical)', node({ type: 'nosecone', shape: 'conical', length: 0.08, aftRadius: 0.012 }), null],
    ['nose cone (haack)', node({ type: 'nosecone', shape: 'haack', length: 0.12, aftRadius: 0.012 }), null],
    ['body tube', node({ type: 'bodytube', length: 0.3, outerRadius: 0.012, thickness: 0.0005 }), null],
    [
      'transition',
      node({ type: 'transition', shape: 'conical', length: 0.05, foreRadius: 0.012, aftRadius: 0.008 }),
      null,
    ],
    [
      'trapezoid fin',
      node({ type: 'trapezoidfinset', rootChord: 0.06, tipChord: 0.03, sweep: 0.03, height: 0.05, thickness: 0.003 }),
      0.012,
    ],
    [
      'trapezoid fin with a tab',
      node({
        type: 'trapezoidfinset',
        rootChord: 0.06,
        tipChord: 0.03,
        sweep: 0.03,
        height: 0.05,
        thickness: 0.003,
        tabHeight: 0.008,
        tabLength: 0.02,
      }),
      0.012,
    ],
    ['elliptical fin', node({ type: 'ellipticalfinset', rootChord: 0.05, height: 0.03, thickness: 0.003 }), 0.012],
    [
      'elliptical fin with a tab',
      node({
        type: 'ellipticalfinset',
        rootChord: 0.05,
        height: 0.03,
        thickness: 0.003,
        tabHeight: 0.008,
        tabLength: 0.02,
      }),
      0.012,
    ],
    [
      'freeform fin',
      node({
        type: 'freeformfinset',
        thickness: 0.003,
        points: [
          [0, 0],
          [0.02, 0.04],
          [0.06, 0.03],
          [0.07, 0],
        ],
      }),
      0.012,
    ],
    [
      // Non-convex planform: the case the fan-from-the-mean cap got wrong.
      'freeform fin with a concave notch',
      node({
        type: 'freeformfinset',
        thickness: 0.003,
        points: [
          [0, 0],
          [0.01, 0.05],
          [0.035, 0.012],
          [0.06, 0.05],
          [0.07, 0],
        ],
      }),
      0.012,
    ],
    ['tube fin (auto radius)', node({ type: 'tubefinset', length: 0.08, finCount: 6, thickness: 0.0005 }), 0.025],
    ['launch lug', node({ type: 'launchlug', length: 0.04, outerRadius: 0.0022, thickness: 0.0003 }), null],
  ];

  it.each(parts)('%s', (_label, n, parentRadius) => {
    const geo = solidForNode(n, parentRadius);
    expect(geo).not.toBeNull();
    const issues = validateSolid(geo!, meshTolerances(geo!).area);
    expect(describeIssues(issues)).toBe('');
  });

  it('refuses a scaled-down design rather than exporting an empty solid', () => {
    // 0.003x on a 70 mm nose cone put every triangle under the old fixed
    // 1e-12 area cut. They were all dropped, the empty result had no open
    // edges, and the export "succeeded" with nothing in the file.
    const tiny = node({ type: 'nosecone', shape: 'ogive', length: 0.00021, aftRadius: 0.000036 });
    const geo = solidForNode(tiny);
    expect(geo).not.toBeNull();
    expect(geo!.getIndex()!.count).toBeGreaterThan(0);
    expect(describeIssues(validateSolid(geo!, meshTolerances(geo!).area))).toBe('');
  });
});

describe('isSimplePolygon rejects a pinched outline', () => {
  it('still accepts an ordinary fin', () => {
    expect(
      isSimplePolygon([
        [0, 0],
        [0.02, 0.04],
        [0.06, 0.03],
        [0.07, 0],
      ]),
    ).toBe(true);
  });

  it('rejects a bow tie', () => {
    expect(
      isSimplePolygon([
        [0, 0],
        [0.06, 0.04],
        [0.06, 0],
        [0, 0.04],
      ]),
    ).toBe(false);
  });

  it('rejects two vertices dragged onto each other', () => {
    // FreeformFinEditor allows it, and it extrudes into a pinch point where
    // four shell faces share one vertex. Strict inequalities alone said fine.
    expect(
      isSimplePolygon([
        [0, 0],
        [0.03, 0.04],
        [0.06, 0],
        [0.03, 0.04],
        [0.09, 0],
      ]),
    ).toBe(false);
  });

  it('rejects a vertex sitting exactly on a non-adjacent edge', () => {
    expect(
      // Vertex 3 sits exactly on the root edge (vertex 0 -> vertex 1).
      isSimplePolygon([
        [0, 0],
        [0.08, 0],
        [0.08, 0.04],
        [0.04, 0],
        [0, 0.04],
      ]),
    ).toBe(false);
  });
});

describe('makeWatertight caps a non-convex hole without overlapping itself', () => {
  /**
   * An open prism whose cross-section is concave: a notch at (1, 0.5) between
   * two spikes. The arithmetic MEAN of the five corners is (1, 0.9), which
   * sits in the notch, OUTSIDE the polygon. Fanning a cap from there emits
   * triangles that overlap and face opposite ways, while still using every
   * boundary edge exactly twice, so the old edge count reported a watertight
   * solid. Ear clipping uses only the loop's own vertices and cannot do that.
   */
  const CONTOUR: Array<[number, number]> = [
    [0, 0],
    [2, 0],
    [2, 2],
    [1, 0.5],
    [0, 2],
  ];

  /** Side walls only, no caps, consistently wound outward. */
  function openPrism(): THREE.BufferGeometry {
    const pos: number[] = [];
    for (const [x, y] of CONTOUR) pos.push(x, y, 0, x, y, 1); // bottom, top per corner
    const idx: number[] = [];
    for (let i = 0; i < CONTOUR.length; i++) {
      const j = (i + 1) % CONTOUR.length;
      const b0 = i * 2,
        t0 = i * 2 + 1,
        b1 = j * 2,
        t1 = j * 2 + 1;
      idx.push(b0, b1, t1, b0, t1, t0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }

  it('starts as an open shell with two boundary loops', () => {
    const open = openPrism();
    expect(countBoundaryEdges(open)).toBe(CONTOUR.length * 2);
    expect(validateSolid(open).map((i) => i.kind)).toContain('non-manifold-edge');
  });

  it('closes into a genuinely valid solid', () => {
    const capped = makeWatertight(openPrism());
    expect(countBoundaryEdges(capped)).toBe(0); // what the old check asked
    expect(describeIssues(validateSolid(capped))).toBe(''); // what it could not ask
  });

  it('keeps every cap triangle inside the outline it is closing', () => {
    // THE fan bug, stated directly. It is a GEOMETRIC defect, not a
    // topological one: a fan from an apex outside the loop is still a closed,
    // consistently wound surface (each spoke is traversed once each way), so
    // neither an edge count nor validateSolid's winding check can see it. What
    // is wrong is that the cap covers area the part does not occupy and then
    // cancels it with oppositely-wound triangles, leaving a self-intersecting
    // lid. Ear clipping uses only the loop's own vertices, so it cannot.
    const capped = makeWatertight(openPrism());
    const pos = capped.getAttribute('position');
    const idx = capped.getIndex()!;

    const inside = (x: number, y: number): boolean => {
      let hit = false;
      for (let i = 0, j = CONTOUR.length - 1; i < CONTOUR.length; j = i++) {
        const [xi, yi] = CONTOUR[i]!;
        const [xj, yj] = CONTOUR[j]!;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    };

    let capTriangles = 0;
    for (let t = 0; t < idx.count; t += 3) {
      const ia = idx.getX(t),
        ib = idx.getX(t + 1),
        ic = idx.getX(t + 2);
      // Only the bottom lid: the three corners all on z = 0.
      if (pos.getZ(ia) !== 0 || pos.getZ(ib) !== 0 || pos.getZ(ic) !== 0) continue;
      capTriangles++;
      const cx = (pos.getX(ia) + pos.getX(ib) + pos.getX(ic)) / 3;
      const cy = (pos.getY(ia) + pos.getY(ib) + pos.getY(ic)) / 3;
      expect({ cx, cy, inside: inside(cx, cy) }).toEqual({ cx, cy, inside: true });
    }
    // The notch means a correct triangulation needs at least three ears.
    expect(capTriangles).toBeGreaterThanOrEqual(3);
  });

  it('adds no vertex of its own', () => {
    // The fan invented an apex; ear clipping reuses the loop's corners. A cap
    // that needs a new point is a cap that can put it in the wrong place.
    const open = openPrism();
    const before = open.getAttribute('position').count;
    expect(makeWatertight(openPrism()).getAttribute('position').count).toBe(before);
  });
});
