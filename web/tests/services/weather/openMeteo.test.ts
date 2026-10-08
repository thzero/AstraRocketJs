import { beforeEach, describe, expect, it } from 'vitest';
import {
  ALOFT_VARS,
  fetchWeather,
  forecastUrl,
  parseForecast,
  planDateWindow,
  PRESSURE_LEVELS,
  requestElevations,
  resetWeatherState,
  sampleAt,
  SURFACE_VARS,
  SKY_VARS,
  FORECAST_SKY_VARS,
  WeatherError,
} from '../../../src/services/weather/openMeteo';
import { answer } from '../../testing/openMeteoFixture';

const ok = (json: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(json), { status }));

beforeEach(() => resetWeatherState());

describe('planDateWindow', () => {
  it('uses the forecast endpoint from 92 days back to 15 days ahead', () => {
    expect(planDateWindow('2026-10-10', '2026-10-04')).toEqual({
      ok: true,
      endpoint: 'forecast',
      startDate: '2026-10-09',
      endDate: '2026-10-11',
    });
    expect(planDateWindow('2026-10-19', '2026-10-04')).toMatchObject({ endpoint: 'forecast', endDate: '2026-10-19' });
  });
  it('uses the archive before that, back to 1940', () => {
    expect(planDateWindow('2025-07-04', '2026-10-04')).toMatchObject({ ok: true, endpoint: 'archive' });
    expect(planDateWindow('1940-01-01', '2026-10-04')).toMatchObject({ ok: true, startDate: '1940-01-01' });
  });
  it('refuses a date nothing answers, before any request', () => {
    expect(planDateWindow('2026-10-20', '2026-10-04')).toEqual({ ok: false, reason: 'tooFarAhead' });
    expect(planDateWindow('1939-12-31', '2026-10-04')).toEqual({ ok: false, reason: 'tooEarly' });
    expect(planDateWindow('2026-02-30', '2026-10-04')).toEqual({ ok: false, reason: 'badDate' });
  });
});

describe('forecastUrl', () => {
  const q = {
    endpoint: 'forecast' as const,
    latitudeDeg: 40.12345,
    longitudeDeg: -105.6789,
    elevationsM: [1600],
    startDate: '2026-10-09',
    endDate: '2026-10-11',
  };
  it('goes to the free host with no key', () => {
    const url = forecastUrl(q);
    expect(url.startsWith('https://api.open-meteo.com/v1/forecast?')).toBe(true);
    expect(url).not.toContain('apikey');
    expect(url).toContain('latitude=40.123&longitude=-105.679&elevation=1600');
    expect(url).toContain('wind_speed_unit=ms&temperature_unit=celsius&timeformat=unixtime&timezone=auto');
  });
  it('goes to the customer host with the key', () => {
    const url = forecastUrl({ ...q, apiKey: 'a b&c' });
    expect(url.startsWith('https://customer-api.open-meteo.com/v1/forecast?')).toBe(true);
    expect(url.endsWith('&apikey=a%20b%26c')).toBe(true);
    expect(forecastUrl({ ...q, endpoint: 'archive', apiKey: 'k' })).toMatch(
      /^https:\/\/customer-archive-api\.open-meteo\.com\/v1\/archive\?/,
    );
  });
  it('asks for every surface variable, and the levels only from the forecast', () => {
    const vars = new URL(forecastUrl(q)).searchParams.get('hourly')!.split(',');
    expect(vars).toEqual([...SURFACE_VARS, ...SKY_VARS, ...FORECAST_SKY_VARS, ...ALOFT_VARS]);
    expect(vars).toContain(`geopotential_height_${PRESSURE_LEVELS[PRESSURE_LEVELS.length - 1]}hPa`);
    const archived = new URL(forecastUrl({ ...q, endpoint: 'archive' })).searchParams.get('hourly')!.split(',');
    expect(archived).toEqual([...SURFACE_VARS, ...SKY_VARS]);
  });
  it('repeats the point for a second elevation', () => {
    expect(forecastUrl({ ...q, elevationsM: [1600, 1712.04] })).toContain(
      'latitude=40.123,40.123&longitude=-105.679,-105.679&elevation=1600,1712',
    );
  });
});

describe('requestElevations', () => {
  it('asks once when the site and the terrain agree within 30 m', () => {
    expect(requestElevations(1600, 1625)).toEqual([1600]);
    expect(requestElevations(1600, null)).toEqual([1600]);
  });
  it('asks for both when they do not', () => {
    expect(requestElevations(0, 1610)).toEqual([0, 1610]);
  });
});

