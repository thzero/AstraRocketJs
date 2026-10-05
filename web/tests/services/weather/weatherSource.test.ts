import { describe, expect, it } from 'vitest';
import type { LaunchConditions, WeatherSource } from '../../../src/services/design/orkTree';
import {
  isWeatherSource,
  restoredSource,
  sourceFields,
  sourceFor,
  sourceStatus,
  STALE_AFTER_MS,
} from '../../../src/services/weather/weatherSource';

const NOW = Date.parse('2026-10-04T15:00:00Z');

const applied: Partial<LaunchConditions> = {
  temperatureC: 12,
  pressureHPa: 850,
  windAverage: 4,
  windStdDev: 1,
  windDirectionDeg: 270,
  windLevels: [{ altitudeM: 1510, speed: 4, directionDeg: 270, stddev: 1 }],
  windAltitudeReference: 'msl',
};

const source = (over: Partial<Parameters<typeof sourceFor>[0]> = {}): WeatherSource =>
  sourceFor({
    endpoint: 'forecast',
    date: '2026-10-05',
    hour: 12,
    timezone: 'America/Denver',
    latitudeDeg: 40,
    longitudeDeg: -105,
    elevationM: 1500,
    validUnix: Date.parse('2026-10-05T18:00:00Z') / 1000,
    fetchedAtMs: NOW - 60_000,
    groups: ['temperature', 'pressure', 'wind'],
    elevationApplied: false,
    applied,
    ...over,
  });

const launch = (s: WeatherSource, over: Partial<LaunchConditions> = {}) =>
  ({
    latitudeDeg: 40,
    longitudeDeg: -105,
    launchAltitudeM: 1500,
    ...applied,
    weatherSource: s,
    ...over,
  }) as LaunchConditions;

describe('sourceStatus', () => {
  it('is clean right after Apply', () => {
    expect(sourceStatus(launch(source()), NOW)).toEqual({ edited: false, otherSite: false, old: false });
  });
  it('sees an edit to any field the forecast filled, and only those', () => {
    expect(sourceStatus(launch(source(), { pressureHPa: 851 }), NOW)!.edited).toBe(true);
    expect(sourceStatus(launch(source(), { windLevels: [] }), NOW)!.edited).toBe(true);
    // Humidity was not applied, so changing it is not an edit of the forecast.
    expect(sourceStatus(launch(source(), { relativeHumidity: 0.9 }), NOW)!.edited).toBe(false);
  });
  it('counts the site altitude only when the terrain elevation was applied', () => {
    expect(sourceStatus(launch(source(), { launchAltitudeM: 10 }), NOW)!.edited).toBe(false);
    const s = source({ elevationApplied: true, applied: { ...applied, launchAltitudeM: 1612 } });
    expect(sourceStatus(launch(s, { launchAltitudeM: 1612 }), NOW)!.edited).toBe(false);
    expect(sourceStatus(launch(s, { launchAltitudeM: 1600 }), NOW)!.edited).toBe(true);
  });
  it('sees a moved site, beyond the 3 decimals a request is rounded to', () => {
    expect(sourceStatus(launch(source(), { latitudeDeg: 40.0004 }), NOW)!.otherSite).toBe(false);
    expect(sourceStatus(launch(source(), { latitudeDeg: 40.01 }), NOW)!.otherSite).toBe(true);
    expect(sourceStatus(launch(source(), { longitudeDeg: null }), NOW)!.otherSite).toBe(true);
  });
  it('calls a forecast for a time ahead old once it is 3 hours old, and never a past hour or a record', () => {
    const fetched = NOW - STALE_AFTER_MS - 1;
    expect(sourceStatus(launch(source({ fetchedAtMs: fetched })), NOW)!.old).toBe(true);
    expect(sourceStatus(launch(source({ fetchedAtMs: NOW - STALE_AFTER_MS + 60_000 })), NOW)!.old).toBe(false);
    const past = Date.parse('2026-10-04T12:00:00Z') / 1000;
    expect(sourceStatus(launch(source({ fetchedAtMs: fetched, validUnix: past })), NOW)!.old).toBe(false);
    expect(sourceStatus(launch(source({ fetchedAtMs: fetched, endpoint: 'archive' })), NOW)!.old).toBe(false);
  });
  it('says nothing without a stamp, or with one that does not read as one', () => {
    expect(sourceStatus({ ...launch(source()), weatherSource: undefined }, NOW)).toBeNull();
    expect(sourceStatus({ ...launch(source()), weatherSource: { provider: 'x' } as never }, NOW)).toBeNull();
  });
});

describe('restoredSource (a stamp read from a file)', () => {
  const { applied: _drop, ...fromFile } = source();
  it('takes the values now in the launch as the applied ones', () => {
    const l = launch(source(), { pressureHPa: 840 });
    const restored = restoredSource(fromFile, l);
    expect(restored.applied!.pressureHPa).toBe(840);
    expect(sourceStatus({ ...l, weatherSource: restored }, NOW)!.edited).toBe(false);
    expect(sourceStatus({ ...l, pressureHPa: 841, weatherSource: restored }, NOW)!.edited).toBe(true);
  });
  it('keeps a file that says the values were edited as edited', () => {
    const restored = restoredSource({ ...fromFile, edited: true }, launch(source()));
    expect(sourceStatus(launch(restored), NOW)!.edited).toBe(true);
  });
});

describe('sourceFields', () => {
  it('lists the fields of the applied groups', () => {
    expect(sourceFields(source({ groups: ['humidity', 'atmosphere'] }))).toEqual([
      'relativeHumidity',
      'atmosphereLevels',
    ]);
  });
});

describe('isWeatherSource', () => {
  it('accepts a stamp and refuses a damaged one', () => {
    expect(isWeatherSource(source())).toBe(true);
    expect(isWeatherSource({ ...source(), groups: ['tornado'] })).toBe(false);
    expect(isWeatherSource({ ...source(), fetchedAt: 'yesterday' })).toBe(false);
    expect(isWeatherSource({ ...source(), hour: 1.5 })).toBe(false);
  });
});
