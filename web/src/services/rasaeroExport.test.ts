// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { RocketTree } from '../engine/openRocketEngine';
import { exportCdx1 } from './rasaeroExport';

// A 1-inch-diameter rocket with clean-inch geometry so the metre→inch (×39.37)
// conversions land on round numbers the assertions can pin exactly.
const tree: RocketTree = {
  name: 'Test Bird',
  components: [
    {
      type: 'stage',
      name: 'Sustainer',
      children: [
        { type: 'nosecone', id: 'nc', length: 0.1, aftRadius: 0.0127, shape: 'ogive', thickness: 0.001 },
        {
          type: 'bodytube',
          id: 'bt',
          length: 0.254, // 10 in
          outerRadius: 0.0127, // 1 in dia
          children: [
            {
              type: 'trapezoidfinset',
              id: 'fin',
              finCount: 3,
              rootChord: 0.0508, // 2 in
              tipChord: 0.0254, // 1 in
              sweep: 0.0254, // 1 in
              height: 0.0254, // 1 in span
              thickness: 0.003,
              position: { method: 'bottom', offset: 0 },
            },
            { type: 'launchlug', id: 'lug', length: 0.0254, outerRadius: 0.002, position: { method: 'middle', offset: 0 } },
          ],
        },
      ],
    },
  ],
};

describe('exportCdx1', () => {
  const xml = exportCdx1({ tree, name: 'Test Bird', launchMassKg: 0.45359237, launchCgM: 0.127 });

  it('is well-formed XML rooted at RASAeroDocument (FileVersion 2)', () => {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.querySelector('RASAeroDocument > FileVersion')?.textContent).toBe('2');
    expect(doc.querySelector('RASAeroDocument > RocketDesign')).not.toBeNull();
  });

  it('writes the nose cone with mapped shape and inch diameter', () => {
    expect(xml).toContain('<Shape>Tangent Ogive</Shape>');
    // aftRadius 0.0127 m → diameter 0.0254 m → 1 in.
    expect(xml).toMatch(/<NoseCone>[\s\S]*?<Diameter>1<\/Diameter>/);
  });

  it('writes the body tube with the launch lug and its fin set', () => {
    expect(xml).toMatch(/<BodyTube>[\s\S]*?<LaunchLugLength>1<\/LaunchLugLength>/);
    expect(xml).toContain('<Count>3</Count>');
    expect(xml).toContain('<Chord>2</Chord>'); // rootChord 2 in
    expect(xml).toContain('<Span>1</Span>'); // height 1 in
    expect(xml).toContain('<TipChord>1</TipChord>');
  });

  it('fills the mandatory simulation block with loaded weight (lb) and CG (in)', () => {
    // 0.45359237 kg → 1.000 lb; 0.127 m → 5 in.
    expect(xml).toContain('<SustainerLaunchWt>1</SustainerLaunchWt>');
    expect(xml).toContain('<SustainerCG>5</SustainerCG>');
    expect(xml).toContain('</SimulationList>');
  });

  it('rejects a design RASAero cannot represent (tube fins)', () => {
    const bad: RocketTree = {
      components: [
        { type: 'stage', children: [{ type: 'bodytube', length: 0.2, outerRadius: 0.012, children: [{ type: 'tubefinset', finCount: 4 }] }] },
      ],
    };
    expect(() => exportCdx1({ tree: bad, name: 'bad' })).toThrow(/RASAero/);
  });
});
