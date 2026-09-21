import { describe, it, expect } from 'vitest';
import { componentFormats } from './componentFormats';

describe('componentFormats', () => {
  it('offers mesh + DXF for a fin (a flat, plate-cut solid)', () => {
    expect(componentFormats('trapezoidfinset')).toEqual(['stl', 'obj', 'glb', '3mf', 'dxf']);
    expect(componentFormats('freeformfinset')).toEqual(['stl', 'obj', 'glb', '3mf', 'dxf']);
  });

  // 3MF sits after the three that were here first, so an existing click does
  // not move, and before DXF, which is a different KIND of output (a cut sheet,
  // not a solid).
  it('offers only mesh for a solid body of revolution', () => {
    expect(componentFormats('nosecone')).toEqual(['stl', 'obj', 'glb', '3mf']);
    expect(componentFormats('bodytube')).toEqual(['stl', 'obj', 'glb', '3mf']);
    expect(componentFormats('tubecoupler')).toEqual(['stl', 'obj', 'glb', '3mf']); // a tube, not plate → no DXF
  });

  it('offers mesh + DXF for a centering ring (disc: a solid AND plate-cut)', () => {
    expect(componentFormats('centeringring')).toEqual(['stl', 'obj', 'glb', '3mf', 'dxf']);
    expect(componentFormats('bulkhead')).toEqual(['stl', 'obj', 'glb', '3mf', 'dxf']);
  });

  it('offers nothing for parts with no exportable object', () => {
    expect(componentFormats('parachute')).toEqual([]);
    expect(componentFormats('masscomponent')).toEqual([]);
    expect(componentFormats('streamer')).toEqual([]);
    expect(componentFormats('stage')).toEqual([]);
  });
});
