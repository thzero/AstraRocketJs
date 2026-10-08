import { WeatherError } from './openMeteo';

type Translate = (key: string, opts?: Record<string, unknown>) => string;

/** Refusals that are about the date, each with its own explanation. */
const DATE_REFUSALS = new Set(['tooFarAhead', 'tooEarly', 'badDate']);

/**
 * What to tell the user when a weather request fails: a refused date in its own
 * words, any other WeatherError by kind, and anything else by `fallbackKey`
 * (offline, unless the caller's own work could have failed too). One copy, so no
 * view can drop a branch and show a refused date as a generic error.
 */
export function weatherErrorText(err: unknown, t: Translate, fallbackKey = 'weather.error.offline'): string {
  if (!(err instanceof WeatherError)) return t(fallbackKey);
  if (err.kind === 'refused' && err.detail && DATE_REFUSALS.has(err.detail)) {
    return t(`weather.dateRefusal.${err.detail}`);
  }
  return t(`weather.error.${err.kind}`, { detail: err.detail ?? '' });
}
