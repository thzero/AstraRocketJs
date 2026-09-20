import * as THREE from 'three';

/**
 * Owns the export framing for the 3D image snapshot: the NaN-safe box guard,
 * the corner-by-corner camera fit and the throwaway export camera with its
 * near/far bracket. Pure three.js math, kept out of the component so the
 * framing is provable without a mounted canvas (Rocket3D.test.ts).
 */

/**
 * Is `box` safe to aim a camera at? `!box.isEmpty()` is NOT enough on its own.
 * `Box3.isEmpty()` is `max.x < min.x || max.y < min.y || max.z < min.z`, and
 * every comparison involving NaN is false — so a box poisoned by a NaN
 * dimension cheerfully reports itself NON-empty and walks straight into the
 * fit. One NaN field on one component is all it takes (a nosecone `length` of
 * NaN reaches the lathe profile, the geometry's bounding box, then this union),
 * and the payoff is a NaN camera position, a NaN center, and a blank export
 * with nothing logged. Demand six finite components; the caller then falls back
 * to the live camera, which is precisely the un-fitted export the user got
 * before auto-fit existed.
 */
export function isFittableBox(box: THREE.Box3): boolean {
  return (
    !box.isEmpty() &&
    [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].every((v) => Number.isFinite(v))
  );
}

/** Breathing room around the fitted subject — 6 % keeps the nose tip and the
 *  fin tips off the border without visibly wasting frame. */
const FIT_MARGIN = 1.06;
/** Fallback distance for a degenerate (empty/zero-size) box: any finite,
 *  non-zero number will do — the point is that no NaN/Infinity reaches the
 *  camera, which would blank the export. */
const MIN_FIT_DIST = 1e-3;

/**
 * Reframe a camera so `box` fills the frame, KEEPING the caller's viewing
 * direction — only distance and target move, so a user who rotated to a
 * three-quarter view gets that same view, filled.
 *
 * Extracted as a pure function because the R3F canvas cannot be mounted
 * headlessly here (this @react-three/fiber v8 build does not expose
 * canvas.__r3f, and monkeypatching rAF breaks its mounting), so this is where
 * the export framing is actually proven.
 *
 * @param direction where the camera LOOKS (camera → subject), i.e. exactly
 *                  what `camera.getWorldDirection()` returns.
 * @param aspect    the EXPORT aspect (width/height), not the on-screen one.
 */
