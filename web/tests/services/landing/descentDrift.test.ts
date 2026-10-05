import { describe, expect, it } from 'vitest';
import { airVelocity, descentDrift, offsetToLatLon, type WindLayer } from '../../../src/services/landing/descentDrift';
import { groundAt, terrainBounds, terrainPoints, TERRAIN_POINTS } from '../../../src/services/landing/terrain';

const SITE = { latitudeDeg: 40, longitudeDeg: -105, padElevationM: 1500 };
/** A west wind (blowing from 270, so the air moves east) of `speed` at every height. */
const westWind = (speed: number): WindLayer[] => [
  { altitudeM: 0, speed, fromDeg: 270 },
  { altitudeM: 20_000, speed, fromDeg: 270 },
];

describe('airVelocity', () => {
  it('moves the air away from where the wind blows from', () => {
    const v = airVelocity(westWind(10), 2000);
    expect(v.east).toBeCloseTo(10, 9);
    expect(v.north).toBeCloseTo(0, 9);
  });
  it('turns through north the short way between a 350 and a 10 degree level', () => {
    const v = airVelocity(
      [
        { altitudeM: 0, speed: 10, fromDeg: 350 },
        { altitudeM: 100, speed: 10, fromDeg: 10 },
      ],
      50,
    );
    // Halfway is a north wind: air moving south, nearly at full speed.
    expect(v.north).toBeLessThan(-9.8);
    expect(Math.abs(v.east)).toBeLessThan(1e-9);
  });
  it('holds the end values outside the profile, and scales and turns on request', () => {
    expect(airVelocity(westWind(4), 50_000).east).toBeCloseTo(4, 9);
    const v = airVelocity(westWind(4), 1000, 1.5, 90);
    expect(v.north).toBeCloseTo(-6, 9);
  });
});

describe('descentDrift', () => {
  it('in still air lands under apogee, after apogee over the rate', () => {
    const r = descentDrift({ ...SITE, plan: { apogeeAglM: 300, firstRateMs: 6 }, wind: [] });
    expect(r.distanceM).toBe(0);
    expect(r.timeS).toBeCloseTo(50, 9);
    expect(r.groundElevationM).toBe(1500);
  });

  it('drifts downwind by the wind times the descent time', () => {
    const r = descentDrift({ ...SITE, plan: { apogeeAglM: 300, firstRateMs: 6 }, wind: westWind(5) });
    expect(r.landing.east).toBeCloseTo(250, 6);
    expect(r.landing.north).toBeCloseTo(0, 6);
    expect(r.bearingDeg).toBeCloseTo(90, 6);
    const ll = offsetToLatLon(40, -105, r.landing);
    expect(r.landingLatDeg).toBeCloseTo(ll.lat, 12);
    expect(r.landingLonDeg).toBeGreaterThan(-105);
  });

  it('falls at the drogue rate above the main and the main rate below it', () => {
    const r = descentDrift({
      ...SITE,
      plan: { apogeeAglM: 1000, firstRateMs: 25, main: { rateMs: 5, aglM: 200 } },
      wind: [],
    });
    expect(r.timeS).toBeCloseTo(800 / 25 + 200 / 5, 6);
  });

  it('applies the rate factor to both rates', () => {
    const r = descentDrift({
      ...SITE,
      plan: { apogeeAglM: 1000, firstRateMs: 25, main: { rateMs: 5, aglM: 200 } },
      wind: [],
      rateFactor: 2,
    });
    expect(r.timeS).toBeCloseTo((800 / 25 + 200 / 5) / 2, 6);
  });

  it('lands sooner on rising ground downwind and later on falling ground', () => {
    const plan = { apogeeAglM: 300, firstRateMs: 5 };
    // The ground rises (or falls) 1 m for every 4 m east of the pad.
    const slope = (k: number) => (_lat: number, lon: number) => 1500 + k * (lon + 105) * 85_000;
    const flat = descentDrift({ ...SITE, plan, wind: westWind(5) });
    const up = descentDrift({ ...SITE, plan, wind: westWind(5), groundAt: slope(0.25) });
    const down = descentDrift({ ...SITE, plan, wind: westWind(5), groundAt: slope(-0.25) });
    expect(up.timeS).toBeLessThan(flat.timeS);
    expect(up.groundElevationM).toBeGreaterThan(1500);
    expect(down.timeS).toBeGreaterThan(flat.timeS);
    expect(down.groundElevationM).toBeLessThan(1500);
  });
});

describe('terrain grid', () => {
  it('lays its points out row by row from the south-west corner', () => {
    const b = terrainBounds(40, -105, 1000);
    const pts = terrainPoints(b);
    expect(pts).toHaveLength(TERRAIN_POINTS ** 2);
    expect(pts[0]).toEqual({ latitudeDeg: b.south, longitudeDeg: b.west });
    expect(pts[pts.length - 1]!.latitudeDeg).toBeCloseTo(b.north, 12);
    expect(pts[1]!.latitudeDeg).toBe(b.south);
  });

  it('interpolates between the points and holds its edge outside them', () => {
    const grid = { south: 0, west: 0, north: 1, east: 1, n: 2, heights: [100, 200, 300, 400] };
    const g = groundAt(grid);
    expect(g(0, 0)).toBe(100);
    expect(g(0.5, 0.5)).toBe(250);
    expect(g(1, 1)).toBe(400);
    expect(g(5, 5)).toBe(400);
    expect(g(-5, 0.5)).toBe(150);
  });
});
