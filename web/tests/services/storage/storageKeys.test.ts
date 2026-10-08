// cspell:ignore astrarrocketjs -- the old misspelled prefix, named below where the legacy
// key and the kernel's patch marker are explained.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STORAGE_PREFIX, nsKey } from '../../../src/services/storage/storageKeys';

/**
 * One home for the storage namespace.
 *
 * Every key is built by `nsKey` from `STORAGE_PREFIX`, so no module can spell the
 * prefix differently and split the app across two namespaces.
 *
 * The prefix is also the package name and the product name, so it legitimately
 * appears in `package.json`, the docs, the page title and the manifest. What a file
 * can still get wrong by hand is a key, and a key is the prefix followed by a
 * colon, so that is what this looks for.
 */

const repo = (p: string) => fileURLToPath(new URL(`../../../../${p}`, import.meta.url));

/** What a storage key looks like, and the only form no file but one may spell. */
const KEY_FORM = `${STORAGE_PREFIX}:`;

/**
 * The only files permitted to spell a key, each for a stated reason.
 *
 * Nothing here is a key in the app. If a key needs adding, it goes through
 * `nsKey`, and this list does not change.
 */
const ALLOWED = new Set([
  // Holds the prefix.
  'web/src/services/storage/storageKeys.ts',
  // The one legacy read chain: a DEBUG switch quoted in the docs, so someone who
  // set it by hand is not asked to do it twice. It names the old misspelled
  // prefix, which does not match `KEY_FORM`, plus this comment.
  'web/src/engine/openRocketEngine.ts',
  // Plain .mjs harnesses: no TS loader, so they cannot import the constant. A
  // mismatch is self-detecting (the app comes up without settings and the check
  // fails), which is why a literal is tolerable here and nowhere else.
  'web/scripts/check-offline-data.mjs',
  'web/scripts/check-offline-help.mjs',
  'web/scripts/check-update-flow.mjs',
  // Documents that describe the namespace.
  'docs/ARCHITECTURE.md',
  // This test, and the audit and changelog that mention the prefix.
  'web/tests/services/storage/storageKeys.test.ts',
  'docs/AUDIT.md',
  'CHANGELOG.md',
]);

/** Every text file under the repo, skipping what is generated or vendored. */
const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    // `engine-java` is skipped deliberately: the kernel's patch marker tag is
    // `PATCH(astrarrocketjs)`, the old misspelling, in the patched sources and in
    // the extraction tooling that greps for it. It is not a storage key, and
    // renaming it would mean re-blessing every patched file.
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
    // The drift this guards against: one key under a different prefix.
    const prefixes = new Set(
      [nsKey('designs:index'), nsKey('settings:v1'), nsKey('engine')].map((k) => k.split(':')[0]),
    );
    expect([...prefixes]).toEqual([STORAGE_PREFIX]);
  });
});