export function fitCameraToBox(
  box: THREE.Box3,
  direction: THREE.Vector3,
  fovDeg: number,
  aspect: number,
  margin: number = FIT_MARGIN,
  up: THREE.Vector3 = new THREE.Vector3(0, 1, 0),
): { position: THREE.Vector3; target: THREE.Vector3 } {
  const target = box.getCenter(new THREE.Vector3());
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);

  // Camera-space basis. `back` runs subject → camera, so the returned position
  // is target + back·dist and the view direction survives bit-exactly.
  const back = new THREE.Vector3().copy(direction).negate();
  if (!Number.isFinite(back.lengthSq()) || back.lengthSq() === 0) back.set(0, 0, 1);
  back.normalize();
  const upv = new THREE.Vector3().copy(up);
  if (!Number.isFinite(upv.lengthSq()) || upv.lengthSq() === 0) upv.set(0, 1, 0);
  // Dead overhead (view parallel to `up`): the cross degenerates, and whatever
  // basis we invent here is a GUESS about roll around the view axis. It has to
  // be the same guess three makes, because exportCamera feeds this position to
  // `cam.lookAt(target)` and Matrix4.lookAt does NOT substitute an axis — it
  // nudges its own z (our `back`) by 1e-4 and re-crosses. Substituting (1,0,0)
  // gave a basis rotated 90° from the camera that actually renders, so a
  // straight-down view measured the rocket's LENGTH as frame height and its
  // diameter as frame width — exactly backwards, and the fit was sized to the
  // wrong pair. Mirror three's nudge instead (`=== 0` is three's own test, so
  // the two agree on WHEN to nudge as well as HOW), then derive `right` the
  // normal way. Nudging `back` — not `right` — is what makes this airtight:
  // the returned position lies along the NUDGED axis, so lookAt sees a
  // non-degenerate case, skips its own nudge, and rebuilds this very basis.
  const right = new THREE.Vector3().crossVectors(upv, back);
  if (right.lengthSq() === 0) {
    if (Math.abs(upv.z) === 1) back.x += 1e-4;
    else back.z += 1e-4;
    back.normalize();
    right.crossVectors(upv, back);
  }
  right.normalize();
  const trueUp = new THREE.Vector3().crossVectors(back, right).normalize();

  // Support function of an AABB along an axis: the box's half-extent as seen
  // along that axis, whatever the viewing angle.
  const extent = (a: THREE.Vector3) => Math.abs(half.x * a.x) + Math.abs(half.y * a.y) + Math.abs(half.z * a.z);

  const tanHalfFov = Math.tan((fovDeg * Math.PI) / 360);
  const m = Number.isFinite(margin) && margin > 0 ? margin : 1;
  // Fit CORNER BY CORNER, not extent-plus-extent. A corner sitting at
  // camera-space (u, v, w) — w measured along `back`, i.e. TOWARDS the lens —
  // is in frame when m·|u| <= tan·aspect·(d − w) and m·|v| <= tan·(d − w),
  // so that one corner demands
  //     d >= max( m·|u|/(tan·aspect), m·|v|/tan ) + w
  // and the fit is the max of that over all eight. The horizontal half-angle
  // is the vertical one WIDENED by the aspect ratio, hence the /aspect on the
  // width term: a rocket is long and thin, so it is nearly always width that
  // wins, and using the height term alone is what chops the nose and the fins
  // off a 16:9 export.
  //
  // The previous form — max(widthTerm, heightTerm) + halfD — summed two maxima
  // that are reached at DIFFERENT corners: the widest corner is rarely the
  // nearest one, so it charged the full depth to a corner that does not have
  // it. On a stubby subject the slack swamps the fit: a 0.37 m rocket of
  // maxR 0.05 on a 16:9 panel came out framed SMALLER than with no fit at all
  // (0.83 of frame vs 0.91), and the fit is ON by default, so that was a
  // straight downgrade for every short design. The per-corner max is the exact
  // bound — every corner satisfied, at least one tight against the edge.
  const rel = new THREE.Vector3();
  let raw = 0;
  for (let i = 0; i < 8; i++) {
    // Corners as center ± half, not box.min/max: an EMPTY Box3 carries
    // ±Infinity extremes but reports a (0,0,0) size, so going through `half`
    // keeps this loop finite and lets the degenerate guard below do its job.
    rel.set(i & 1 ? half.x : -half.x, i & 2 ? half.y : -half.y, i & 4 ? half.z : -half.z);
    const u = rel.dot(right),
      v = rel.dot(trueUp),
      w = rel.dot(back);
    raw = Math.max(raw, Math.max((m * Math.abs(u)) / (tanHalfFov * aspect), (m * Math.abs(v)) / tanHalfFov) + w);
  }
  const dist = Number.isFinite(raw) && raw > 0 ? raw : Math.max(extent(back), MIN_FIT_DIST);

  return { position: new THREE.Vector3().copy(target).addScaledVector(back, dist), target };
}

/**
 * A throwaway camera that frames `box` the way `src` is currently looking.
 * Kept out of the snapshot handler so the whole export view — framing AND
 * clipping planes — is provable without a mounted canvas.
 */
export function exportCamera(box: THREE.Box3, src: THREE.PerspectiveCamera, aspect: number): THREE.PerspectiveCamera {
  const { position, target } = fitCameraToBox(
    box,
    src.getWorldDirection(new THREE.Vector3()),
    src.fov,
    aspect,
    FIT_MARGIN,
    src.up,
  );
  const cam = new THREE.PerspectiveCamera(src.fov, aspect);
  cam.up.copy(src.up);
  cam.position.copy(position);
  cam.lookAt(target);
  cam.updateMatrixWorld();
  // Near/far must bracket the subject at its NEW distance: fitting a small
  // rocket pulls the camera well inside the live camera's 0.1 m default near
  // plane, which would export an empty frame. Camera space looks down -Z, so
  // the box's z range there is exactly the depth span to cover.
  const view = box.clone().applyMatrix4(cam.matrixWorldInverse);
  cam.near = Math.max(1e-4, -view.max.z * 0.9);
  cam.far = Math.max(cam.near * 16, -view.min.z * 1.1);
  cam.updateProjectionMatrix();
  return cam;
}
