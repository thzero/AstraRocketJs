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
 */
export function offsetToLatLon(latDeg: number, lonDeg: number, p: GroundPoint): { lat: number; lon: number } {
  const d = Math.hypot(p.east, p.north);
  if (d === 0) return { lat: latDeg, lon: lonDeg };
  const bearing = Math.atan2(p.east, p.north);
  const lat0 = degToRad(latDeg);
  const lon0 = degToRad(lonDeg);
  const sinLat = Math.sin(lat0);
  const cosLat = Math.cos(lat0);
  const sinDR = Math.sin(d / KERNEL_EARTH_RADIUS_M);
  const cosDR = Math.cos(d / KERNEL_EARTH_RADIUS_M);
  const lat = Math.asin(sinLat * cosDR + cosLat * sinDR * Math.cos(bearing));
  const lon = lon0 + Math.atan2(Math.sin(bearing) * sinDR * cosLat, cosDR - sinLat * Math.sin(lat));
  return { lat: radToDeg(lat), lon: radToDeg(lon) };
}
