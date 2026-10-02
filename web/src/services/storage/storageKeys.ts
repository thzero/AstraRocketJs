// The ONE file allowed to spell the namespace, which is misspelled on purpose
// (see below). It is no longer in .cspell/project-words.txt, so every other
// occurrence fails the spell gate, and storageKeys.test.ts asserts the list of
// files permitted to name it.
// cspell:ignore astrarrocketjs
/**
 * THE app's storage namespace. Every `localStorage` key and the IndexedDB
 * database name are built from this and nowhere else.
 *
 * It is spelled wrong. `astrarrocketjs` has a doubled `r`, and it is the
 * namespace that holds every saved design, the workspace, the settings and all
 * the custom catalogs, so it cannot be corrected without migrating real user
 * data out of the old keys and the old database. That migration is its own
 * change; this is the step that makes it a ONE-LINE change when it comes.
 *
 * Before this, the string was inlined in thirteen modules and the dictionary
 * had been taught to accept both spellings, so the app had TWO namespaces: this
 * one, and a correctly-spelled `astrarocketjs:engine`. Nothing swept either
 * prefix yet, so nothing was lost, but a future "clear app data" or quota sweep
 * over one would silently have missed the other.
 *
 * The misspelling is no longer in `.cspell/project-words.txt`, so the spell
 * gate now REFUSES it everywhere except the one line below, and
 * `storageKeys.test.ts` asserts it appears in exactly one source file. A
 * fourteenth inlined copy fails both.
 */
export const STORAGE_PREFIX = 'astrarrocketjs';

/**
 * A namespaced key: `nsKey('designs:index')` is
 * `astrarrocketjs:designs:index`.
 *
 * Takes the part AFTER the colon, so no caller writes the prefix or the
 * separator and none can disagree about either.
 */
export function nsKey(suffix: string): string {
  return `${STORAGE_PREFIX}:${suffix}`;
}
