import { describe, expect, it, vi } from 'vitest';
import { offsetToLatLon } from '../../../src/services/map/geodesy';
import { groundAt, terrainBounds, TERRAIN_POINTS } from '../../../src/services/landing/terrain';
import { landingLatLon, trackPoints } from '../../../src/services/flight/groundTrack';
import type { FlightResult } from '../../../src/engine/openRocketEngine';
import { loadEngine } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * A landing across the date line, projected from the pad and checked against
 * where the kernel says the flight came down. The kernel stores every position
 * as a WorldCoordinate, whose constructor reduces the longitude with
 * MathUtil.reducePi (WorldCoordinate.java:27, MathUtil.java:199), so its λ is
 * in [-180, 180] on either side of the line.
 */

const TREE = {
  name: 'Drifter',
  components: [
    {
      id: 'st',
      type: 'stage',
      name: 'Sustainer',
      children: [
        { id: 'n', type: 'nosecone', length: 0.07, aftRadius: 0.012, thickness: 0.002 },
        {
          id: 'b',
          type: 'bodytube',
          length: 0.3,
          outerRadius: 0.012,
          thickness: 0.0003,
          children: [
            {
              id: 'f',
              type: 'trapezoidfinset',
              finCount: 3,
              rootChord: 0.05,
              tipChord: 0.03,
              sweep: 0.02,
              height: 0.03,
              thickness: 0.003,
            },
            {
              id: 'mm',
              type: 'innertube',
              length: 0.07,
              outerRadius: 0.0095,
              thickness: 0.0005,
              motorMount: true,
              position: { method: 'bottom', offset: 0 },
            },
            { id: 'c', type: 'parachute', diameter: 0.35 },
          ],
        },
      ],
    },
  ],
};

const LAT = 0.3;

async function fly(lonDeg: number): Promise<FlightResult> {
  const engine = await loadEngine();
  engine.reset();
  const h = engine.buildRocket(JSON.stringify(TREE));
  const times = [0, 0.1, 0.3, 0.5, 1.0, 1.5, 1.85, 2.0];
  const thrusts = [0, 12.0, 6.0, 5.1, 4.9, 4.8, 4.5, 0];
  const masses = [0.024, 0.0231, 0.0215, 0.0202, 0.0174, 0.0147, 0.0133, 0.0132];
  engine.setMotorById(h, 'mm', 'C6', 0.018, 0.07, times, thrusts, masses, 0.035, 5);
  const opts = {
    rodLength: 1,
    randomSeed: 7,
    windAverage: 6,
    launchLatitude: LAT,
    launchLongitude: lonDeg,
    series: 'full',
  };
  return JSON.parse(engine.simulateJson(h, JSON.stringify(opts))) as FlightResult;
}

describe('offsetToLatLon across the date line', () => {
  it('lands where the kernel puts the flight, on the far side of 180', async () => {
    // The drift sets which side of the line the pad goes on: a third of the
    // drift short of it, so the landing is two thirds of the drift past it.
    const probe = trackPoints((await fly(0)).series).at(-1)!;
    const degPerM = 180 / Math.PI / 6371000 / Math.cos((LAT * Math.PI) / 180);
    const margin = (Math.abs(probe.east) / 3) * degPerM;
    expect(Math.abs(probe.east)).toBeGreaterThan(50);
    const site = probe.east > 0 ? 180 - margin : -180 + margin;

    const result = await fly(site);
    const landing = trackPoints(result.series).at(-1)!;
    const kernel = landingLatLon(result.series)!;
    // The kernel's own landing is across the line from the pad.
    expect(Math.sign(kernel.lon)).toBe(-Math.sign(site));

    const ll = offsetToLatLon(LAT, site, landing);
    expect(ll.lat).toBeCloseTo(kernel.lat, 9);
    expect(ll.lon).toBeCloseTo(kernel.lon, 9);
  });

  it('reads the terrain grid across the line as it reads it anywhere else', () => {
    // The same grid shape and the same offset, once across the line and once
    // well away from it: the ground found there has to be the same.
    const heights = Array.from({ length: TERRAIN_POINTS ** 2 }, (_, k) => k % TERRAIN_POINTS);
    const at = (lon: number) => {
      const b = terrainBounds(LAT, lon, 2000);
      const p = offsetToLatLon(LAT, lon, { east: 1200, north: 300 });
      return groundAt({ ...b, n: TERRAIN_POINTS, heights })(p.lat, p.lon);
    };
    expect(at(179.999)).toBeCloseTo(at(9.999), 6);
    expect(at(-179.999)).toBeCloseTo(at(-9.999), 6);
  });
});
