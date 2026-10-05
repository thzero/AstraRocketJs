import { beforeEach, describe, expect, it } from 'vitest';
import { parseForecast, resetWeatherState, ymdInZone } from '../../../src/services/weather/openMeteo';
import {
  estimateLanding,
  HOUR_OFFSETS,
  runLandingEstimate,
  windAt,
} from '../../../src/services/landing/landingEstimate';
import { answer } from '../../testing/openMeteoFixture';

beforeEach(() => resetWeatherState());

const start = Date.UTC(2026, 9, 5, 0) / 1000;
const variant = () => parseForecast(answer(1500, { start, hours: 24 }), [1500])[0]!;
const plan = { apogeeAglM: 600, firstRateMs: 20, main: { rateMs: 6, aglM: 150 } };
const site = { latitudeDeg: 40, longitudeDeg: -105, padElevationM: 1500, plan };

describe('windAt', () => {
  it("gives the hour's profile as MSL levels blowing from their compass direction", () => {
    const w = windAt(variant(), start + 3600)!;
    expect(w[0]).toMatchObject({ altitudeM: 1510, speed: 4, fromDeg: 270 });
    expect(w.every((l, i) => i === 0 || l.altitudeM > w[i - 1]!.altitudeM)).toBe(true);
  });
  it('is null for an hour the answer does not hold', () => {
    expect(windAt(variant(), start + 99 * 3600)).toBeNull();
  });
});

describe('estimateLanding', () => {
  it('flies the chosen hour, and 135 descents for the zone', () => {
    const e = estimateLanding({ ...site, variant: variant(), validUnix: start + 6 * 3600 })!;
    expect(e.hours).toBe(HOUR_OFFSETS.length);
    expect(e.samples).toHaveLength(135);
    // The fixture wind blows from the west, so the rocket lands east.
    expect(e.nominal.landing.east).toBeGreaterThan(0);
    expect(e.ellipse!.semiMajorM).toBeGreaterThan(0);
    expect(e.samples).toContainEqual(e.nominal.landing);
  });
  it('uses only the hours the answer holds at its edges', () => {
    const e = estimateLanding({ ...site, variant: variant(), validUnix: start })!;
    expect(e.hours).toBe(3);
    expect(e.samples).toHaveLength(81);
  });
});

describe('runLandingEstimate', () => {
  const today = ymdInZone(Date.UTC(2026, 9, 4, 18), 'America/Denver');
  const routes = (terrain: 'ok' | 'fail') => {
    const urls: string[] = [];
    const fetchImpl = ((url: string) => {
      urls.push(url);
      const u = new URL(url);
      if (u.pathname === '/v1/elevation') {
        const n = u.searchParams.get('latitude')!.split(',').length;
        if (terrain === 'fail' && n > 1) return Promise.resolve(new Response('{}', { status: 500 }));
        // Ground rising to the east: one meter per thousandth of a degree.
        const longitudes = u.searchParams.get('longitude')!.split(',').map(Number);
        const body = { elevation: longitudes.map((lon) => 1500 + (lon + 105) * 1000) };
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(answer(1500, { start, hours: 48 })), { status: 200 }));
    }) as typeof fetch;
    return { urls, fetchImpl };
  };
  const q = {
    latitudeDeg: 40,
    longitudeDeg: -105,
    padElevationM: 1500,
    date: '2026-10-05',
    hour: 6,
    today,
    plan,
  };

  it('lands on the terrain when it can be had', async () => {
    const { urls, fetchImpl } = routes('ok');
    const run = await runLandingEstimate(q, { fetchImpl, sleep: async () => {} });
    if (run === 'noHour') throw new Error('noHour');
    expect(run.terrain).toBe(true);
    // Ground rising downwind: the landing is above the pad.
    expect(run.estimate.nominal.groundElevationM).toBeGreaterThan(1500);
    expect(urls.some((u) => u.includes('/v1/elevation') && u.split(',').length > 50)).toBe(true);
  });

  it('falls back to flat ground, and says so, when the terrain cannot be had', async () => {
    const { fetchImpl } = routes('fail');
    const run = await runLandingEstimate(q, { fetchImpl, sleep: async () => {} });
    if (run === 'noHour') throw new Error('noHour');
    expect(run.terrain).toBe(false);
    expect(run.estimate.nominal.groundElevationM).toBe(1500);
  });

  it("takes the terrain model's height for the pad when none is given", async () => {
    const { fetchImpl } = routes('ok');
    const run = await runLandingEstimate({ ...q, padElevationM: null }, { fetchImpl, sleep: async () => {} });
    if (run === 'noHour') throw new Error('noHour');
    expect(run.padElevationM).toBe(1500);
  });
});
