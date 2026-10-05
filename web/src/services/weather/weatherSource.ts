import type { LaunchConditions, WeatherSource } from '../design/orkTree';

/**
 * The record of where a simulation's weather came from, and what can be said
 * about it later: whether its values have been edited, whether the site has
 * moved, and whether a forecast for a time still ahead has gone old.
 */

/**
 * A forecast older than this, for a time still ahead, is called old. The
 * models behind Open-Meteo run every one to six hours, so a few hours is when a
 * fetch is likely to have been superseded.
 */
export const STALE_AFTER_MS = 3 * 3_600_000;

/** Coordinates within this many degrees are the site the forecast was asked for (requests round to 3 dp). */
const SAME_SITE_DEG = 0.0005;

/** The fields each applied group writes, and the site altitude when the terrain elevation was applied. */
const GROUP_FIELDS: Record<WeatherSource['groups'][number], (keyof LaunchConditions)[]> = {
  temperature: ['temperatureC'],
  pressure: ['pressureHPa'],
  humidity: ['relativeHumidity'],
  wind: ['windAverage', 'windStdDev', 'windDirectionDeg', 'windLevels', 'windAltitudeReference'],
  atmosphere: ['atmosphereLevels'],
};

/** The launch fields a source speaks for. */
export function sourceFields(source: WeatherSource): (keyof LaunchConditions)[] {
  const fields = source.groups.flatMap((g) => GROUP_FIELDS[g]);
  return source.elevationApplied ? [...fields, 'launchAltitudeM'] : fields;
}

/** The stamp Apply writes beside the values it applied. */
export function sourceFor(q: {
  endpoint: WeatherSource['endpoint'];
  date: string;
  hour: number;
  timezone: string;
  latitudeDeg: number;
  longitudeDeg: number;
  elevationM: number;
  validUnix: number;
  fetchedAtMs: number;
  groups: WeatherSource['groups'];
  elevationApplied: boolean;
  applied: Partial<LaunchConditions>;
}): WeatherSource {
  return {
    provider: 'open-meteo',
    endpoint: q.endpoint,
    date: q.date,
    hour: q.hour,
    timezone: q.timezone,
    latitudeDeg: q.latitudeDeg,
    longitudeDeg: q.longitudeDeg,
    elevationM: q.elevationM,
    validAt: new Date(q.validUnix * 1000).toISOString(),
    fetchedAt: new Date(q.fetchedAtMs).toISOString(),
    groups: q.groups,
    elevationApplied: q.elevationApplied,
    applied: q.applied,
  };
}

export interface SourceStatus {
  /** A field the forecast filled has a different value now. */
  edited: boolean;
  /** The site is not where the forecast was asked for. */
  otherSite: boolean;
  /** A forecast for a time still ahead, fetched long enough ago to have been superseded. */
  old: boolean;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function sourceStatus(launch: LaunchConditions, nowMs: number): SourceStatus | null {
  const s = launch.weatherSource;
  // Stored state can be anything; a stamp that does not read as one says nothing.
  if (!isWeatherSource(s)) return null;
  const edited =
    s.edited === true ||
    (s.applied !== undefined && sourceFields(s).some((k) => k in s.applied! && !same(launch[k], s.applied![k])));
  const otherSite =
    launch.latitudeDeg == null ||
    launch.longitudeDeg == null ||
    Math.abs(launch.latitudeDeg - s.latitudeDeg) > SAME_SITE_DEG ||
    Math.abs(launch.longitudeDeg - s.longitudeDeg) > SAME_SITE_DEG;
  const validMs = Date.parse(s.validAt);
  const old = s.endpoint === 'forecast' && validMs > nowMs && nowMs - Date.parse(s.fetchedAt) > STALE_AFTER_MS;
  return { edited, otherSite, old };
}

/**
 * A source read back from somewhere that does not keep `applied` (a file):
 * whether it was edited is what the file says, and the values in it now are
 * taken as the applied ones, so an edit made after opening is still seen.
 */
export function restoredSource(source: Omit<WeatherSource, 'applied'>, launch: LaunchConditions): WeatherSource {
  if (source.edited) return source;
  const applied: Partial<LaunchConditions> = {};
  const fields = sourceFields(source as WeatherSource);
  for (const k of fields) (applied as Record<string, unknown>)[k] = launch[k];
  return { ...source, applied };
}

/** Is `x` a usable source, from storage or a file? */
export function isWeatherSource(x: unknown): x is WeatherSource {
  if (!x || typeof x !== 'object') return false;
  const s = x as Record<string, unknown>;
  return (
    s['provider'] === 'open-meteo' &&
    (s['endpoint'] === 'forecast' || s['endpoint'] === 'archive') &&
    typeof s['date'] === 'string' &&
    Number.isInteger(s['hour']) &&
    typeof s['timezone'] === 'string' &&
    Number.isFinite(s['latitudeDeg']) &&
    Number.isFinite(s['longitudeDeg']) &&
    Number.isFinite(s['elevationM']) &&
    typeof s['validAt'] === 'string' &&
    !Number.isNaN(Date.parse(s['validAt'])) &&
    typeof s['fetchedAt'] === 'string' &&
    !Number.isNaN(Date.parse(s['fetchedAt'])) &&
    Array.isArray(s['groups']) &&
    (s['groups'] as unknown[]).every((g) => typeof g === 'string' && g in GROUP_FIELDS) &&
    typeof s['elevationApplied'] === 'boolean'
  );
}
