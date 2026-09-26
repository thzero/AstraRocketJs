// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { RocketTree } from '../../src/engine/openRocketEngine';
import { exportCdx1, rasaeroSurface, RASAERO_SURFACE_DEFAULT } from '../../src/services/rasaeroExport';

// A 1-inch-diameter rocket with clean-inch geometry so the meter→inch (×39.37)
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
            {
              type: 'launchlug',
              id: 'lug',
              length: 0.0254,
              outerRadius: 0.002,
              position: { method: 'middle', offset: 0 },
            },
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
        {
          type: 'stage',
          children: [
            { type: 'bodytube', length: 0.2, outerRadius: 0.012, children: [{ type: 'tubefinset', finCount: 4 }] },
          ],
        },
      ],
    };
    expect(() => exportCdx1({ tree: bad, name: 'bad' })).toThrow(/RASAero/);
  });
});

/**
 * The surface table is the desktop's RASAeroCommonConstants
 * .OPENROCKET_TO_RASAERO_SURFACE (lines 370-391), row for row. The earlier
 * "approx" table sent `polished` to Sheet Metal, `smooth` to Smooth Paint and
 * `rough` to Cast Iron; the desktop sends none of those there, and lets ROUGH
 * and POLISHED fall to its default with a warning.
 */
describe('finish to RASAero surface (desktop table)', () => {
  it.each([
    ['mirror', 'Smooth (Zero Roughness)'],
    ['finishpolished', 'Polished'],
    ['optimum', 'Sheet Metal'],
    ['smooth', 'Camouflage Paint'],
    ['normal', 'Rough Camouflage Paint'],
    ['unfinished', 'Galvanized Metal'],
    ['roughunfinished', 'Cast Iron (Very Rough)'],
  ])('%s maps to %s without a warning', (finish, surface) => {
    expect(rasaeroSurface(finish)).toEqual({ surface });
  });

  it.each(['rough', 'polished', 'nosuchfinish'])('%s falls to Smooth with the desktop warning', (finish) => {
    const r = rasaeroSurface(finish);
    expect(r.surface).toBe(RASAERO_SURFACE_DEFAULT);
    expect(r.warning).toBe(`Unknown surface finish: ${finish}, defaulting to Smooth.`);
  });

  const withFinish = (finish: string | undefined): RocketTree => ({
    components: [
      {
        type: 'stage',
        children: [
          { type: 'nosecone', id: 'nc', length: 0.1, aftRadius: 0.0127, shape: 'ogive', ...(finish ? { finish } : {}) },
          { type: 'bodytube', id: 'bt', length: 0.254, outerRadius: 0.0127 },
        ],
      },
    ],
  });

  it('takes the global surface from the first nose cone, as RocketDesignDTO does', () => {
    expect(exportCdx1({ tree: withFinish('optimum'), name: 'x' })).toContain('<Surface>Sheet Metal</Surface>');
    // No finish key is the kernel's NORMAL.
    expect(exportCdx1({ tree: withFinish(undefined), name: 'x' })).toContain(
      '<Surface>Rough Camouflage Paint</Surface>',
    );
  });

  it('collects the warning for a finish with no row', () => {
    const warnings: string[] = [];
    const xml = exportCdx1({ tree: withFinish('rough'), name: 'x', warnings });
    expect(xml).toContain('<Surface>Smooth (Zero Roughness)</Surface>');
    expect(warnings).toEqual(['Unknown surface finish: rough, defaulting to Smooth.']);
  });
});

/**
 * An assembly in the sustainer chain used to be skipped like an internal
 * part. A pod or a strap-on booster is external aerodynamics, and a file that
 * quietly omits it describes a different rocket (the desktop refuses them,
 * RASAeroExport.error33).
 */
describe('assemblies RASAero cannot hold', () => {
  const withAssembly = (type: 'podset' | 'parallelstage'): RocketTree => ({
    components: [
      {
        type: 'stage',
        children: [
          { type: 'nosecone', id: 'nc', length: 0.1, aftRadius: 0.0127, shape: 'ogive' },
          { type: 'bodytube', id: 'bt', length: 0.254, outerRadius: 0.0127 },
          { type, id: 'asm', name: 'Side pod', children: [{ type: 'bodytube', length: 0.1, outerRadius: 0.005 }] },
        ],
      },
    ],
  });

  it('refuses a pod set by name rather than dropping it', () => {
    expect(() => exportCdx1({ tree: withAssembly('podset'), name: 'x' })).toThrow(/pods.*Side pod/);
  });

  it('refuses a parallel stage by name rather than dropping it', () => {
    expect(() => exportCdx1({ tree: withAssembly('parallelstage'), name: 'x' })).toThrow(/strap-on.*Side pod/);
  });
});

describe('rail button as RASAero rail guide', () => {
  const withButton = (button: Record<string, unknown> | null): RocketTree => ({
    components: [
      {
        type: 'stage',
        children: [
          { type: 'nosecone', id: 'nc', length: 0.1, aftRadius: 0.0127, shape: 'ogive' },
          {
            type: 'bodytube',
            id: 'bt',
            length: 0.254,
            outerRadius: 0.0127,
            children: button ? [{ type: 'railbutton', id: 'rb', ...button }] : [],
          },
        ],
      },
    ],
  });

  it('writes the outer diameter and total height in inches', () => {
    // 0.0127 m is 0.5 in; 0.0254 m is 1 in.
    const xml = exportCdx1({ tree: withButton({ outerDiameter: 0.0127, height: 0.0254 }), name: 'x' });
    expect(xml).toContain('<RailGuideDiameter>0.5</RailGuideDiameter>');
    expect(xml).toContain('<RailGuideHeight>1</RailGuideHeight>');
  });

  it('falls back to the desktop button size for a bare node, and 0 with no button', () => {
    const xml = exportCdx1({ tree: withButton({}), name: 'x' });
    expect(xml).toContain(`<RailGuideDiameter>${(0.0097 * 39.37).toFixed(4).replace(/0+$/, '')}</RailGuideDiameter>`);
    expect(xml).toContain(`<RailGuideHeight>${(0.0097 * 39.37).toFixed(4).replace(/0+$/, '')}</RailGuideHeight>`);
    const none = exportCdx1({ tree: withButton(null), name: 'x' });
    expect(none).toContain('<RailGuideDiameter>0</RailGuideDiameter>');
    expect(none).toContain('<RailGuideHeight>0</RailGuideHeight>');
  });
});
