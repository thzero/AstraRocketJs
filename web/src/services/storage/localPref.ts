/**
 * A small preference kept in localStorage as JSON, read and written without
 * throwing: localStorage throws in a private window with site data blocked, and
 * a preference that cannot be read or saved is never a reason to fail.
 *
 * The read takes a shape check, because the value is hand-editable and written
 * by older and newer builds alike: a value of the wrong shape is the fallback,
 * never trusted as the type the caller wanted.
 */
export function readLocalJson<T>(key: string, valid: (v: unknown) => v is T, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const v: unknown = JSON.parse(raw);
    return valid(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

/** Save a JSON preference. False when storage refused it. */
export function writeLocalJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
