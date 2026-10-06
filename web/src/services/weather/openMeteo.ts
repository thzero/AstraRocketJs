/**
 * Open-Meteo: the weather for one launch site at one hour, as launch conditions.
 *
 * Requests go from the user's browser straight to Open-Meteo, through a
 * sandboxed frame (`anonymousGet`) so that they carry no `Origin` but `null`
 * and no `Referer`: nothing in them names this app or the site serving it.
 * There is no key, account, proxy or server of this app's in between. Without a key the free
 * tier answers, which Open-Meteo allows for non-commercial use. With a key from
 * a paid plan the same requests go to its `customer-` hosts with `apikey`.
 *
 * The data is CC BY 4.0: the dialog shows the credit wherever it shows values.
 *
 * What is asked for, and why:
 *  - An ELEVATION is always sent. Without one, Open-Meteo answers for its terrain
 *    model's height of the grid cell, and the surface pressure is for that
 *    height, not the pad's. See `requestElevations`.
 *  - `surface_pressure`, the pressure AT that elevation, never `pressure_msl`.
 *  - `timeformat=unixtime` with `timezone=auto`; local times are made here with
 *    `Intl`, because the answer's `utc_offset_seconds` is today's offset stamped
 *    on every hour, even across a daylight saving change.
 *  - Units are requested explicitly and every unit in the answer is checked. A
 *    km/h wind read as m/s is 3.6 times the wind and nothing downstream could
 *    tell.
 */

import { anonymousGet } from './anonymousFetch';
import { isFiniteNumber, roundTo } from '../app/numbers';

// --------------------------------------------------------------- endpoints

const FREE = { forecast: 'https://api.open-meteo.com', archive: 'https://archive-api.open-meteo.com' } as const;
const PAID = {
  forecast: 'https://customer-api.open-meteo.com',
  archive: 'https://customer-archive-api.open-meteo.com',
} as const;

/** Each request's own deadline. Open-Meteo answers in well under a second. */
const REQUEST_TIMEOUT_MS = 12_000;

/**
 * Least time between two weather requests. One request asks for about a hundred
 * variables, which Open-Meteo counts as several calls, so this keeps a busy
 * user under the free tier's hourly limit. Desktop OpenRocket's client spaces
 * them the same way.
 */
const REQUEST_SPACING_MS = 5_000;

/**
 * How long an answer is reused for the same request. The fastest model behind
 * a forecast publishes a new run once an hour, so a fetch within half an hour
 * of the last rarely has anything new to bring; `force` asks anyway.
 */
const CACHE_TTL_MS = 30 * 60 * 1000;

/** The forecast endpoint's reach either side of today, in days. */
const FORECAST_DAYS_BACK = 92;
const FORECAST_DAYS_AHEAD = 15;
/** The archive (ERA5 reanalysis) starts here. */
const ARCHIVE_FIRST_DATE = '1940-01-01';

/** Site and terrain within this many meters are the same pad (a 90 m terrain model). */
const ELEVATION_AGREE_M = 30;

/** Surface variables; the archive has these too. */
export const SURFACE_VARS = [
  'temperature_2m',
  'relative_humidity_2m',
  'surface_pressure',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
] as const;

/** Wind heights above ground the forecast reports, in meters. */
const WIND_HEIGHTS = [80, 120, 180] as const;

/** Open-Meteo's pressure levels, hPa, the same 19 desktop OpenRocket asks for. */
export const PRESSURE_LEVELS = [
  1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100, 70, 50, 30,
] as const;

/** Forecast-only variables: winds aloft and the atmosphere at each pressure level. */
export const ALOFT_VARS = [
  ...WIND_HEIGHTS.flatMap((h) => [`wind_speed_${h}m`, `wind_direction_${h}m`]),
  ...PRESSURE_LEVELS.flatMap((p) => [
    `temperature_${p}hPa`,
    `relative_humidity_${p}hPa`,
    `wind_speed_${p}hPa`,
    `wind_direction_${p}hPa`,
    `geopotential_height_${p}hPa`,
  ]),
];

/** The unit every variable must arrive in, by its name. */
export function unitFor(variable: string): string {
  if (variable === 'time') return 'unixtime';
  if (variable.startsWith('temperature_')) return '°C';
  if (variable.startsWith('relative_humidity_')) return '%';
  if (variable === 'surface_pressure') return 'hPa';
  if (variable.startsWith('wind_direction_')) return '°';
  if (variable.startsWith('wind_')) return 'm/s';
  if (variable.startsWith('geopotential_height_')) return 'm';
  throw new Error(`no unit known for ${variable}`);
}

