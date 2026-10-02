import { describe, it, expect } from 'vitest';
import { discDims, plateOuter, tubeRadii, type Tube } from '../../../src/services/design/discGeometry';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';

const node = (o: object) => o as unknown as ComponentNode;

/**
 * `discDims` is the one source the DXF cut sheet, the printable solids and the
 * 3D internals all share for ring and coupler sizing, so a wrong answer here is
 * three wrong parts at once. It had no test file.
 */
describe('discDims', () => {
  /** A 12 mm-radius tube with a 1 mm wall, as the enclosing airframe. */
  const tube: Tube = { outerR: 0.012, innerR: 0.011 };

  it('gives a coupler its bore', () => {
    const d = discDims(node({ type: 'tubecoupler', thickness: 0.001, length: 0.05 }), tube, []);
    expect(d).not.toBeNull();
    expect(d!.innerR).toBeCloseTo(d!.outerR - 0.001, 12);
    expect(d!.length).toBeCloseTo(0.05, 12);
  });

  it('refuses a wall at or past the radius instead of reporting a solid rod', () => {
    // `discSolid` takes its NO-BORE branch on innerR === 0 and lathes a solid
    // cylinder, so a units slip (a 20 mm wall on a 12 mm radius) printed the
    // coupler as a plug with nothing saying so. `solidMesh`'s tube branch
    // refuses the same case and explains why; the disc path had no guard.
    expect(discDims(node({ type: 'tubecoupler', thickness: 0.02, length: 0.05 }), tube, [])).toBeNull();
    expect(discDims(node({ type: 'engineblock', thickness: 0.05 }), tube, [])).toBeNull();
  });

  it('refuses a wall exactly equal to the radius', () => {
    // The boundary, which `Math.max(0, outerR - wall)` turned into a 0 bore
    // rather than a refusal.
    const r = plateOuter(node({ type: 'tubecoupler' }), tube);
    expect(discDims(node({ type: 'tubecoupler', thickness: r }), tube, [])).toBeNull();
  });

  it('still accepts a wall a real coupler uses', () => {
    expect(discDims(node({ type: 'tubecoupler', thickness: 0.0005 }), tube, [])).not.toBeNull();
  });

  it('gives a bulkhead no bore, which is what a bulkhead is', () => {
    expect(discDims(node({ type: 'bulkhead' }), tube, [])?.innerR).toBe(0);
  });

  it('returns null for a type it does not size', () => {
    expect(discDims(node({ type: 'bodytube' }), tube, [])).toBeNull();
  });
});

describe('tubeRadii', () => {
  it('reports the bore a tube offers from its own wall', () => {
    const t = tubeRadii(node({ type: 'bodytube', outerRadius: 0.012, thickness: 0.001 }));
    expect(t).toMatchObject({ outerR: 0.012 });
    expect(t!.innerR).toBeCloseTo(0.011, 12);
  });

  it('is null for a component that is not a tube', () => {
    expect(tubeRadii(node({ type: 'bulkhead' }))).toBeNull();
  });
});
