import * as THREE from 'three';
import type { FlightResult } from '../../engine/openRocketEngine';

/**
 * The trajectory geometry behind FlightPath3D — pulled out of the component's
 * useMemo so it can be tested without a WebGL context.
 *
 * Everything here is pure: samples in, scene points / vertex colors / callout
 * anchors out. The component keeps the camera, the transport and the HUD.
 */

/** Boost / coast / descent arc colors, from Settings. */
export type PhaseColors = { boost: string; coast: string; descent: string };

export interface FlightScene {
  /** Per-point RGB for the arc's vertex colors. */
  colors: [number, number, number][];
  /** The arc itself, scaled so peak altitude is 24 scene units. */
  scenePts: THREE.Vector3[];
  /** Index of the highest sample — where the apogee marker sits. */
  apogeeIdx: number;
  deployT: number;
  burnoutT: number;
  times: number[];
  alts: number[];
  vels: number[];
  callouts: { type: string; pos: THREE.Vector3; time: number }[];
  /**
   * Scene units per meter, which is the whole scale of the drawing.
   *
   * Peak altitude is pinned to 24 units, so this varies with the flight. It is
   * reported rather than recomputed by anything that needs to put a real-world
   * measurement into the scene - the ground map lays tiles out in meters and
   * has to agree with the arc exactly.
   */
  unitsPerMeter: number;
}

