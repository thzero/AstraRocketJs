import { describe, it, expect } from 'vitest';
import type { RocketTree } from '../engine/openRocketEngine';
import { componentToDxf } from './dxfExport';

const tree = {
  name: 'Cutter',
  components: [
    {
      type: 'stage',
      name: 'S',
      children: [
        { type: 'nosecone', id: 'nose', shape: 'ogive', length: 0.1, aftRadius: 0.013, thickness: 0.002 },
        {
          type: 'bodytube',
          id: 'body',
          length: 0.3,
          outerRadius: 0.013,
          thickness: 0.001,
          children: [
            {
              type: 'trapezoidfinset',
              id: 'fins',
              finCount: 4,
              rootChord: 0.06,
              tipChord: 0.03,
              sweep: 0.02,
              height: 0.04,
              thickness: 0.003,
              tabLength: 0.03,
              tabHeight: 0.005,
              tabOffsetMethod: 'middle',
            },
            { type: 'centeringring', id: 'cr', length: 0.003 },
            { type: 'bulkhead', id: 'bh', length: 0.003 },
            { type: 'tubecoupler', id: 'coupler', length: 0.05, thickness: 0.0005 },
            { type: 'engineblock', id: 'eb', length: 0.005, thickness: 0.00095 },
            { type: 'innertube', id: 'mount', outerRadius: 0.0095, thickness: 0.0005, length: 0.07 },
          ],
        },
      ],
    },
  ],
} as unknown as RocketTree;

/** Parse the flat "code\nvalue\n" DXF stream into [code, value] pairs. */
function pairs(dxf: string): Array<[string, string]> {
  const lines = dxf.split('\n');
  const out: Array<[string, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push([lines[i], lines[i + 1]]);
  return out;
}

describe('per-component DXF export', () => {
  it('a fin is a well-formed R12 doc with a closed tab polyline', () => {
    const dxf = componentToDxf(tree, 'fins')!;
    expect(dxf).not.toBeNull();
    expect(dxf).toContain('AC1009');
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
    expect(dxf).toContain('\nPOLYLINE\n');
    const ys: number[] = [];
    const ps = pairs(dxf);
    for (let i = 0; i < ps.length; i++) {
      if (ps[i][0] === '0' && ps[i][1] === 'VERTEX') {
        const y = ps.slice(i, i + 6).find(([c]) => c === '20');
        if (y) ys.push(Number(y[1]));
      }
    }
    expect(ys.length).toBeGreaterThanOrEqual(6); // planform + tab corners
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(45, 0); // 40 mm span + 5 mm tab
  });

  it('a centering ring emits the body-bore outer circle and the mount bore', () => {
    const dxf = componentToDxf(tree, 'cr')!;
    const radii = pairs(dxf)
      .map(([c, v], i, a) => (c === '0' && v === 'CIRCLE' ? a.slice(i, i + 5).find(([cc]) => cc === '40')?.[1] : null))
      .filter(Boolean)
      .map(Number);
    expect(radii).toContain(12); // body inner radius 13 - 1 mm
    expect(radii).toContain(9.5); // mount inner-tube outer radius
  });

  it('a bulkhead emits a single outer disc circle', () => {
    const dxf = componentToDxf(tree, 'bh')!;
    expect(dxf).toContain('\nCIRCLE\n');
  });

  it('returns null for parts that are not flat plate cuts', () => {
    expect(componentToDxf(tree, 'nose')).toBeNull(); // a nose is not plate-cut
    expect(componentToDxf(tree, 'coupler')).toBeNull(); // a tube, exports as a 3D solid
    expect(componentToDxf(tree, 'eb')).toBeNull(); // an engine block is a tube too
    expect(componentToDxf(tree, 'missing')).toBeNull();
  });
});
