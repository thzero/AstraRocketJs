import type { GroundPoint } from '../flight/groundTrack';

/**
 * Where a rocket coming down under its recovery lands, estimated from typed
 * descent rates and a wind profile. This is the Tools tab's quick estimate, for
 * a flight that has not been designed or simulated here; it is labeled an
 * estimate wherever it is shown. A designed rocket's landing comes from the
 * engine instead.
 *
 * The model: the rocket starts above the pad at apogee and falls straight down
 * at the descent rate of whatever is open (the drogue, or the only chute, then
 * the main below its deploy height), drifting with the wind at each height. It
 * stops where it meets the ground beneath it. The flight up is not modeled: on
 * a near-vertical boost the drift under canopy is most of the distance.
 */

/** One wind level: meters above sea level, m/s, and where it blows FROM in compass degrees. */
export interface WindLayer {
  altitudeM: number;
  speed: number;
  fromDeg: number;
}

/** The recovery, as rates and heights; heights are above the pad, as an altimeter reads them. */
export interface DescentPlan {
  apogeeAglM: number;
  /** The drogue's rate, or the only parachute's. */
  firstRateMs: number;
  /** A main, opening at `mainAglM` above the pad. Absent for single deployment. */
  main?: { rateMs: number; aglM: number };
}

export interface DriftInput {
  latitudeDeg: number;
  longitudeDeg: number;
  /** The pad, meters above sea level. */
  padElevationM: number;
  plan: DescentPlan;
  wind: readonly WindLayer[];
  /** Ground height (m above sea level) under a point; absent is flat ground at the pad's height. */
  groundAt?: (latitudeDeg: number, longitudeDeg: number) => number;
  /** Scales every wind speed. */
  speedFactor?: number;
  /** Turns every wind direction, degrees clockwise. */
  directionOffsetDeg?: number;
  /** Scales every descent rate. */
  rateFactor?: number;
}

export interface DriftResult {
  /** The ground track of the descent, meters east and north of the pad. */
  path: GroundPoint[];
  landing: GroundPoint;
  landingLatDeg: number;
  landingLonDeg: number;
  /** Ground height where it landed, meters above sea level. */
  groundElevationM: number;
  /** Seconds from apogee to the ground. */
  timeS: number;
  distanceM: number;
  /** Compass degrees from the pad to the landing. */
  bearingDeg: number;
}

/** Height of one integration step, meters. */
export const STEP_M = 10;

/** Mean Earth radius (m), for the small-offset conversion between meters and degrees. */
const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;

/** A point `east`, `north` meters from a site, as latitude and longitude. */
export function offsetToLatLon(latDeg: number, lonDeg: number, p: GroundPoint): { lat: number; lon: number } {
  return {
    lat: latDeg + p.north / (EARTH_RADIUS_M * DEG),
    lon: lonDeg + p.east / (EARTH_RADIUS_M * DEG * Math.cos(latDeg * DEG)),
  };
}

/**
 * The air's velocity at an altitude (m above sea level), east and north in m/s:
 * the direction it moves TOWARD, opposite to where the wind blows from.
 * Interpolated linearly in its components, so a backing or veering wind turns
 * through the short way without the angle wrapping; held at the end values
 * outside the profile.
 */
export function airVelocity(wind: readonly WindLayer[], altitudeM: number, speedFactor = 1, turnDeg = 0) {
  if (wind.length === 0) return { east: 0, north: 0 };
  const comp = (l: WindLayer) => {
    const to = (l.fromDeg + 180 + turnDeg) * DEG;
    return { east: l.speed * speedFactor * Math.sin(to), north: l.speed * speedFactor * Math.cos(to) };
  };
  if (altitudeM <= wind[0]!.altitudeM) return comp(wind[0]!);
  const last = wind[wind.length - 1]!;
  if (altitudeM >= last.altitudeM) return comp(last);
  let i = 0;
  while (wind[i + 1]!.altitudeM < altitudeM) i++;
  const a = comp(wind[i]!);
  const b = comp(wind[i + 1]!);
  const f = (altitudeM - wind[i]!.altitudeM) / (wind[i + 1]!.altitudeM - wind[i]!.altitudeM);
  return { east: a.east + (b.east - a.east) * f, north: a.north + (b.north - a.north) * f };
}

/** The descent from apogee to the ground. `wind` must be sorted by altitude. */
export function descentDrift(input: DriftInput): DriftResult {
  const { plan, padElevationM: pad } = input;
  const rateFactor = input.rateFactor ?? 1;
  const ground = (p: GroundPoint) => {
    if (!input.groundAt) return pad;
    const { lat, lon } = offsetToLatLon(input.latitudeDeg, input.longitudeDeg, p);
    return input.groundAt(lat, lon);
  };

  let pos: GroundPoint = { east: 0, north: 0 };
  let msl = pad + plan.apogeeAglM;
  let t = 0;
  const path: GroundPoint[] = [pos];
  let floor = ground(pos);
  // A cap on steps, so a ground surface that keeps rising under the drift
  // cannot hold the loop open: no real descent passes 100,000 steps.
  for (let n = 0; msl > floor && n < 100_000; n++) {
    const aboveFloor = msl - floor;
    const step = Math.min(STEP_M, aboveFloor);
    const aboveMain = plan.main ? msl - pad > plan.main.aglM : true;
    const rate = (aboveMain ? plan.firstRateMs : plan.main!.rateMs) * rateFactor;
    const dt = step / rate;
    const air = airVelocity(input.wind, msl - step / 2, input.speedFactor ?? 1, input.directionOffsetDeg ?? 0);
    pos = { east: pos.east + air.east * dt, north: pos.north + air.north * dt };
    msl -= step;
    t += dt;
    path.push(pos);
    floor = ground(pos);
  }

  const { lat, lon } = offsetToLatLon(input.latitudeDeg, input.longitudeDeg, pos);
  return {
    path,
    landing: pos,
    landingLatDeg: lat,
    landingLonDeg: lon,
    groundElevationM: floor,
    timeS: t,
    distanceM: Math.hypot(pos.east, pos.north),
    bearingDeg: (((Math.atan2(pos.east, pos.north) / DEG) % 360) + 360) % 360,
  };
}
