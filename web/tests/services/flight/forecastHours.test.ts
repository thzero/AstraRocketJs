import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimPayload } from '../../../src/engine/simProtocol';

const flown: SimPayload[] = [];
vi.mock('../../../src/engine/simClient', () => ({
  simulateInWorker: vi.fn(async (payload: SimPayload) => {
    flown.push(payload);
    // Land farther east the stronger the surface wind that hour, so each hour is told apart.
    const surface = payload.options.windLevels?.[0]?.speed ?? 0;
    return { series: { Px: [0, surface * 10], Py: [0, 5] } };
  }),
}));

const { flyForecastHours } = await import('../../../src/services/flight/forecastHours');
const { HOUR_OFFSETS, resetWeatherState, setWeatherTransport } =
  await import('../../../src/services/weather/openMeteo');
const { answer } = await import('../../testing/openMeteoFixture');

const start = Date.UTC(2026, 9, 5, 0) / 1000;
const source = {
  provider: 'open-meteo' as const,
  endpoint: 'forecast' as const,
  date: '2026-10-05',
  hour: 6,
  timezone: 'America/Denver',
  latitudeDeg: 40,
  longitudeDeg: -105,
  elevationM: 1500,
  validAt: new Date((start + 6 * 3600) * 1000).toISOString(),
  fetchedAt: new Date(start * 1000).toISOString(),
  groups: ['wind' as const, 'atmosphere' as const],
  elevationApplied: false,
};
const launch = {
  launchRodLengthM: 1,
  launchRodAngleDeg: 0,
  windAverage: 1,
  windStdDev: 0,
  launchAltitudeM: 1500,
  latitudeDeg: 40,
  longitudeDeg: -105,
  temperatureC: 20,
  pressureHPa: 850,
  weatherSource: source,
};

beforeEach(() => {
  flown.length = 0;
  resetWeatherState();
  setWeatherTransport(((url: string) => {
    const body = url.includes('/v1/elevation') ? { elevation: [1500] } : answer(1500, { start, hours: 48 });
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }) as typeof fetch);
});

describe('flyForecastHours', () => {
  it('flies the design under each hour from two before to two after, in order', async () => {
    const hours = await flyForecastHours(
      {
        tree: { components: [] } as never,
        config: { id: 'c', name: null, motors: {} } as never,
        launch: launch as never,
        source,
        prefs: { randomSeed: 42 } as never,
      },
      { now: () => start * 1000 },
    );
    expect(hours.map((h) => h.offset)).toEqual([...HOUR_OFFSETS]);
    expect(hours.map((h) => h.validMs / 1000 - start)).toEqual([4, 5, 6, 7, 8].map((h) => h * 3600));
    expect(flown).toHaveLength(5);
    // One seed for every hour, so turbulence does not pass for the wind changing.
    expect(new Set(flown.map((p) => p.options.randomSeed))).toEqual(new Set([42]));
    // Only the applied groups are replaced: the wind and the atmosphere aloft, not the site temperature.
    for (const p of flown) {
      expect(p.options.windLevels?.length).toBeGreaterThan(1);
      expect(p.options.atmosphereLevels?.length).toBeGreaterThan(0);
      expect(p.options.temperature).toBeCloseTo(293.15, 9);
    }
    expect(hours[0]!.landings[0]).toEqual({ east: 40, north: 5 });
  });

  it('leaves out hours the forecast does not hold', async () => {
    const early = { ...source, validAt: new Date((start + 1 * 3600) * 1000).toISOString(), hour: 1 };
    const hours = await flyForecastHours(
      {
        tree: { components: [] } as never,
        config: { id: 'c', name: null, motors: {} } as never,
        launch: { ...launch, weatherSource: early } as never,
        source: early,
        prefs: {} as never,
      },
      { now: () => start * 1000 },
    );
    expect(hours.map((h) => h.offset)).toEqual([-1, 0, 1, 2]);
  });
});
