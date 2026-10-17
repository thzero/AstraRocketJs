import type { GroundPoint } from '../flight/groundTrack';
import { degToRad, radToDeg } from '../../prefs/units';

/** The kernel's Earth radius (the WorldCoordinate constant), meters. */
export const KERNEL_EARTH_RADIUS_M = 6371000;

/**
 * A point `east`, `north` meters from a site, as latitude and longitude: a port
 * of the kernel's default SPHERICAL GeodeticComputationStrategy.addCoordinate,
 * the great-circle move along the bearing of the offset.
 *
 * Only for a point the kernel did not place. A simulated flight records its own
 * latitude and longitude (φ, λ) at every step with the Earth model the
 * simulation chose, and a view of that flight reads those (see
 * groundTrack.landingLatLon) rather than projecting the offset again.
 *
 * The result is a WorldCoordinate as the kernel builds one: latitude clamped to
 * [-90, 90] and longitude reduced to [-180, 180], so a move across the date
 * line comes out on the far side rather than past 180.
 */
export function offsetToLatLon(latDeg: number, lonDeg: number, p: GroundPoint): { lat: number; lon: number } {
  const d = Math.hypot(p.east, p.north);
  const site = worldCoordinate(latDeg, lonDeg);
  if (d === 0) return site;
  const bearing = Math.atan2(p.east, p.north);
  const lat0 = degToRad(site.lat);
  const lon0 = degToRad(site.lon);
  const sinLat = Math.sin(lat0);
  const cosLat = Math.cos(lat0);
  const sinDR = Math.sin(d / KERNEL_EARTH_RADIUS_M);
  const cosDR = Math.cos(d / KERNEL_EARTH_RADIUS_M);
  const lat = Math.asin(sinLat * cosDR + cosLat * sinDR * Math.cos(bearing));
  const lon = lon0 + Math.atan2(Math.sin(bearing) * sinDR * cosLat, cosDR - sinLat * Math.sin(lat));
  return worldCoordinate(radToDeg(lat), radToDeg(lon));
}

/**
 * Java's Math.rint: the nearest integer, a tie going to the even one, where
 * Math.round sends every tie up.
 */
function rint(x: number): number {
  const r = Math.round(x);
  return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/**
 * Latitude and longitude as the WorldCoordinate constructor stores them: the
 * latitude clamped to [-90, 90] and the longitude reduced by MathUtil.reducePi,
 * which takes off the nearest whole turn. Done in degrees, so a point already
 * in range comes back unchanged.
 */
function worldCoordinate(latDeg: number, lonDeg: number): { lat: number; lon: number } {
  return { lat: Math.min(90, Math.max(-90, latDeg)), lon: reduceLonDeg(lonDeg) };
}

/** A longitude, degrees, reduced to [-180, 180] as MathUtil.reducePi reduces it. */
export function reduceLonDeg(lonDeg: number): number {
  return lonDeg - rint(lonDeg / 360) * 360;
}
