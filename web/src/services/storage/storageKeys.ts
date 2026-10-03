// cspell:ignore astrarrocketjs -- the OLD spelling, named twice below so the
// rename is explicable. It is not a key any more.
/**
 * THE app's storage namespace. Every `localStorage` key and the IndexedDB
 * database name are built from this and nowhere else.
 *
 * Spelled correctly. It was `astrarrocketjs`, with a doubled `r`, inlined across
 * thirteen modules with the dictionary taught to accept both spellings - so the
 * app had TWO namespaces, seventeen keys under the typo and one correctly-spelled
 * `astrarocketjs:engine`. Both are now this one.
 *
 * NO MIGRATION. The correction was made in 0.1.0 preview, where the only data
 * under the old prefix is a developer's or a preview user's scratch design.
 * Anything still sitting under `astrarrocketjs` is simply not read any more.
 *
 * `storageKeys.test.ts` holds the one-home property: no file but this one spells
 * a KEY, which is this prefix followed by a colon. The bare project name is free
 * to appear anywhere - it is the package name and the product name - and only the
 * `prefix:` form is a storage key.
 */
export const STORAGE_PREFIX = 'astrarocketjs';

/**
 * A namespaced key: `nsKey('designs:index')` is `astrarocketjs:designs:index`.
 *
 * Takes the part AFTER the colon, so no caller writes the prefix or the
 * separator and none can disagree about either.
 */
export function nsKey(suffix: string): string {
  return `${STORAGE_PREFIX}:${suffix}`;
}
