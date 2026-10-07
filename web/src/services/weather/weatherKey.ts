import { nsKey } from '../storage/storageKeys';

/**
 * The user's Open-Meteo API key, from a paid plan, or none for the free tier.
 *
 * Kept in its own entry in this browser, outside the settings object, so no
 * settings copy, saved design, `.ork` or crash file can carry it. Unreadable
 * storage (a private window, blocked site data) reads as no key, which is the
 * free tier.
 */
const KEY = nsKey('openmeteo:apikey');

export function readWeatherKey(): string | undefined {
  try {
    const v = localStorage.getItem(KEY)?.trim();
    return v ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Store `key`, or forget it when blank. Returns false when storage refused. */
export function writeWeatherKey(key: string): boolean {
  try {
    const v = key.trim();
    if (v) localStorage.setItem(KEY, v);
    else localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