describe('parseForecast', () => {
  it('reads every hour, surface and aloft', () => {
    const [v] = parseForecast(answer(1600), [1600]);
    expect(v!.samples).toHaveLength(3);
    const s = v!.samples[1]!;
    expect(s).toMatchObject({ temperatureC: 13, humidityPct: 40, pressureHPa: 850, windSpeed: 4, windGust: 7 });
    expect(s.windFromDeg).toBe(270);
    expect(s.heightWinds.map((h) => h.heightM)).toEqual([80, 120, 180]);
    expect(s.levels).toHaveLength(PRESSURE_LEVELS.length);
    expect(s.levels[0]).toMatchObject({ pressureHPa: 1000, windSpeed: 10, humidityPct: 30 });
  });
  it('reads the sky readouts, and visibility only from the forecast', () => {
    const [v] = parseForecast(answer(1600), [1600]);
    expect(v!.samples[0]).toMatchObject({ cloudCoverPct: 40, cloudCoverLowPct: 10, visibilityM: 24140 });
    const [a] = parseForecast(answer(1600, { archive: true }), [1600]);
    expect(a!.samples[0]).toMatchObject({ cloudCoverPct: 40, visibilityM: null });
  });
  it('reads an answer without the sky as missing, not as a failure', () => {
    const [v] = parseForecast(answer(1600, { sky: false }), [1600]);
    expect(v!.samples[0]).toMatchObject({ cloudCoverPct: null, cloudCoverLowPct: null, visibilityM: null });
  });
  it('refuses visibility in another unit', () => {
    expect(() => parseForecast(answer(1600, { units: { visibility: 'ft' } }), [1600])).toThrow(
      expect.objectContaining({ kind: 'units' }),
    );
  });
  it('reads an archive answer as surface only', () => {
    const [v] = parseForecast(answer(1600, { archive: true }), [1600]);
    expect(v!.samples[0]!.levels).toEqual([]);
    expect(v!.samples[0]!.heightWinds).toEqual([]);
  });
  it('refuses a variable in another unit', () => {
    expect(() => parseForecast(answer(1600, { units: { wind_speed_10m: 'km/h' } }), [1600])).toThrow(
      expect.objectContaining({ kind: 'units' }),
    );
    expect(() => parseForecast(answer(1600, { units: { temperature_850hPa: '°F' } }), [1600])).toThrow(
      expect.objectContaining({ kind: 'units' }),
    );
  });
  it('refuses an answer for another elevation, or the wrong number of them', () => {
    expect(() => parseForecast(answer(1500), [1600])).toThrow(expect.objectContaining({ kind: 'shape' }));
    expect(() => parseForecast([answer(1600)], [1600, 1700])).toThrow(expect.objectContaining({ kind: 'shape' }));
  });
  it("passes on Open-Meteo's own refusal", () => {
    expect(() => parseForecast({ error: true, reason: 'Latitude must be in range' }, [0])).toThrow(
      expect.objectContaining({ kind: 'refused', detail: 'Latitude must be in range' }),
    );
  });
  it('reads a missing value as missing, never zero', () => {
    const a = answer(1600);
    a.hourly['temperature_2m']![0] = null as unknown as number;
    expect(parseForecast(a, [1600])[0]!.samples[0]!.temperatureC).toBeNull();
  });
  it('refuses an answer with no surface data at all', () => {
    const a = answer(1600);
    for (const v of ['temperature_2m', 'surface_pressure', 'wind_speed_10m']) a.hourly[v] = [null, null, null] as never;
    expect(() => parseForecast(a, [1600])).toThrow(expect.objectContaining({ kind: 'noData' }));
  });
});

