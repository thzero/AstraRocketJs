import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { exportCamera, fitCameraToBox, isFittableBox, piecesBounds } from '../../../src/components/canvas/Rocket3D';

/**
 * The export framing, which was extracted to be provable and never proved.
 *
 * `piecesBounds`, `isFittableBox`, `fitCameraToBox` and `exportCamera` all
 * carry doc comments saying they live outside the component precisely so the
 * numbers can be checked without mounting an R3F canvas ("this is where the
 * export framing is actually proven", "Pure so the numbers are provable").
 * There was no `Rocket3D.test.*` at all, and no e2e asserts the framing - so
 * the corner-by-corner fit, the degenerate-`up` nudge and the NaN-box guard
 * were subtle, regression-prone geometry with a stated test rationale and
 * nothing holding them.
 */

const boxOf = (min: [number, number, number], max: [number, number, number]) =>
  new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));

/** A piece-like with a geometry, as `piecesBounds` consumes. */
const piece = (min: [number, number, number], max: [number, number, number]) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([min[0], min[1], min[2], max[0], max[1], max[2]], 3));
  return { geometry: g } as unknown as Parameters<typeof piecesBounds>[0][number];
};

describe('isFittableBox', () => {
  it('accepts a real box', () => {
    expect(isFittableBox(boxOf([-1, -1, -1], [1, 1, 1]))).toBe(true);
  });

  it('rejects an empty box', () => {
    expect(isFittableBox(new THREE.Box3())).toBe(false);
  });

  it('rejects a box poisoned with NaN', () => {
    // The guard exists because a single non-finite vertex anywhere in the
    // model makes the whole fit NaN, and the export then renders nothing.
    const b = boxOf([0, 0, 0], [1, 1, 1]);
    b.max.y = NaN;
    expect(isFittableBox(b)).toBe(false);
  });

  it('rejects a box poisoned with Infinity', () => {
    const b = boxOf([0, 0, 0], [1, 1, 1]);
    b.min.x = -Infinity;
    expect(isFittableBox(b)).toBe(false);
  });
});

describe('piecesBounds', () => {
  it('unions every piece', () => {
    const box = piecesBounds([piece([0, 0, 0], [1, 1, 1]), piece([-2, 0, 0], [0, 3, 0])]);
    expect(box.min.x).toBeCloseTo(-2, 6);
    expect(box.max.y).toBeCloseTo(3, 6);
  });

  it('is empty for no pieces, which isFittableBox then rejects', () => {
    const box = piecesBounds([]);
    expect(isFittableBox(box)).toBe(false);
  });
});

describe('fitCameraToBox', () => {
  const dir = new THREE.Vector3(0, 0, -1); // looking down -Z

  it('keeps the subject centered and the view direction exact', () => {
    const box = boxOf([-1, -1, -1], [1, 1, 1]);
    const { position, target } = fitCameraToBox(box, dir, 50, 16 / 9);
    expect(target.toArray()).toEqual([0, 0, 0]);
    // `back` runs subject -> camera, so the camera sits on +Z looking back.
    expect(position.x).toBeCloseTo(0, 9);
    expect(position.y).toBeCloseTo(0, 9);
    expect(position.z).toBeGreaterThan(0);
  });

  it('actually fits: every corner lands inside the frustum', () => {
    // The real contract. A long thin rocket viewed on a wide aspect is the
    // case a naive "distance from bounding sphere" fit gets wrong.
    const box = boxOf([-0.02, -0.02, -0.5], [0.02, 0.02, 0.5]);
    const fov = 50;
    const aspect = 16 / 9;
    const { position, target } = fitCameraToBox(box, new THREE.Vector3(0, 0, -1), fov, aspect);

    const cam = new THREE.PerspectiveCamera(fov, aspect, 0.001, 1000);
    cam.position.copy(position);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const ndc = new THREE.Vector3(x, y, z).applyMatrix4(vp);
          expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('pulls back further for a narrower frame', () => {
    const box = boxOf([-1, -1, -1], [1, 1, 1]);
    const wide = fitCameraToBox(box, dir, 50, 21 / 9).position.z;
    const narrow = fitCameraToBox(box, dir, 50, 1 / 2).position.z;
    expect(narrow).toBeGreaterThan(wide);
  });

  it('survives a view straight down the up axis', () => {
    // Dead overhead degenerates the cross product; the nudge exists so the
    // result is finite and matches what three's own lookAt would pick.
    const box = boxOf([-1, -1, -1], [1, 1, 1]);
    const { position } = fitCameraToBox(box, new THREE.Vector3(0, -1, 0), 50, 16 / 9);
    expect(position.toArray().every(Number.isFinite)).toBe(true);
    expect(position.length()).toBeGreaterThan(0);
  });

  it('survives a zero-length direction', () => {
    const box = boxOf([-1, -1, -1], [1, 1, 1]);
    const { position } = fitCameraToBox(box, new THREE.Vector3(0, 0, 0), 50, 16 / 9);
    expect(position.toArray().every(Number.isFinite)).toBe(true);
  });

  it('gives a degenerate (zero-size) box a usable distance', () => {
    const { position } = fitCameraToBox(boxOf([0, 0, 0], [0, 0, 0]), dir, 50, 16 / 9);
    expect(position.toArray().every(Number.isFinite)).toBe(true);
    expect(position.length()).toBeGreaterThan(0);
  });
});

describe('exportCamera', () => {
  it('brackets the subject with its near and far planes', () => {
    // Fitting a small rocket pulls the camera well inside the live camera's
    // 0.1 m default near plane, which would export an empty frame.
    const box = boxOf([-0.02, -0.02, -0.05], [0.02, 0.02, 0.05]);
    const src = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    src.position.set(0, 0, 1);
    src.lookAt(0, 0, 0);
    src.updateMatrixWorld();

    const cam = exportCamera(box, src, 16 / 9);
    cam.updateProjectionMatrix();

    const view = box.clone().applyMatrix4(cam.matrixWorldInverse);
    // Camera space looks down -Z: the nearest corner is at -view.max.z.
    expect(cam.near).toBeGreaterThan(0);
    expect(cam.near).toBeLessThanOrEqual(-view.max.z + 1e-9);
    expect(cam.far).toBeGreaterThanOrEqual(-view.min.z - 1e-9);
  });

  it('keeps the source camera untouched', () => {
    const src = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    src.position.set(0, 0, 1);
    src.updateMatrixWorld();
    const before = src.position.clone();
    exportCamera(boxOf([-1, -1, -1], [1, 1, 1]), src, 2);
    expect(src.position.equals(before)).toBe(true);
  });
});
