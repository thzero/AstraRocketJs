import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { offsetToLatLon, KERNEL_EARTH_RADIUS_M } from '../../../src/services/map/geodesy';

const DEG = 180 / Math.PI;

/** WorldCoordinate.REARTH as the kernel source declares it, meters. */
const JAVA_REARTH = (() => {
  const file = fileURLToPath(
    new URL('../../../../engine-java/src/java/info/openrocket/core/util/WorldCoordinate.java', import.meta.url),
  );
  const m = readFileSync(file, 'utf8').match(/static\s+final\s+double\s+REARTH\s*=\s*([\d.eE+-]+)\s*;/);
  if (!m) throw new Error('WorldCoordinate.java declares no REARTH');
  return Number(m[1]);
})();

/** Great-circle distance between two points on a sphere of radius `r` (haversine), meters. */
function distance(lat1: number, lon1: number, lat2: number, lon2: number, r: number): number {
  const [p1, p2] = [lat1 / DEG, lat2 / DEG];
  const dp = p2 - p1;
  const dl = (lon2 - lon1) / DEG;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/** Initial great-circle bearing from the first point to the second, radians clockwise from north. */
function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const [p1, p2] = [lat1 / DEG, lat2 / DEG];
  const dl = (lon2 - lon1) / DEG;
  return Math.atan2(
    Math.sin(dl) * Math.cos(p2),
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl),
  );
}

/**
 * A port of the kernel's default SPHERICAL GeodeticComputationStrategy
 * .addCoordinate (GeodeticComputationStrategy.java), checked against closed
 * forms at interior points rather than against another copy in web/: a move due
 * north travels the meridian, so the latitude grows by exactly d / R.
 */
describe('offsetToLatLon (kernel spherical)', () => {
  it('uses the kernel Earth radius', () => {
    expect(KERNEL_EARTH_RADIUS_M).toBe(JAVA_REARTH);
  });

  it('moves due north along the meridian by d / R', () => {
    const ll = offsetToLatLon(45, -105, { east: 0, north: 10_000 });
    expect(ll.lat).toBeCloseTo(45 + (10_000 / JAVA_REARTH) * DEG, 12);
    expect(ll.lon).toBeCloseTo(-105, 12);
  });

  it('moves due east on the equator along it by d / R', () => {
    const ll = offsetToLatLon(0, 10, { east: 5_000, north: 0 });
    expect(ll.lat).toBeCloseTo(0, 12);
    expect(ll.lon).toBeCloseTo(10 + (5_000 / JAVA_REARTH) * DEG, 12);
  });

  it('follows the great circle off the equator, which bends toward the pole', () => {
    // Due east at 60 N: the great circle starts east and curves south of the
    // parallel, so the latitude drops slightly. A flat projection keeps it.
    const ll = offsetToLatLon(60, 0, { east: 100_000, north: 0 });
    expect(ll.lat).toBeLessThan(60);
  });

  // The inverse problem, solved independently: the point lies the offset's
  // length away along a great circle that leaves the site on the offset's
  // bearing. Both latitude and longitude terms have to be right for either to
  // hold at a bearing that is not a cardinal direction.
  it.each([
    { lat: 39.7, lon: -104.9, east: 3_000, north: 4_000 },
    { lat: 52.1, lon: 4.3, east: -12_000, north: 7_500 },
    { lat: -33.9, lon: 151.2, east: 8_000, north: -15_000 },
    { lat: 64.8, lon: -147.7, east: -40_000, north: -25_000 },
    { lat: 0, lon: 0, east: 70_000, north: 70_000 },
  ])('lands $east m east, $north m north of ($lat, $lon) on the great circle at that bearing', (c) => {
    const ll = offsetToLatLon(c.lat, c.lon, { east: c.east, north: c.north });
    const d = Math.hypot(c.east, c.north);
    expect(distance(c.lat, c.lon, ll.lat, ll.lon, JAVA_REARTH)).toBeCloseTo(d, 4);
    expect(bearing(c.lat, c.lon, ll.lat, ll.lon)).toBeCloseTo(Math.atan2(c.east, c.north), 9);
  });

  it('returns the site for no movement', () => {
    expect(offsetToLatLon(39.7, -104.9, { east: 0, north: 0 })).toEqual({ lat: 39.7, lon: -104.9 });
  });
});
