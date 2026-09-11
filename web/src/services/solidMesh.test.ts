// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type * as THREEType from 'three';
import type { ComponentNode } from '../engine/openRocketEngine';
import { solidForNode, discSolid, makeWatertight, countBoundaryEdges } from './solidMesh';

/** Count open (hole) and non-manifold edges of one geometry, by vertex position. */
function quality(g: THREEType.BufferGeometry): { hole: number; nonManifold: number } {
  const idx = g.getIndex()!;
  const pos = g.getAttribute('position');
  const key = (i: number) => `${pos.getX(i).toFixed(7)},${pos.getY(i).toFixed(7)},${pos.getZ(i).toFixed(7)}`;
  const ek = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const m = new Map<string, number>();
  for (let i = 0; i < idx.count; i += 3) {
    const k = [key(idx.getX(i)), key(idx.getX(i + 1)), key(idx.getX(i + 2))];
    for (let e = 0; e < 3; e++) {
      const kk = ek(k[e]!, k[(e + 1) % 3]!);
      m.set(kk, (m.get(kk) ?? 0) + 1);
    }
  }
  let hole = 0, nonManifold = 0;
  for (const c of m.values()) { if (c === 1) hole++; else if (c > 2) nonManifold++; }
  return { hole, nonManifold };
}

const cases: Array<[string, ComponentNode]> = [
  ['ogive nose', { type: 'nosecone', shape: 'ogive', length: 0.1, aftRadius: 0.013, thickness: 0.002 } as unknown as ComponentNode],
  ['stubby ellipsoid nose', { type: 'nosecone', shape: 'ellipsoid', length: 0.02, aftRadius: 0.02, thickness: 0.002 } as unknown as ComponentNode],
  ['body tube (hollow)', { type: 'bodytube', length: 0.3, outerRadius: 0.013, thickness: 0.001 } as unknown as ComponentNode],
  ['inner tube', { type: 'innertube', length: 0.07, outerRadius: 0.0095, thickness: 0.0005 } as unknown as ComponentNode],
  ['launch lug', { type: 'launchlug', length: 0.03, outerRadius: 0.004 } as unknown as ComponentNode],
  ['tube fin set', { type: 'tubefinset', finCount: 3, length: 0.06, outerRadius: 0.02, thickness: 0.001 } as unknown as ComponentNode],
  ['transition', { type: 'transition', shape: 'conical', length: 0.03, foreRadius: 0.013, aftRadius: 0.009, thickness: 0.001 } as unknown as ComponentNode],
  ['nose with aft shoulder', { type: 'nosecone', shape: 'ogive', length: 0.1, aftRadius: 0.013, thickness: 0.002, shoulderRadius: 0.011, shoulderLength: 0.02 } as unknown as ComponentNode],
  ['transition with both shoulders', { type: 'transition', shape: 'ogive', length: 0.04, foreRadius: 0.013, aftRadius: 0.02, foreShoulderRadius: 0.011, foreShoulderLength: 0.015, aftShoulderRadius: 0.018, aftShoulderLength: 0.015 } as unknown as ComponentNode],
  ['trapezoid fin', { type: 'trapezoidfinset', finCount: 4, rootChord: 0.06, tipChord: 0.03, sweep: 0.02, height: 0.04, thickness: 0.003 } as unknown as ComponentNode],
  ['elliptical fin', { type: 'ellipticalfinset', finCount: 3, rootChord: 0.05, height: 0.03, thickness: 0.003 } as unknown as ComponentNode],
  ['freeform fin', { type: 'freeformfinset', finCount: 3, points: [[0, 0], [0.02, 0.03], [0.05, 0]], thickness: 0.003 } as unknown as ComponentNode],
];

