import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { validateSolid } from '../../../src/services/exports/meshValidate';
import { discSolid } from '../../../src/services/exports/solidMesh';

/**
 * Which way a closed surface FACES.
 *
 * The directed-edge check proves the winding is consistent. It cannot prove the
 * surface faces outward, because flipping every triangle in a closed mesh flips
 * every directed edge too and the counts come out identical. So a solid wound
 * entirely inside out passed every check the validator made, and a slicer reading
 * that file fills the room and leaves the part hollow.
 *
 * Signed volume is the question that separates them, and it only makes sense once
 * the mesh is closed, which is why it is reported last and only when nothing
 * earlier fired.
 */

/** The same geometry with every triangle's winding reversed. */
const flipped = (geo: THREE.BufferGeometry): THREE.BufferGeometry => {
  const out = geo.clone();
  const idx = out.getIndex()!;
  const a = idx.array as ArrayLike<number> & { [i: number]: number };
  for (let i = 0; i + 2 < idx.count; i += 3) {
    const t = a[i + 1]!;
    a[i + 1] = a[i + 2]!;
    a[i + 2] = t;
  }
  idx.needsUpdate = true;
  return out;
};

const kinds = (geo: THREE.BufferGeometry) => validateSolid(geo).map((i) => i.kind);

describe('a closed solid must face outward', () => {
  const tube = () => discSolid(0.024, 0.0225, 0.1)!;

  it('accepts the tube the exporter builds', () => {
    expect(validateSolid(tube())).toEqual([]);
  });

  it('refuses the same tube wound inside out', () => {
    const inside = flipped(tube());
    expect(kinds(inside)).toContain('inside-out');
    expect(validateSolid(inside)).not.toEqual([]);
  });

  it('still calls the flipped mesh consistently wound, which is the point', () => {
    // If the inversion showed up as inconsistent winding, the old check would
    // already have caught it and there would be nothing to fix. It does not.
    expect(kinds(flipped(tube()))).not.toContain('inconsistent-winding');
  });

  it('names the fault once, not on top of another one', () => {
    // An open shell has no meaningful signed volume, so the orientation check
    // stays quiet and the hole is the only thing reported.
    const open = tube();
    const idx = open.getIndex()!;
    // Drop the last triangle: a hole, and no longer a closed surface.
    open.setIndex(Array.from(idx.array as ArrayLike<number>).slice(0, idx.count - 3));
    const found = kinds(open);
    expect(found).toContain('non-manifold-edge');
    expect(found).not.toContain('inside-out');
  });

  it('says nothing about an empty geometry', () => {
    const empty = new THREE.BufferGeometry();
    empty.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    empty.setIndex([]);
    expect(kinds(empty)).not.toContain('inside-out');
  });
});
