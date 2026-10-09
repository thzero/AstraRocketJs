// cspell:ignore astrarrocketjs -- a misspelled prefix, named below; it is not a key.
/**
 * The app's storage namespace. Every `localStorage` key and the IndexedDB
 * database name are built from this and nowhere else.
 *
 * Nothing is migrated from the misspelled `astrarrocketjs` prefix (doubled `r`):
 * anything still stored under it is not read.
 *
 * `storageKeys.test.ts` holds the one-home property: no file but this one spells
 * a key, which is this prefix followed by a colon. The bare project name is free
 * to appear anywhere - it is the package name and the product name - and only the
 * `prefix:` form is a storage key.
 */
export const STORAGE_PREFIX = 'astrarocketjs';

/**
 * A namespaced key: `nsKey('designs:index')` is `astrarocketjs:designs:index`.
 *
 * Takes the part after the colon, so no caller writes the prefix or the
 * separator and none can disagree about either.
 */
export function nsKey(suffix: string): string {
  return `${STORAGE_PREFIX}:${suffix}`;
}