describe('solid mesher (per component)', () => {
  it.each(cases)('%s is watertight and manifold', (_label, node) => {
    const geo = solidForNode(node);
    expect(geo).not.toBeNull();
    const q = quality(geo!);
    expect(q.hole).toBe(0);
    expect(q.nonManifold).toBe(0);
  });

  it('returns null for non-geometric parts', () => {
    for (const type of ['parachute', 'streamer', 'shockcord', 'masscomponent', 'railbutton']) {
      expect(solidForNode({ type } as unknown as ComponentNode)).toBeNull();
    }
  });

  it('makeWatertight caps EVERY boundary loop when two share a vertex', () => {
    // Two open triangles sharing one corner (vertex 0). That shared vertex is
    // the start of two boundary edges — the old single-successor Map kept only
    // the last and left one triangle's loop uncapped; the multimap caps both.
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0.5, 1, 0, -1, 0, 0, -0.5, -1, 0], 3),
    );
    g.setIndex([0, 1, 2, 0, 3, 4]);
    expect(countBoundaryEdges(g)).toBeGreaterThan(0); // open to begin with
    expect(countBoundaryEdges(makeWatertight(g))).toBe(0); // both loops sealed
  });

  it('returns null for degenerate geometry instead of a broken/non-manifold solid', () => {
    const n = (o: object) => solidForNode(o as unknown as ComponentNode);
    expect(n({ type: 'nosecone', shape: 'ogive', length: 0.1, aftRadius: 0 })).toBeNull(); // zero radius
    expect(n({ type: 'nosecone', shape: 'ogive', length: 0, aftRadius: 0.013 })).toBeNull(); // zero length
    expect(n({ type: 'transition', shape: 'conical', length: 0, foreRadius: 0.01, aftRadius: 0.008 })).toBeNull();
    expect(n({ type: 'trapezoidfinset', rootChord: 0.06, height: 0, thickness: 0.003 })).toBeNull(); // zero-area fin
    expect(n({ type: 'freeformfinset', points: [[0, 0], [0.05, 0.03]], thickness: 0.003 })).toBeNull(); // < 3 points
  });

  it('a solid disc (bulkhead) is watertight and manifold', () => {
    const q = quality(discSolid(0.012, 0, 0.003));
    expect(q.hole).toBe(0);
    expect(q.nonManifold).toBe(0);
  });

  it('a bored ring (centring ring) is watertight and manifold', () => {
    const q = quality(discSolid(0.012, 0.0095, 0.003));
    expect(q.hole).toBe(0);
    expect(q.nonManifold).toBe(0);
  });

  it('a short tube (coupler) is watertight and manifold', () => {
    const q = quality(discSolid(0.013, 0.0125, 0.05));
    expect(q.hole).toBe(0);
    expect(q.nonManifold).toBe(0);
  });

  it('tubes export hollow (a bore, never a solid rod)', () => {
    const minRadius = (g: THREEType.BufferGeometry) => {
      const p = g.getAttribute('position');
      let min = Infinity;
      for (let i = 0; i < p.count; i++) min = Math.min(min, Math.hypot(p.getY(i), p.getZ(i)));
      return min;
    };
    const tubes: ComponentNode[] = [
      { type: 'bodytube', length: 0.3, outerRadius: 0.013, thickness: 0.001 } as unknown as ComponentNode,
      { type: 'innertube', length: 0.07, outerRadius: 0.0095, thickness: 0.0005 } as unknown as ComponentNode,
      { type: 'launchlug', length: 0.03, outerRadius: 0.004 } as unknown as ComponentNode,
      { type: 'tubefinset', finCount: 3, length: 0.06, outerRadius: 0.02, thickness: 0.001 } as unknown as ComponentNode,
    ];
    for (const t of tubes) expect(minRadius(solidForNode(t)!)).toBeGreaterThan(0.001); // has a bore
    // A nose is a solid body — it reaches the axis.
    expect(minRadius(solidForNode({ type: 'nosecone', shape: 'ogive', length: 0.1, aftRadius: 0.013 } as unknown as ComponentNode)!)).toBeLessThan(1e-6);
  });
});
