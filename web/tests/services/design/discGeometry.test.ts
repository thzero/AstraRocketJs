import { describe, it, expect } from 'vitest';
import { boreAt, discDims, plateOuter, tubeRadii, type Tube } from '../../../src/services/design/discGeometry';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';
import { KERNEL_DEFAULTS } from '../../../src/tree/kernelDefaults';

const node = (o: object) => o as unknown as ComponentNode;

/**
 * `discDims` is the one source the DXF cut sheet, the printable solids and the
 * 3D internals all share for ring and coupler sizing, so a wrong answer here is
 * three wrong parts at once.
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
    // `discSolid` takes its no-bore branch on innerR === 0 and lathes a solid
    // cylinder, so a units slip (a 20 mm wall on a 12 mm radius) would print the
    // coupler as a plug with nothing saying so. `solidMesh`'s tube branch
    // refuses the same case, and the disc path has to match it.
    expect(discDims(node({ type: 'tubecoupler', thickness: 0.02, length: 0.05 }), tube, [])).toBeNull();
    expect(discDims(node({ type: 'engineblock', thickness: 0.05 }), tube, [])).toBeNull();
  });

  it('refuses a wall exactly equal to the radius', () => {
    // The boundary: a clamp like `Math.max(0, outerR - wall)` would turn it
    // into a 0 bore rather than a refusal.
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
  it('offers no bore inside a filled body tube', () => {
    // BodyTube.getInnerRadius is 0 when the tube is filled.
    expect(tubeRadii(node({ type: 'bodytube', outerRadius: 0.012, thickness: 0.001, filled: true }))).toEqual({
      outerR: 0.012,
      innerR: 0,
    });
  });

  it('reports the bore a tube offers from its own wall', () => {
    const t = tubeRadii(node({ type: 'bodytube', outerRadius: 0.012, thickness: 0.001 }));
    expect(t).toMatchObject({ outerR: 0.012 });
    expect(t!.innerR).toBeCloseTo(0.011, 12);
  });

  it('is null for a component that is not a tube', () => {
    expect(tubeRadii(node({ type: 'bulkhead' }))).toBeNull();
  });
});

/**
 * A tube with no `thickness` key takes its own type's kernel wall, wherever its
 * bore is read. The kernel gives an inner tube and a coupler 0.5 mm
 * (ComponentFactory, cases "innertube" and "tubecoupler") and a body tube
 * 0.3 mm; reading the body tube's for all three would make a coupler's bore, as
 * the tube enclosing a ring, 0.2 mm wider than the coupler itself.
 */
describe('a keyless tube wall', () => {
  const tube = (type: string, outerRadius: number) => ({ type, id: type, outerRadius }) as unknown as ComponentNode;

  it.each([
    ['bodytube', KERNEL_DEFAULTS.bodytube.thickness],
    ['innertube', KERNEL_DEFAULTS.innertube.thickness],
    ['tubecoupler', KERNEL_DEFAULTS.tubecoupler.thickness],
  ])('is the kernel default for a %s', (type, wall) => {
    expect(tubeRadii(tube(type, 0.02))!.innerR).toBeCloseTo(0.02 - wall, 12);
    expect(boreAt(tube(type, 0.02), 'fore')).toBeCloseTo(0.02 - wall, 12);
  });
});
