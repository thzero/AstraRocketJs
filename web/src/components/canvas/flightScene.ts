import * as THREE from 'three';
import type { FlightResult, RocketTree } from '../../engine/openRocketEngine';
import { KERNEL_DEFAULTS } from '../../tree/kernelDefaults';
import { findRecoveryDevices } from '../../services/design/treeEdit';
import { num } from '../../tree/nodeProps';
import { colorForType, type PartPalette } from '../../services/design/partColors';
import { colorOf } from '../../tree/schematicGeometry';

/**
 * The trajectory geometry behind FlightPath3D, kept out of the component so
 * it can be tested without a WebGL context.
 *
 * Everything here is pure: samples in, scene points / vertex colors / callout
 * anchors out. The component keeps the camera, the transport and the HUD.
 */

/**
 * Meters east, up and north of the pad as a three.js position. The kernel's Px
 * is east and Py north (FlightDataType TYPE_POSITION_X / TYPE_POSITION_Y, and
 * the geodetic step adds Y to latitude). three.js is right-handed with +y up,
 * so with east on +x, north is -z: north on +z draws the whole scene as its
 * mirror image, a northeast drift curling the wrong way.
 */
export function sceneFromEnu(east: number, up: number, north: number): THREE.Vector3 {
  return new THREE.Vector3(east, up, -north);
}

/**
 * The motor burns in one branch's events, as [start, end] times.
 *
 * Each BURNOUT closes the burn its latest IGNITION opened. A burnout with no
 * open burn extends the previous window (a cluster's motors burning out at
 * different times), or, before any ignition, opens at 0. A staged flight's
 * main branch carries the booster's burnout first and the sustainer's later,
 * so reading the first BURNOUT alone would end the boost at staging.
 */
export function boostWindows(events: readonly { type: string; time: number }[]): [number, number][] {
  const out: [number, number][] = [];
  let start: number | null = null;
  for (const e of [...events].sort((a, b) => a.time - b.time)) {
    if (e.type === 'IGNITION') {
      start ??= e.time;
    } else if (e.type === 'BURNOUT') {
      if (start != null) out.push([start, e.time]);
      else if (out.length) out[out.length - 1]![1] = Math.max(out[out.length - 1]![1], e.time);
      else out.push([0, e.time]);
      start = null;
    }
  }
  return out;
}

/** Whether `t` falls inside any burn window. */
export const isBoosting = (t: number, windows: readonly [number, number][]): boolean =>
  windows.some(([a, b]) => t >= a && t < b);

/** Boost / coast / descent arc colors, from Settings. */
export type PhaseColors = { boost: string; coast: string; descent: string };

export interface FlightScene {
  /** Per-point RGB for the arc's vertex colors. */
  colors: [number, number, number][];
  /** The arc itself, scaled so peak altitude is 24 scene units. */
  scenePts: THREE.Vector3[];
  /** Index of the highest sample: where the apogee marker sits. */
  apogeeIdx: number;
  deployT: number;
  /**
   * The motor burns as [start, end] times: an ignition to the burnout that
   * ends it. A staged flight has one per stage, with the coast between them
   * outside every window, so the boost color and the flame follow each burn.
   */
  boostWindows: [number, number][];
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
  const time = result.series.time ?? [];
  const alt = result.series.altitude ?? [];
  const vel = result.series.velocity ?? [];
  const px = result.series.Px ?? [];
  const py = result.series.Py ?? [];
  const rows: { t: number; a: number; v: number; east: number; north: number }[] = [];
  for (let i = 0; i < time.length; i++) {
    if (!Number.isFinite(time[i]) || !Number.isFinite(alt[i])) continue;
    rows.push({
      t: time[i]!,
      a: alt[i]!,
      v: Number.isFinite(vel[i]) ? vel[i]! : 0,
      east: Number(px[i]) || 0,
      north: Number(py[i]) || 0,
    });
  }
  // Loop, don't spread: a long/fine-timestep flight has tens of thousands of
  // samples, and Math.max(...bigArray) overflows the call-argument stack.
  let maxA = 1;
  for (const r of rows) if (r.a > maxA) maxA = r.a;
  const s = 24 / maxA;
  const evT = (type: string) => result.events.find((e) => e.type === type)?.time;
  const burns = boostWindows(result.events);
  const lastBurnout = burns[burns.length - 1]?.[1];
  // Fall back to the last sample time, not `maxA`, which is the peak altitude
  // in meters: read as seconds it would make `r.t <= apT` true for the whole
  // trajectory, and the descent color would never appear.
  const lastT = rows[rows.length - 1]?.t ?? 0;
  const apT = evT('APOGEE') ?? result.summary.timeToApogee ?? lastT;
  const dpT = evT('RECOVERY_DEVICE_DEPLOYMENT') ?? evT('EJECTION_CHARGE') ?? apT;
  const sp = rows.map((r) => sceneFromEnu(r.east * s, r.a * s, r.north * s));
  const cols = rows.map((r): [number, number, number] => {
    const c = new THREE.Color(isBoosting(r.t, burns) ? phase.boost : r.t <= apT ? phase.coast : phase.descent);
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
    ['BURNOUT', lastBurnout],
    ['APOGEE', apT],
    ['RECOVERY_DEVICE_DEPLOYMENT', evT('RECOVERY_DEVICE_DEPLOYMENT') ?? evT('EJECTION_CHARGE')],
    ['GROUND_HIT', evT('GROUND_HIT') ?? rows[rows.length - 1]?.t],
  ];
  const cos: { type: string; pos: THREE.Vector3; time: number }[] = [];
  for (const [type, tt] of wanted) {
    if (tt == null) continue;
    // `sp` is empty when every sample failed the finiteness filter above (a
    // kernel failure that still returns a result object). Checked rather than
    // silenced with a `!`: the second callout would throw on
    // `undefined.distanceTo` inside the memo, before the component's
    // `scenePts.length < 2` guard, taking the app down instead of showing
    // "no path".
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
    boostWindows: burns,
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
 * `progress` is a fraction of flight time, not of sample count: the sim packs
 * most of its samples into the fast boost/coast, so index-based playback
 * would crawl there. This is the largest index whose time is at or before
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
 * every animation frame.
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

export type Recovery =
  | { kind: 'parachute'; diameter: number; color: string }
  | { kind: 'streamer'; length: number; width: number; color: string }
  | null;
/**
 * The recovery device the 3D flight shows: the first parachute or streamer in
 * tree order, sized as the kernel flies it when it states no size.
 */
export function findRecovery(tree: RocketTree, palette: PartPalette): Recovery {
  const n = findRecoveryDevices(tree)[0];
  if (!n) return null;
  const color = colorOf(n, colorForType(n.type, palette));
  return n.type === 'parachute'
    ? { kind: 'parachute', diameter: num(n, 'diameter', KERNEL_DEFAULTS.parachute.diameter), color }
    : {
        kind: 'streamer',
        length: num(n, 'stripLength', KERNEL_DEFAULTS.streamer.stripLength),
        width: num(n, 'stripWidth', KERNEL_DEFAULTS.streamer.stripWidth),
        color,
      };
}
