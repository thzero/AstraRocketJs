import { describe, it, expect } from 'vitest';
import {
  boreAt,
  discDims,
  plateOuter,
  ringBore,
  tubeRadii,
  type Tube,
} from '../../../src/services/design/discGeometry';
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

  it('refuses a wall past the radius instead of reporting a solid rod', () => {
    // `discSolid` takes its no-bore branch on innerR === 0 and lathes a solid
    // cylinder, so a units slip (a 20 mm wall on a 12 mm radius) would print the
    // coupler as a plug with nothing saying so. `solidMesh`'s tube branch
    // refuses the same case, and the disc path has to match it.
    expect(discDims(node({ type: 'tubecoupler', thickness: 0.02, length: 0.05 }), tube, [])).toBeNull();
    expect(discDims(node({ type: 'engineblock', thickness: 0.05 }), tube, [])).toBeNull();
  });

  it('takes a wall exactly equal to the radius as a solid part', () => {
    // A catalog part that states an inner diameter of 0 (a balsa nose block)
    // is solid, and `ThicknessRingComponent.loadFromPreset` gives it a wall of
    // its whole radius; the kernel flies it solid, so it is drawn, cut and
    // printed solid. Only a wall past the radius is a slip.
    const r = plateOuter(node({ type: 'tubecoupler' }), tube);
    const d = discDims(node({ type: 'tubecoupler', thickness: r }), tube, []);
    expect(d).not.toBeNull();
    expect(d!.innerR).toBe(0);
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
 * bore is read. The kernel gives a body tube and a coupler a 2 mm wall and an
 * inner tube 0.5 mm (ComponentFactory, cases "bodytube", "tubecoupler" and
 * "innertube"); reading one type's wall for all three would put an inner
 * tube's bore 1.5 mm off from the one the kernel flies.
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

/**
 * A filled part is solid: `BodyTube.getInnerRadius` returns 0 when `filled`,
 * so there is no bore for a shoulder to plug into.
 */
describe('boreAt on a filled part', () => {
  it('offers no bore, as tubeRadii says', () => {
    const solid = {
      type: 'bodytube',
      id: 'b',
      outerRadius: 0.02,
      thickness: 0.001,
      filled: true,
    } as unknown as ComponentNode;
    expect(tubeRadii(solid)!.innerR).toBe(0);
    expect(boreAt(solid, 'fore')).toBeNull();
    expect(boreAt(solid, 'aft')).toBeNull();
  });
});

/**
 * `CenteringRing.getInnerRadius` compares the ring's span with each inner
 * tube's as placed (`toRelative`, no clamp): it skips a tube when
 * `pos2 < 0 || pos1 > sibling.getLength()`, with `pos1`/`pos2` the ring's fore
 * and aft faces measured from the tube's front.
 */
describe('ringBore past the parent end', () => {
  const parent = (ringAt: number, mountAt: number) =>
    ({
      type: 'bodytube',
      id: 'b',
      length: 0.1,
      outerRadius: 0.02,
      children: [
        { type: 'centeringring', id: 'r', length: 0.002, position: { method: 'top', offset: ringAt } },
        { type: 'innertube', id: 'i', length: 0.05, outerRadius: 0.009, position: { method: 'top', offset: mountAt } },
      ],
    }) as unknown as ComponentNode;

  it('misses a mount wholly aft of the ring, though both overhang the tube', () => {
    // Ring 105-107 mm, mount 120-170 mm: pos2 = 0.107 - 0.12 < 0.
    const p = parent(0.105, 0.12);
    expect(ringBore(p.children![0]!, p, 0.019, 0)).toBe(0);
  });

  it('takes a mount that overlaps it past the tube end', () => {
    // Ring 105-107 mm, mount 90-140 mm.
    const p = parent(0.105, 0.09);
    expect(ringBore(p.children![0]!, p, 0.019, 0)).toBe(0.009);
  });
});

describe('boreAt on a nose cone', () => {
  // NoseCone.getBaseRadius: `isFlipped ? getForeRadius() : getAftRadius()`. The
  // base is the open end; the tip, radius 0, offers nothing.
  const cone = (flipped: boolean) =>
    ({ type: 'nosecone', id: 'n', aftRadius: 0.025, thickness: 0.002, flipped }) as unknown as ComponentNode;

  it('is open at the base, which a flipped cone has at its fore end', () => {
    expect(boreAt(cone(false), 'aft')).toBeCloseTo(0.023, 12);
    expect(boreAt(cone(false), 'fore')).toBeNull();
    expect(boreAt(cone(true), 'fore')).toBeCloseTo(0.023, 12);
    expect(boreAt(cone(true), 'aft')).toBeNull();
  });
});
