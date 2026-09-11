import { describe, it, expect } from 'vitest';
import { componentFormats } from './componentFormats';

describe('componentFormats', () => {
  it('offers mesh + DXF for a fin (a flat, plate-cut solid)', () => {
    expect(componentFormats('trapezoidfinset')).toEqual(['stl', 'obj', 'glb', 'dxf']);
    expect(componentFormats('freeformfinset')).toEqual(['stl', 'obj', 'glb', 'dxf']);
  });

  it('offers only mesh for a solid body of revolution', () => {
    expect(componentFormats('nosecone')).toEqual(['stl', 'obj', 'glb']);
    expect(componentFormats('bodytube')).toEqual(['stl', 'obj', 'glb']);
    expect(componentFormats('tubecoupler')).toEqual(['stl', 'obj', 'glb']); // a tube, not plate → no DXF
  });

  it('offers mesh + DXF for a centering ring (disc: a solid AND plate-cut)', () => {
    expect(componentFormats('centeringring')).toEqual(['stl', 'obj', 'glb', 'dxf']);
    expect(componentFormats('bulkhead')).toEqual(['stl', 'obj', 'glb', 'dxf']);
  });

  it('offers nothing for parts with no exportable object', () => {
    expect(componentFormats('parachute')).toEqual([]);
    expect(componentFormats('masscomponent')).toEqual([]);
    expect(componentFormats('streamer')).toEqual([]);
    expect(componentFormats('stage')).toEqual([]);
  });
});
