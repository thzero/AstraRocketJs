// cspell:ignore astrarrocketjs -- the OLD spelling, named where the rename and the
// kernel's patch-marker collision are explained.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STORAGE_PREFIX, nsKey } from '../../../src/services/storage/storageKeys';

/**
 * One home for the storage namespace.
 *
 * The prefix was inlined in thirteen source modules, twenty test files and the
 * e2e harness, it was MISSPELLED (`astrarrocketjs`, doubled `r`), and the
 * dictionary had been taught to accept the misspelling - so nothing noticed that
 * one key, `ENGINE_PREF_KEY`, used a different, correctly-spelled prefix. The app
 * had two namespaces.
 *
 * Both hazards are closed: one owner, and the spelling corrected in 0.1.0 preview
 * with no migration, because the only data under the old prefix was scratch.
 *
 * The guard had to change shape with the rename. While the prefix was a typo, "the
 * string appears in exactly these files" was a usable test. Spelled correctly it
 * is the package name and the product name, so it legitimately appears in
 * `package.json`, the docs, the page title and the manifest. What a file can still
 * get wrong by hand is a KEY, and a key is the prefix followed by a colon - so that
 * is what this looks for.
 */

const repo = (p: string) => fileURLToPath(new URL(`../../../../${p}`, import.meta.url));

/** What a storage key looks like, and the only form no file but one may spell. */
const KEY_FORM = `${STORAGE_PREFIX}:`;

/**
 * The only files permitted to spell a key, each for a stated reason.
 *
 * Nothing here is a key in the app. If a KEY needs adding, it goes through
 * `nsKey`, and this list does not change.
 */
const ALLOWED = new Set([
  // Holds the prefix.
  'web/src/services/storage/storageKeys.ts',
  // The one legacy read chain: a DEBUG switch quoted in the docs, so someone who
  // set it by hand is not asked to do it twice. It names the OLD prefix, which no
  // longer matches `KEY_FORM`, plus this comment.
  'web/src/engine/openRocketEngine.ts',
  // Plain .mjs harnesses: no TS loader, so they cannot import the constant. A
  // mismatch is self-detecting (the app comes up without settings and the check
  // fails), which is why a literal is tolerable here and nowhere else.
  'web/scripts/check-offline-data.mjs',
  'web/scripts/check-offline-help.mjs',
  'web/scripts/check-update-flow.mjs',
  // Documents that describe the namespace.
  'docs/ARCHITECTURE.md',
  // This test, and the audit and changelog that record the rename.
  'web/tests/services/storage/storageKeys.test.ts',
  'docs/AUDIT.md',
  'CHANGELOG.md',
]);

/** Every text file under the repo, skipping what is generated or vendored. */
const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    // `engine-java` is skipped, and not as a convenience: the kernel's patch
    // marker tag is `PATCH(astrarrocketjs)`, the OLD misspelling, in 25 patched
    // sources and in the extraction tooling that greps for it. It is a different
    // thing that happened to share a spelling with the typo, it is not a storage
    // key, and renaming it would mean re-blessing every patched file. Left alone
    // deliberately. (That the project named its patch marker after the typo too is
    // its own small story.)
    if (
      [
        'node_modules',
        '.git',
        'dist',
        'build',
        'coverage',
        'vendor',
        'public',
        '.docusaurus',
        'test-results',
        'engine-java',
      ].includes(entry)
    )
      continue;
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js|json|md|ya?ml)$/.test(entry)) out.push(full);
  }
  return out;
};

describe('the storage namespace has one home', () => {
  it('builds a key from the prefix and a suffix', () => {
    expect(nsKey('designs:index')).toBe(`${STORAGE_PREFIX}:designs:index`);
    // The caller supplies neither the prefix nor the separator, so two callers
    // cannot disagree about either.
    expect(nsKey('workspace')).toBe(`${STORAGE_PREFIX}:workspace`);
  });

  it('is spelled correctly, which is the whole point of the rename', () => {
    // Pinned as a literal on purpose. This is the one assertion in the file that
    // does not derive from `STORAGE_PREFIX`, because deriving it would pass for
    // any spelling at all.
    expect(STORAGE_PREFIX).toBe('astrarocketjs');
  });

  it('spells a KEY in no file but the ones allowed to', () => {
    const root = repo('').replace(/\/$/, '');
    const offenders = walk(root)
      .filter((f) => readFileSync(f, 'utf8').includes(KEY_FORM))
      .map((f) => f.slice(root.length + 1))
      .filter((rel) => !ALLOWED.has(rel))
      .sort();
    expect(offenders).toEqual([]);
  });

  it('keeps every key on one namespace', () => {
    // The specific drift this closed: one key under a different prefix.
    const prefixes = new Set(
      [nsKey('designs:index'), nsKey('settings:v1'), nsKey('engine')].map((k) => k.split(':')[0]),
    );
    expect([...prefixes]).toEqual([STORAGE_PREFIX]);
  });
});