export function buildFlightScene(result: FlightResult, phase: PhaseColors): FlightScene {
  const time = (result.series.time ?? []) as number[];
  const alt = (result.series.altitude ?? []) as number[];
  const vel = (result.series.velocity ?? []) as number[];
  const px = (result.series.Px ?? []) as (number | null)[];
  const py = (result.series.Py ?? []) as (number | null)[];
  const rows: { t: number; a: number; v: number; x: number; z: number }[] = [];
  for (let i = 0; i < time.length; i++) {
    if (!Number.isFinite(time[i]) || !Number.isFinite(alt[i])) continue;
    rows.push({
      t: time[i]!,
      a: alt[i]!,
      v: Number.isFinite(vel[i]) ? vel[i]! : 0,
      x: Number(px[i]) || 0,
      z: Number(py[i]) || 0,
    });
  }
  // Loop, don't spread: a long/fine-timestep flight has tens of thousands of
  // samples, and Math.max(...bigArray) overflows the call-argument stack.
  let maxA = 1;
  for (const r of rows) if (r.a > maxA) maxA = r.a;
  const s = 24 / maxA;
  const evT = (type: string) => result.events.find((e) => e.type === type)?.time;
  const bt = evT('BURNOUT') ?? 0;
  // Fall back to the last sample TIME, not `maxA` — which is the peak ALTITUDE
  // in meters and has no business being read as seconds. A result with no
  // APOGEE event got apT ~ 300 for a 300 m flight, so `r.t <= apT` was true for
  // the whole trajectory and the descent color never appeared.
  const lastT = rows[rows.length - 1]?.t ?? 0;
  const apT = evT('APOGEE') ?? result.summary.timeToApogee ?? lastT;
  const dpT = evT('RECOVERY_DEVICE_DEPLOYMENT') ?? evT('EJECTION_CHARGE') ?? apT;
  const sp = rows.map((r) => new THREE.Vector3(r.x * s, r.a * s, r.z * s));
  const cols = rows.map((r): [number, number, number] => {
    const c = new THREE.Color(r.t < bt ? phase.boost : r.t <= apT ? phase.coast : phase.descent);
    return [c.r, c.g, c.b];
  });
  let ai = 0;
  rows.forEach((r, i) => {
    if (r.a > rows[ai]!.a) ai = i;
  });
  const idxAt = (tt: number) => {
    let bi = 0,
      bd = Infinity;
    rows.forEach((r, i) => {
      const d = Math.abs(r.t - tt);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    return bi;
  };
  // Dedup callouts by proximity in time; keep the most significant.
  const wanted: [string, number | undefined][] = [
    ['BURNOUT', evT('BURNOUT')],
    ['APOGEE', apT],
    ['RECOVERY_DEVICE_DEPLOYMENT', evT('RECOVERY_DEVICE_DEPLOYMENT') ?? evT('EJECTION_CHARGE')],
    ['GROUND_HIT', evT('GROUND_HIT') ?? rows[rows.length - 1]?.t],
  ];
  const cos: { type: string; pos: THREE.Vector3; time: number }[] = [];
  for (const [type, tt] of wanted) {
    if (tt == null) continue;
    // `sp` is empty when every sample failed the finiteness filter above (a
    // kernel failure that still returns a result object). A `!` used to silence
    // that, so the second callout threw on `undefined.distanceTo` — inside the
    // memo, i.e. before the component's `scenePts.length < 2` empty-state
    // guard, taking the whole app down instead of showing "no path".
    const pos = sp[idxAt(tt)];
    if (!pos) continue;
    if (cos.some((c) => c.pos.distanceTo(pos) < 1.5)) continue; // skip coincident label
    cos.push({ type, pos, time: tt });
  }
  return {
    colors: cols,
    scenePts: sp,
    apogeeIdx: ai,
    deployT: dpT,
    burnoutT: bt,
    times: rows.map((r) => r.t),
    alts: rows.map((r) => r.a),
    vels: rows.map((r) => r.v),
    unitsPerMeter: s,
    callouts: cos,
  };
}

/**
 * The sample index a playback fraction lands on.
 *
 * `progress` is a fraction of flight TIME, not of sample count: the sim packs
 * most of its samples into the fast boost/coast, so index-based playback
 * crawled. This is the largest index whose time is at or before
 * `progress * totalT` (index 0 when none is), found by binary search because
 * the frame loop asks every frame.
 */
export function indexForProgress(times: readonly number[], progress: number): number {
  const n = times.length;
  if (n === 0) return 0;
  const totalT = times[n - 1] || 1;
  const target = progress * totalT;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid]! <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Where the flying model sits and points for one sample, written in place. */
export interface ModelPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** World point of the nose tip: where a recovery device hangs from. */
  nose: THREE.Vector3;
}

export const newModelPose = (): ModelPose => ({
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  nose: new THREE.Vector3(),
});

const UP = new THREE.Vector3(0, 1, 0);
const NOSE_AXIS = new THREE.Vector3(-1, 0, 0);
const tangent = new THREE.Vector3();

/**
 * Pose the model at sample `idx`: nose (local -X) along the path tangent, or
 * hanging nose-up once the chute is out. The model is centered on the
 * trajectory point so it straddles the path (its nose does not shoot past the
 * apogee marker), but lifted near the ground so it sits on the pad at launch
 * instead of sinking half-under it.
 *
 * Writes into `out` rather than allocating: the playback loop calls this on
 * every animation frame, and the render-body version of this math allocated a
 * Vector3, a Quaternion and two clones per frame.
 */
export function modelPoseAt(
  scenePts: readonly THREE.Vector3[],
  idx: number,
  descending: boolean,
  modelLen: number,
  out: ModelPose,
): ModelPose {
  const n = scenePts.length;
  const at = scenePts[Math.min(n - 1, Math.max(0, idx))];
  if (!at) {
    out.position.set(0, 0, 0);
    out.quaternion.identity();
    out.nose.set(-modelLen / 2, 0, 0);
    return out;
  }
  tangent.subVectors(scenePts[Math.min(n - 1, idx + 1)]!, scenePts[Math.max(0, idx - 1)]!);
  if (tangent.lengthSq() < 1e-8) tangent.set(0, 1, 0);
  else tangent.normalize();
  const dir = descending ? UP : tangent;
  out.quaternion.setFromUnitVectors(NOSE_AXIS, dir);
  out.position.copy(at);
  out.position.y += Math.max(0, (modelLen / 2) * Math.abs(dir.y) - at.y);
  out.nose.copy(out.position).addScaledVector(dir, modelLen / 2);
  return out;
}
