import { describe, it, expect } from 'vitest';
import { offsetToLatLon, KERNEL_EARTH_RADIUS_M } from '../../../src/services/map/geodesy';

const DEG = 180 / Math.PI;

/**
 * A port of the kernel's default SPHERICAL GeodeticComputationStrategy
 * .addCoordinate (GeodeticComputationStrategy.java), checked against closed
 * forms at interior points rather than against another copy in web/: a move due
 * north travels the meridian, so the latitude grows by exactly d / R.
 */
describe('offsetToLatLon (kernel spherical)', () => {
  it('uses the kernel Earth radius', () => {
    expect(KERNEL_EARTH_RADIUS_M).toBe(6371000);
  });

  it('moves due north along the meridian by d / R', () => {
    const ll = offsetToLatLon(45, -105, { east: 0, north: 10_000 });
    expect(ll.lat).toBeCloseTo(45 + (10_000 / 6371000) * DEG, 12);
    expect(ll.lon).toBeCloseTo(-105, 12);
  });

  it('moves due east on the equator along it by d / R', () => {
    const ll = offsetToLatLon(0, 10, { east: 5_000, north: 0 });
    expect(ll.lat).toBeCloseTo(0, 12);
    expect(ll.lon).toBeCloseTo(10 + (5_000 / 6371000) * DEG, 12);
  });

  it('follows the great circle off the equator, which bends toward the pole', () => {
    // Due east at 60 N: the great circle starts east and curves south of the
    // parallel, so the latitude drops slightly. A flat projection keeps it.
    const ll = offsetToLatLon(60, 0, { east: 100_000, north: 0 });
    expect(ll.lat).toBeLessThan(60);
  });

  it('returns the site for no movement', () => {
    expect(offsetToLatLon(39.7, -104.9, { east: 0, north: 0 })).toEqual({ lat: 39.7, lon: -104.9 });
  });
});
