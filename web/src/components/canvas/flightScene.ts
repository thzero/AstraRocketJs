import * as THREE from 'three';
import type { FlightResult } from '../../engine/openRocketEngine';

/**
 * The trajectory geometry behind FlightPath3D — pulled out of the component's
 * useMemo so it can be tested without a WebGL context.
 *
 * Everything here is pure: samples in, scene points / vertex colours / callout
 * anchors out. The component keeps the camera, the transport and the HUD.
 */

/** Boost / coast / descent arc colours, from Settings. */
export type PhaseColors = { boost: string; coast: string; descent: string };

export interface FlightScene {
  /** Per-point RGB for the arc's vertex colours. */
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
  // in metres and has no business being read as seconds. A result with no
  // APOGEE event got apT ~ 300 for a 300 m flight, so `r.t <= apT` was true for
  // the whole trajectory and the descent colour never appeared.
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
    callouts: cos,
  };
}