describe('fetchWeather', () => {
  const q = { latitudeDeg: 40, longitudeDeg: -105, siteM: 1600, date: '2026-10-05', today: '2026-10-04' };
  const routes = (forecast: () => Promise<Response>, terrain = 1610) => {
    const urls: string[] = [];
    const fetchImpl = ((url: string) => {
      urls.push(url);
      return url.includes('/v1/elevation') ? ok({ elevation: [terrain] }) : forecast();
    }) as typeof fetch;
    return { urls, fetchImpl };
  };

  it('fetches the terrain, then the forecast at the site', async () => {
    const { urls, fetchImpl } = routes(() => ok(answer(1600)));
    const a = await fetchWeather(q, { fetchImpl, sleep: async () => {} });
    expect(a).toMatchObject({ endpoint: 'forecast', terrainM: 1610, elevationsM: [1600], timezone: 'America/Denver' });
    expect(urls).toHaveLength(2);
    expect(urls.every((u) => u.startsWith('https://api.open-meteo.com/'))).toBe(true);
  });
  it('sends the key to the customer hosts', async () => {
    const { urls, fetchImpl } = routes(() => ok(answer(1600)));
    await fetchWeather({ ...q, apiKey: 'secret' }, { fetchImpl, sleep: async () => {} });
    expect(urls.every((u) => u.startsWith('https://customer-api.open-meteo.com/') && u.endsWith('apikey=secret'))).toBe(
      true,
    );
  });
  it('refuses a date out of reach without a request', async () => {
    const { urls, fetchImpl } = routes(() => ok(answer(1600)));
    await expect(fetchWeather({ ...q, date: '2026-11-30' }, { fetchImpl })).rejects.toMatchObject({
      kind: 'refused',
      detail: 'tooFarAhead',
    });
    expect(urls).toEqual([]);
  });
  it('names a refused key and a spent quota', async () => {
    const bad = routes(() => ok({ error: true, reason: 'invalid apikey' }, 401));
    await expect(fetchWeather(q, { fetchImpl: bad.fetchImpl, sleep: async () => {} })).rejects.toMatchObject({
      kind: 'badKey',
    });
    resetWeatherState();
    const spent = routes(() => ok({ error: true, reason: 'Daily API request limit exceeded' }, 429));
    await expect(fetchWeather(q, { fetchImpl: spent.fetchImpl, sleep: async () => {} })).rejects.toMatchObject({
      kind: 'quota',
    });
  });
  it('reports an unreachable service as offline', async () => {
    const fetchImpl = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;
    await expect(fetchWeather(q, { fetchImpl, sleep: async () => {} })).rejects.toMatchObject({ kind: 'offline' });
  });
  it('spaces weather requests 5 s apart and reuses an answer', async () => {
    let t = 1_000_000;
    const waits: number[] = [];
    const now = () => t;
    const sleep = async (ms: number) => {
      waits.push(ms);
      t += ms;
    };
    const { urls, fetchImpl } = routes(() => ok(answer(1600)));
    await fetchWeather(q, { fetchImpl, now, sleep });
    await fetchWeather({ ...q, date: '2026-10-08' }, { fetchImpl, now, sleep });
    expect(waits).toEqual([5000]);
    await fetchWeather(q, { fetchImpl, now, sleep });
    expect(urls.filter((u) => u.includes('/v1/forecast'))).toHaveLength(2);
  });
  it('reuses an answer for 30 minutes, says so, and asks again when forced or later', async () => {
    let t = 1_000_000;
    const now = () => t;
    const sleep = async (ms: number) => {
      t += ms;
    };
    const { urls, fetchImpl } = routes(() => ok(answer(1600)));
    const forecasts = () => urls.filter((u) => u.includes('/v1/forecast')).length;
    const first = await fetchWeather(q, { fetchImpl, now, sleep });
    expect(first.reused).toBe(false);
    t += 29 * 60_000;
    const again = await fetchWeather(q, { fetchImpl, now, sleep });
    expect(again).toMatchObject({ reused: true, fetchedAtMs: first.fetchedAtMs });
    expect(forecasts()).toBe(1);
    const forced = await fetchWeather(q, { fetchImpl, now, sleep, force: true });
    expect(forced.reused).toBe(false);
    expect(forecasts()).toBe(2);
    t += 31 * 60_000;
    expect((await fetchWeather(q, { fetchImpl, now, sleep })).reused).toBe(false);
    expect(forecasts()).toBe(3);
  });

  it('is a WeatherError for every failure', () => {
    expect(new WeatherError('timeout')).toBeInstanceOf(Error);
  });
});

describe('sampleAt', () => {
  it('finds the hour on the site calendar', () => {
    // 2026-10-04 18:00 UTC is 12:00 in Denver (MDT, UTC-6).
    const start = Date.UTC(2026, 9, 4, 17) / 1000;
    const [v] = parseForecast(answer(1600, { start, hours: 3 }), [1600]);
    expect(sampleAt(v!, 'America/Denver', '2026-10-04', 12)!.unix).toBe(start + 3600);
    expect(sampleAt(v!, 'America/Denver', '2026-10-04', 3)).toBeNull();
  });
});