// ------------------------------------------------------------------- dates

/**
 * An instant's date parts in `timeZone`, or in the browser's own zone when
 * `timeZone` is absent or one Intl does not know.
 */
function partsInZone(
  ms: number,
  timeZone: string | undefined,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormatPart[] {
  const fmt = (tz: string | undefined) =>
    new Intl.DateTimeFormat('en-US', { ...options, timeZone: tz }).formatToParts(new Date(ms));
  try {
    return fmt(timeZone);
  } catch {
    return fmt(undefined);
  }
}

/** "YYYY-MM-DD" of an instant on the calendar of `timeZone` (the browser's own when absent or unknown). */
export function ymdInZone(ms: number, timeZone: string | undefined): string {
  const parts = partsInZone(ms, timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' });
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Today on the browser's calendar, as "YYYY-MM-DD". */
export const todayYmd = (): string => ymdInZone(Date.now(), undefined);

/** An hour from now: the default forecast time, so the hour picked is not already past. */
export const nextHourMs = (): number => Date.now() + 3_600_000;

/** The hour (0 to 23) of an instant on the calendar of `timeZone`. */
export function hourInZone(ms: number, timeZone: string | undefined): number {
  const parts = partsInZone(ms, timeZone, { hour: '2-digit', hourCycle: 'h23' });
  return Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const m = YMD.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? { y, m: mo, d } : null;
}

/** `ymd` moved by `days` calendar days. */
function addDaysYmd(ymd: string, days: number): string {
  const p = parseYmd(ymd);
  if (!p) return ymd;
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export type Endpoint = 'forecast' | 'archive';
export type DateRefusalReason = 'tooFarAhead' | 'tooEarly' | 'badDate';

export type DateWindow =
  { ok: true; endpoint: Endpoint; startDate: string; endDate: string } | { ok: false; reason: DateRefusalReason };

/**
 * Which endpoint answers for `date`, and the dates to ask it for: the day
 * either side as well, clamped to the endpoint's reach, so every hour of the
 * site's calendar day is in the answer whatever the zone. Both dates are on the
 * site's calendar, as is `today`.
 */
export function planDateWindow(date: string, today: string): DateWindow {
  if (!parseYmd(date) || !parseYmd(today)) return { ok: false, reason: 'badDate' };
  const last = addDaysYmd(today, FORECAST_DAYS_AHEAD);
  const firstForecast = addDaysYmd(today, -FORECAST_DAYS_BACK);
  if (date > last) return { ok: false, reason: 'tooFarAhead' };
  const later = (a: string, b: string) => (a > b ? a : b);
  const earlier = (a: string, b: string) => (a < b ? a : b);
  if (date >= firstForecast) {
    return {
      ok: true,
      endpoint: 'forecast',
      startDate: later(addDaysYmd(date, -1), firstForecast),
      endDate: earlier(addDaysYmd(date, 1), last),
    };
  }
  if (date < ARCHIVE_FIRST_DATE) return { ok: false, reason: 'tooEarly' };
  const lastArchive = addDaysYmd(firstForecast, -1);
  return {
    ok: true,
    endpoint: 'archive',
    startDate: later(addDaysYmd(date, -1), ARCHIVE_FIRST_DATE),
    endDate: earlier(addDaysYmd(date, 1), lastArchive),
  };
}

// -------------------------------------------------------------------- URLs

/** Coordinates to 3 decimals (about 100 m), finer than any grid answering. */
const dp3 = (x: number) => x.toFixed(3);
/** An elevation to 0.1 m; the answer echoes it and is checked against it. */
const elev = (m: number) => String(roundTo(m, 1));

const keyParam = (apiKey: string | undefined) => (apiKey ? `&apikey=${encodeURIComponent(apiKey)}` : '');

/**
 * The forecast or archive request: one place at one or two elevations, a
 * three-day window. Two elevations ask for the same point twice, which
 * Open-Meteo answers as an array in request order.
 */
export function forecastUrl(q: {
  endpoint: Endpoint;
  latitudeDeg: number;
  longitudeDeg: number;
  elevationsM: readonly number[];
  startDate: string;
  endDate: string;
  apiKey?: string;
}): string {
  const host = (q.apiKey ? PAID : FREE)[q.endpoint];
  const path = q.endpoint === 'archive' ? '/v1/archive' : '/v1/forecast';
  const n = q.elevationsM.length;
  const rep = (s: string) => Array.from({ length: n }, () => s).join(',');
  const vars = [...SURFACE_VARS, ...(q.endpoint === 'archive' ? [] : ALOFT_VARS)];
  return (
    `${host}${path}?latitude=${rep(dp3(q.latitudeDeg))}&longitude=${rep(dp3(q.longitudeDeg))}` +
    `&elevation=${q.elevationsM.map(elev).join(',')}` +
    `&hourly=${vars.join(',')}` +
    '&wind_speed_unit=ms&temperature_unit=celsius&timeformat=unixtime&timezone=auto' +
    `&start_date=${q.startDate}&end_date=${q.endDate}${keyParam(q.apiKey)}`
  );
}

/** The terrain model's ground height at a point. */
function elevationUrl(latitudeDeg: number, longitudeDeg: number, apiKey?: string): string {
  return `${(apiKey ? PAID : FREE).forecast}/v1/elevation?latitude=${dp3(latitudeDeg)}&longitude=${dp3(longitudeDeg)}${keyParam(apiKey)}`;
}

// ------------------------------------------------------------------ errors

export type WeatherErrorKind =
  'offline' | 'timeout' | 'aborted' | 'refused' | 'badKey' | 'quota' | 'http' | 'shape' | 'units' | 'noData';

/** A failed lookup. `detail` is Open-Meteo's own words or the offending value, when there are any. */
export class WeatherError extends Error {
  readonly kind: WeatherErrorKind;
  readonly detail: string | undefined;
  constructor(kind: WeatherErrorKind, detail?: string) {
    super(detail ? `${kind}: ${detail}` : kind);
    this.name = 'WeatherError';
    this.kind = kind;
    this.detail = detail;
  }
}

// ------------------------------------------------------------------ parsing

/** One pressure level at one hour. Null is MISSING, never zero. */
export interface PressureLevelSample {
  pressureHPa: number;
  /** Geopotential height, which for a rocket's purposes is meters above sea level. */
  altitudeM: number | null;
  temperatureC: number | null;
  humidityPct: number | null;
  windSpeed: number | null;
  windFromDeg: number | null;
}

/** One hour of one elevation's answer. Null is MISSING, never zero. */
export interface HourSample {
  unix: number;
  temperatureC: number | null;
  humidityPct: number | null;
  pressureHPa: number | null;
  windSpeed: number | null;
  /** The strongest gust in the hour BEFORE `unix`. */
  windGust: number | null;
  /** Where the 10 m wind blows FROM, compass degrees, as the kernel takes it. */
  windFromDeg: number | null;
  /** Wind at 80, 120 and 180 m above ground; empty from the archive. */
  heightWinds: { heightM: number; speed: number | null; fromDeg: number | null }[];
  /** Empty from the archive. */
  levels: PressureLevelSample[];
}

/** One elevation's answer. */
export interface ForecastVariant {
  /** The elevation asked for, as the answer echoed it (m). */
  elevationM: number;
  /** The site's IANA zone, from `timezone=auto`. */
  timezone: string | null;
  samples: HourSample[];
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const finiteOrNull = (x: unknown): number | null => (isFiniteNumber(x) ? x : null);

/** Open-Meteo's own refusal, `{"error": true, "reason": "..."}`, or null. */
function refusalReason(body: unknown): string | null {
  const one = Array.isArray(body) ? body[0] : body;
  return isObj(one) && one['error'] === true
    ? typeof one['reason'] === 'string'
      ? one['reason']
      : 'no reason given'
    : null;
}

/**
 * A forecast or archive answer, checked: an array with one element per
 * requested elevation, or a single object for one.
 *
 * Throws `WeatherError`: `refused` for Open-Meteo's error body, `units` for a
 * variable in another unit than asked, `shape` for a wrong element count, a
 * ragged series or an elevation that does not echo the one asked for, and
 * `noData` when nothing at all came back for the surface.
 */
export function parseForecast(body: unknown, elevationsM: readonly number[]): ForecastVariant[] {
  const reason = refusalReason(body);
  if (reason !== null) throw new WeatherError('refused', reason);
  const items = Array.isArray(body) ? body : [body];
  if (items.length !== elevationsM.length) {
    throw new WeatherError('shape', `${items.length} answers for ${elevationsM.length} elevations`);
  }
  let anyValue = false;
  const variants = items.map((item, i): ForecastVariant => {
    if (!isObj(item) || !isObj(item['hourly_units']) || !isObj(item['hourly'])) {
      throw new WeatherError('shape', 'no hourly data');
    }
    const units = item['hourly_units'];
    const h = item['hourly'];
    for (const v of ['time', ...SURFACE_VARS]) {
      if (units[v] !== unitFor(v)) throw new WeatherError('units', `${v} in ${String(units[v] ?? 'no unit')}`);
    }
    const e = finiteOrNull(item['elevation']);
    if (e === null || Math.abs(e - elevationsM[i]!) > 0.5) {
      throw new WeatherError('shape', `answered for ${e ?? 'no'} m, not ${elevationsM[i]!} m`);
    }
    const time = h['time'];
    if (!Array.isArray(time) || time.some((t) => finiteOrNull(t) === null)) {
      throw new WeatherError('shape', 'no usable hours');
    }
    /** A whole series, checked for length; a variable the answer lacks reads as all missing. */
    const series = (v: string, required: boolean): (number | null)[] => {
      const a = h[v];
      if (a === undefined && !required) return time.map(() => null);
      if (!Array.isArray(a) || a.length !== time.length)
        throw new WeatherError('shape', `${v} does not match its hours`);
      if (units[v] !== unitFor(v)) throw new WeatherError('units', `${v} in ${String(units[v] ?? 'no unit')}`);
      return a.map(finiteOrNull);
    };
    const s = Object.fromEntries(SURFACE_VARS.map((v) => [v, series(v, true)])) as Record<
      (typeof SURFACE_VARS)[number],
      (number | null)[]
    >;
    const aloft = new Map<string, (number | null)[]>();
    for (const v of ALOFT_VARS) if (h[v] !== undefined) aloft.set(v, series(v, false));
    const at = (v: string, j: number) => aloft.get(v)?.[j] ?? null;
    const samples = (time as number[]).map((unix, j): HourSample => {
      const sample: HourSample = {
        unix,
        temperatureC: s.temperature_2m[j]!,
        humidityPct: s.relative_humidity_2m[j]!,
        pressureHPa: s.surface_pressure[j]!,
        windSpeed: s.wind_speed_10m[j]!,
        windGust: s.wind_gusts_10m[j]!,
        windFromDeg: s.wind_direction_10m[j]!,
        heightWinds: aloft.size
          ? WIND_HEIGHTS.map((m) => ({
              heightM: m,
              speed: at(`wind_speed_${m}m`, j),
              fromDeg: at(`wind_direction_${m}m`, j),
            }))
          : [],
        levels: aloft.size
          ? PRESSURE_LEVELS.map((p) => ({
              pressureHPa: p,
              altitudeM: at(`geopotential_height_${p}hPa`, j),
              temperatureC: at(`temperature_${p}hPa`, j),
              humidityPct: at(`relative_humidity_${p}hPa`, j),
              windSpeed: at(`wind_speed_${p}hPa`, j),
              windFromDeg: at(`wind_direction_${p}hPa`, j),
            }))
          : [],
      };
      if (sample.temperatureC !== null || sample.pressureHPa !== null || sample.windSpeed !== null) anyValue = true;
      return sample;
    });
    return { elevationM: e, timezone: typeof item['timezone'] === 'string' ? item['timezone'] : null, samples };
  });
  if (!anyValue) throw new WeatherError('noData');
  return variants;
}

/** The terrain model's ground height from an elevation answer, to 1 m, or null. */
/** Most points one elevation request carries; Open-Meteo refuses more. */
const ELEVATION_BATCH = 100;

/** The terrain heights for several points, in request order, as an elevation answer gives them. */
function parseElevations(body: unknown, count: number): number[] | null {
  if (!isObj(body) || !Array.isArray(body['elevation']) || body['elevation'].length !== count) return null;
  const out = body['elevation'].map(finiteOrNull);
  return out.every((e): e is number => e !== null) ? out : null;
}

function parseElevation(body: unknown): number | null {
  if (!isObj(body) || !Array.isArray(body['elevation'])) return null;
  const e = finiteOrNull(body['elevation'][0]);
  return e === null ? null : Math.round(e);
}

/**
 * The elevations to ask the forecast for. The site altitude the flight flies is
 * always one; the terrain model's ground height is the other when the two
 * disagree by more than the model's own noise, so the dialog can offer it.
 */
export function requestElevations(siteM: number, terrainM: number | null): number[] {
  if (terrainM === null || Math.abs(siteM - terrainM) <= ELEVATION_AGREE_M) return [siteM];
  return [siteM, terrainM];
}

// ---------------------------------------------------------------- fetching

export interface FetchOpts {
  signal?: AbortSignal;
  /** Injected in tests; the browser's fetch otherwise. */
  fetchImpl?: typeof fetch;
  /** Injected in tests; real time otherwise. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Ask Open-Meteo even when a reusable answer is held, and hold the new one. */
  force?: boolean;
}

/**
 * No browser cache (a stale forecast served as fresh is the worst failure
 * here), no cookies, no referrer. Used only by an injected `fetchImpl`; the
 * app's own requests go through `anonymousGet`, which also drops the origin.
 */
const REQUEST: RequestInit = { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' };

/**
 * How a request without an injected `fetchImpl` is made. The sandboxed frame,
 * so that nothing in the request names this app or its site; replaced only by
 * tests, whose DOM does not run the frame's script.
 */
let transport: ((url: string, signal: AbortSignal) => Promise<{ status: number; text: string }>) | null = null;

/** Route requests through `fetchImpl` instead of the sandboxed frame, or back with null. A test seam. */
export function setWeatherTransport(fetchImpl: typeof fetch | null): void {
  transport = fetchImpl
    ? async (url, signal) => {
        const res = await fetchImpl(url, { ...REQUEST, signal });
        return { status: res.status, text: await res.text() };
      }
    : null;
}

async function getJson(url: string, o: FetchOpts): Promise<{ status: number; json: unknown }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort('timeout'), REQUEST_TIMEOUT_MS);
  const onAbort = () => ctl.abort('aborted');
  o.signal?.addEventListener('abort', onAbort);
  try {
    if (o.signal?.aborted) throw new WeatherError('aborted');
    let status: number;
    let text: string;
    if (o.fetchImpl) {
      const res = await o.fetchImpl(url, { ...REQUEST, signal: ctl.signal });
      status = res.status;
      text = await res.text();
    } else {
      ({ status, text } = await (transport ?? anonymousGet)(url, ctl.signal));
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status, json };
  } catch (err) {
    if (err instanceof WeatherError) throw err;
    if (ctl.signal.aborted) throw new WeatherError(ctl.signal.reason === 'timeout' ? 'timeout' : 'aborted');
    throw new WeatherError('offline');
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener('abort', onAbort);
  }
}

/** A non-2xx answer as a `WeatherError`, in Open-Meteo's words where it gave any. */
function httpError(status: number, json: unknown): WeatherError {
  const reason =
    refusalReason(json) ?? (isObj(json) && typeof json['reason'] === 'string' ? json['reason'] : undefined);
  if (status === 401 || status === 403) return new WeatherError('badKey', reason);
  if (status === 429) return new WeatherError('quota', reason);
  if (status === 400) return new WeatherError('refused', reason);
  return new WeatherError('http', `${status}${reason ? `: ${reason}` : ''}`);
}

/** Successful answers, by URL, reused for `CACHE_TTL_MS`. */
const answers = new Map<string, { at: number; value: unknown }>();
let nextSlot = 0;

/** Forget reused answers and the request spacing. A test seam over this module's state; the app never needs it. */
export function resetWeatherState(): void {
  answers.clear();
  nextSlot = 0;
}

async function cached<T>(url: string, o: FetchOpts, load: () => Promise<T>): Promise<T> {
  const now = o.now ?? Date.now;
  const hit = answers.get(url);
  if (hit && !o.force && now() - hit.at < CACHE_TTL_MS) return hit.value as T;
  const value = await load();
  answers.set(url, { at: now(), value });
  return value;
}

/** Wait for this request's turn under `REQUEST_SPACING_MS`. */
async function spaced(o: FetchOpts): Promise<void> {
  const now = (o.now ?? Date.now)();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + REQUEST_SPACING_MS;
  if (slot > now) await (o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(slot - now);
  if (o.signal?.aborted) throw new WeatherError('aborted');
}

/** The terrain height, or null on any failure but a cancel: it is advice, not data. */
export async function fetchElevation(
  latitudeDeg: number,
  longitudeDeg: number,
  apiKey: string | undefined,
  o: FetchOpts = {},
): Promise<number | null> {
  const url = elevationUrl(latitudeDeg, longitudeDeg, apiKey);
  try {
    return await cached(url, o, async () => {
      const a = await getJson(url, o);
      const e = a.status >= 200 && a.status < 300 ? parseElevation(a.json) : null;
      if (e === null) throw new WeatherError('shape', 'no elevation');
      return e;
    });
  } catch (err) {
    if (err instanceof WeatherError && err.kind === 'aborted') throw err;
    return null;
  }
}

/**
 * The terrain model's ground height at many points (meters above sea level),
 * in batches of `ELEVATION_BATCH`. Throws `WeatherError` when any batch fails:
 * a ground surface with holes in it is not one to land a rocket on.
 */
export async function fetchElevations(
  points: readonly { latitudeDeg: number; longitudeDeg: number }[],
  apiKey: string | undefined,
  o: FetchOpts = {},
): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < points.length; i += ELEVATION_BATCH) {
    const batch = points.slice(i, i + ELEVATION_BATCH);
    const url =
      `${(apiKey ? PAID : FREE).forecast}/v1/elevation?latitude=${batch.map((p) => dp3(p.latitudeDeg)).join(',')}` +
      `&longitude=${batch.map((p) => dp3(p.longitudeDeg)).join(',')}${keyParam(apiKey)}`;
    const heights = await cached(url, o, async () => {
      const a = await getJson(url, o);
      if (a.status < 200 || a.status >= 300) throw httpError(a.status, a.json);
      const e = parseElevations(a.json, batch.length);
      if (!e) throw new WeatherError('shape', 'elevation');
      return e;
    });
    out.push(...heights);
  }
  return out;
}

/** Everything one Fetch brings back. */
export interface WeatherAnswer {
  endpoint: Endpoint;
  /** The site-calendar date asked about. */
  date: string;
  /** The terrain model's ground height, or null when it could not be had. */
  terrainM: number | null;
  /** The elevations asked for; `variants` matches it index for index. */
  elevationsM: number[];
  variants: ForecastVariant[];
  /** The site's zone: the answer's own, else the browser's. */
  timezone: string;
  /** When Open-Meteo answered (ms since the epoch); a reused answer keeps its own time. */
  fetchedAtMs: number;
  /** The answer was held from an earlier fetch rather than asked for now. */
  reused: boolean;
}

/**
 * One Fetch: the date checked first (a refused date costs no request), then the
 * terrain height, then one forecast request at the elevation(s)
 * `requestElevations` picks.
 */
export async function fetchWeather(
  q: { latitudeDeg: number; longitudeDeg: number; siteM: number; date: string; today: string; apiKey?: string },
  o: FetchOpts = {},
): Promise<WeatherAnswer> {
  const w = planDateWindow(q.date, q.today);
  if (!w.ok) throw new WeatherError('refused', w.reason);
  const terrainM = await fetchElevation(q.latitudeDeg, q.longitudeDeg, q.apiKey, o);
  const elevationsM = requestElevations(q.siteM, terrainM);
  const url = forecastUrl({
    endpoint: w.endpoint,
    latitudeDeg: q.latitudeDeg,
    longitudeDeg: q.longitudeDeg,
    elevationsM,
    startDate: w.startDate,
    endDate: w.endDate,
    apiKey: q.apiKey,
  });
  let asked = false;
  const { variants, fetchedAtMs } = await cached(url, o, async () => {
    asked = true;
    await spaced(o);
    const a = await getJson(url, o);
    if (a.status < 200 || a.status >= 300) throw httpError(a.status, a.json);
    return { variants: parseForecast(a.json, elevationsM), fetchedAtMs: (o.now ?? Date.now)() };
  });
  const timezone = variants[0]?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return { endpoint: w.endpoint, date: q.date, terrainM, elevationsM, variants, timezone, fetchedAtMs, reused: !asked };
}

/** The sample for `hour` (0 to 23) of `date` on the site's calendar, or null. */
export function sampleAt(variant: ForecastVariant, timezone: string, date: string, hour: number): HourSample | null {
  return (
    variant.samples.find(
      (s) => ymdInZone(s.unix * 1000, timezone) === date && hourInZone(s.unix * 1000, timezone) === hour,
    ) ?? null
  );
}

/**
 * The hours a launch-window spread takes, relative to the chosen forecast hour:
 * two either side of it, the chosen hour included.
 */
export const HOUR_OFFSETS = [-2, -1, 0, 1, 2] as const;

/** The sample for the hour starting at `unix` (seconds), or null. */
export function sampleAtUnix(variant: ForecastVariant, unix: number): HourSample | null {
  return variant.samples.find((s) => s.unix === unix) ?? null;
}
