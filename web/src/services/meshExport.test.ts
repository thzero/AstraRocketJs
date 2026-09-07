// @vitest-environment jsdom
// GLTFExporter's binary path uses FileReader/Blob, so this suite needs a DOM.
import { describe, it, expect } from 'vitest';
import type { ComponentNode } from '../engine/openRocketEngine';
import { solidForNode } from './solidMesh';
import { solidToObj, solidToStl, solidToGlb, safeName } from './meshExport';

// A single nose cone's watertight solid, in metres — the mesh exporters scale it.
const nose = solidForNode({ type: 'nosecone', shape: 'ogive', length: 0.1, aftRadius: 0.013, thickness: 0.002 } as unknown as ComponentNode)!;

describe('component mesh export', () => {
  it('OBJ has vertices and faces', () => {
    const obj = solidToObj(nose);
    expect(obj).toMatch(/^v /m);
    expect(obj).toMatch(/^f /m);
  });

  it('STL is a valid binary blob with a matching triangle count', () => {
    const buf = solidToStl(nose);
    const count = new DataView(buf).getUint32(80, true);
    expect(buf.byteLength).toBe(84 + count * 50); // 84 header + 50 bytes/triangle
    expect(count).toBeGreaterThan(20);
  });

  it('STL is watertight (no holes) and scaled to millimetres', () => {
    const dv = new DataView(solidToStl(nose));
    const n = dv.getUint32(80, true);
    const edges = new Map<string, number>();
    let minX = Infinity, maxX = -Infinity;
    const key = (p: number[]) => p.map((c) => c.toFixed(3)).join(',');
    for (let i = 0; i < n; i++) {
      const o = 84 + i * 50 + 12;
      const v: number[][] = [];
      for (let k = 0; k < 3; k++) {
        const b = o + k * 12;
        const x = dv.getFloat32(b, true);
        v.push([x, dv.getFloat32(b + 4, true), dv.getFloat32(b + 8, true)]);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      }
      for (let e = 0; e < 3; e++) {
        const a = key(v[e]), b = key(v[(e + 1) % 3]);
        const kk = a < b ? `${a}|${b}` : `${b}|${a}`;
        edges.set(kk, (edges.get(kk) ?? 0) + 1);
      }
    }
    let holes = 0;
    for (const c of edges.values()) if (c === 1) holes++;
    expect(holes).toBe(0);
    // A 0.1 m nose lies along the X axis — must export at ~100 mm (metre-bug guard).
    expect(maxX - minX).toBeGreaterThan(50);
  });

  it('GLB starts with the glTF magic', async () => {
    const buf = await solidToGlb(nose);
    expect(new DataView(buf).getUint32(0, true)).toBe(0x46546c67); // 'glTF'
  });

  it('safeName sanitises the filename', () => {
    expect(safeName('My Fin!')).toBe('My_Fin_');
    expect(safeName('')).toBe('part');
    expect(safeName(undefined)).toBe('part');
  });
});
