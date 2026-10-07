import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { KERNEL_DEFAULTS } from '../../src/tree/kernelDefaults';
import { COMPONENT_DEFAULTS } from '../../src/services/design/componentDefaults';
import { discSolidForNode, solidForNode } from '../../src/services/exports/solidMesh';
import { discDims } from '../../src/services/design/discGeometry';
import type { ComponentNode } from '../../src/engine/openRocketEngine';

/**
 * What the app substitutes for an ABSENT dimension must be what the kernel does.
 *
 * `kernelDefaults.kernel.test.ts` proves the table agrees with
 * `ComponentFactory`. Nothing proved the CONSUMERS read the table, and three of
 * them did not: the printable-solid builder used a flat 12 mm outer radius for
 * every tube, where the kernel builds an inner tube at 9.5 mm and a launch lug
 * at 2.2 mm, and a 0.5 mm wall for a body tube the kernel builds at 0.3 mm. The
 * disc sketch used a bare 3 mm coupler length against the kernel's 50 mm, and
 * the report used an 80 mm tube fin length against the kernel's 100 mm.
 *
 * The consequence is specific to these consumers: they produce a PART. A launch
 * lug exported at 5.5 times its flown radius does not fit the rocket that was
 * simulated, and nothing in the file says the two disagree.
 *
 * Measured off the geometry rather than asserted against a literal, so the test
 * fails when a consumer stops reading the table rather than when someone edits a
 * number in two places at once.
 */

/** The radial extent of a lathed solid: its outer radius. */
const outerRadiusOf = (geo: THREE.BufferGeometry): number => {
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  return Math.max(Math.abs(b.max.y), Math.abs(b.min.y), Math.abs(b.max.z), Math.abs(b.min.z));
};

/** Its axial extent: its length. */
const lengthOf = (geo: THREE.BufferGeometry): number => {
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  return b.max.x - b.min.x;
};

/** The bore: the smallest radius any vertex sits at. */
const innerRadiusOf = (geo: THREE.BufferGeometry): number => {
  const pos = geo.getAttribute('position');
  let min = Infinity;
  for (let i = 0; i < pos.count; i++) {
    min = Math.min(min, Math.hypot(pos.getY(i), pos.getZ(i)));
  }
  return min;
};

describe('the printable solid uses the kernel default for an absent radius', () => {
  /** A tube with its length stated and NO outerRadius or thickness. */
  const tube = (type: string): ComponentNode => ({ type, id: type, length: 0.05 }) as unknown as ComponentNode;

  it.each([
    ['bodytube', KERNEL_DEFAULTS.bodytube.outerRadius],
    ['innertube', KERNEL_DEFAULTS.innertube.outerRadius],
    ['launchlug', KERNEL_DEFAULTS.launchlug.outerRadius],
  ] as const)('%s lathes at the radius the kernel builds', (type, expected) => {
    const geo = solidForNode(tube(type));
    expect(geo).not.toBeNull();
    // Lathed in SEGMENTS facets, so the measured radius is the inscribed one.
    expect(outerRadiusOf(geo!)).toBeGreaterThan(expected * 0.99);
    expect(outerRadiusOf(geo!)).toBeLessThanOrEqual(expected * 1.0001);
  });

  it('separates the three, which one flat literal could not', () => {
    // The point of the finding: a single 12 mm substitute made the lug 5.5x too
    // big and the inner tube 1.26x. If they ever collapse to one number again,
    // this fails whatever that number is.
    const r = (t: string) => outerRadiusOf(solidForNode(tube(t))!);
    expect(r('innertube')).toBeLessThan(r('bodytube'));
    expect(r('launchlug')).toBeLessThan(r('innertube'));
  });

  it('uses the kernel wall for a body tube, not the inner tube one', () => {
    // 0.3 mm against 0.5 mm: on a 12 mm tube that is the difference between a
    // 0.6 mm and a 1.0 mm wall on the printed part.
    const geo = solidForNode(tube('bodytube'))!;
    const wall = outerRadiusOf(geo) - innerRadiusOf(geo);
    expect(wall).toBeCloseTo(KERNEL_DEFAULTS.bodytube.thickness, 5);
    expect(wall).not.toBeCloseTo(KERNEL_DEFAULTS.innertube.thickness, 5);
  });

  it('uses the kernel wall for an inner tube', () => {
    const geo = solidForNode(tube('innertube'))!;
    expect(outerRadiusOf(geo) - innerRadiusOf(geo)).toBeCloseTo(KERNEL_DEFAULTS.innertube.thickness, 5);
  });

  it('skips a type the kernel states no radius for rather than inventing one', () => {
    // A tube fin set with no radius and no parent: the kernel auto-sizes it from
    // the body, so the size is unknowable here. Skipped, which is what the
    // surrounding code already documents.
    expect(solidForNode(tube('tubefinset'), null)).toBeNull();
  });
});

describe('the disc sketch uses the kernel length for an absent coupler length', () => {
  const coupler = (type: string): ComponentNode =>
    ({ type, id: type, outerRadius: 0.012, thickness: 0.0005 }) as unknown as ComponentNode;

  it('sizes a tube coupler at the length the kernel builds', () => {
    const d = discDims(coupler('tubecoupler'), null, []);
    expect(d!.length).toBe(KERNEL_DEFAULTS.tubecoupler.length);
    // The literal it replaced, named so the regression is unmistakable: 3 mm
    // against 50 mm is a sixteenth of the part.
    expect(d!.length).not.toBe(0.003);
  });

  it('sizes an engine block at its own kernel length, which is different', () => {
    const d = discDims(coupler('engineblock'), null, []);
    expect(d!.length).toBe(KERNEL_DEFAULTS.engineblock.length);
    expect(d!.length).not.toBe(KERNEL_DEFAULTS.tubecoupler.length);
  });

  it('exports that coupler as a solid of the same length', () => {
    // The sketch, the cut sheet and the 3D model all read `discDims`, so they
    // agreed on the wrong part together. One number, one length.
    const d = discDims(coupler('tubecoupler'), null, [])!;
    const geo = discSolidForNode(d.outerR, d.innerR, d.length);
    expect(lengthOf(geo!)).toBeCloseTo(KERNEL_DEFAULTS.tubecoupler.length, 6);
  });
});

describe('the table is the one home, so the app-side table defers to it', () => {
  it('carries the coupler length the kernel builds', () => {
    expect(COMPONENT_DEFAULTS.tubecoupler.length).toBe(KERNEL_DEFAULTS.tubecoupler.length);
  });
});
