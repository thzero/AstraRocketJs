// Names the misspelled namespace once, in the comment explaining the engine's
// marker-tag collision. The value itself comes from STORAGE_PREFIX.
// cspell:ignore astrarrocketjs
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STORAGE_PREFIX, nsKey } from '../../../src/services/storage/storageKeys';

/**
 * One home for the storage namespace.
 *
 * The prefix was inlined in thirteen source modules, twenty test files and the
 * e2e harness, and the dictionary had been taught to accept it, so nothing
 * noticed that one key (`ENGINE_PREF_KEY`) used a DIFFERENT, correctly-spelled
 * prefix. The app had two namespaces. Nothing sweeps either prefix today so
 * nothing was lost, but a "clear app data" or a quota sweep over one would have
 * silently missed the other.
 *
 * Two gates now hold it. The misspelling is out of `.cspell/project-words.txt`,
 * so `npm run spell` refuses it anywhere without an explicit directive; and
 * this test enumerates the files allowed to carry one, so adding a directive is
 * not enough on its own.
 */

const repo = (p: string) => fileURLToPath(new URL(`../../../../${p}`, import.meta.url));

/**
 * The only files permitted to spell the prefix, each for a stated reason.
 *
 * Nothing here is a storage key. If a KEY needs adding, it goes through
 * `nsKey`, and this list does not change.
 */
const ALLOWED = new Set([
  // Holds it.
  'web/src/services/storage/storageKeys.ts',
  // Plain .mjs harnesses: no TS loader, so they cannot import the constant. A
  // mismatch is self-detecting (the app comes up without settings and the check
  // fails), which is why a literal is tolerable here and nowhere else.
  'web/scripts/check-offline-data.mjs',
  'web/scripts/check-offline-help.mjs',
  'web/scripts/check-update-flow.mjs',
  // Documents that describe the namespace, or quote the engine's marker tag.
  'docs/ARCHITECTURE.md',
  'docs/AUDIT_ENGINE.md',
  // This test, and the audit that found it.
  'web/tests/services/storage/storageKeys.test.ts',
  'docs/AUDIT.md',
  'CHANGELOG.md',
]);

/** Every text file under the repo, skipping what is generated or vendored. */
const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    // `engine-java` is skipped, and not as a convenience: the same string is
    // the kernel's `PATCH(astrarrocketjs)` MARKER TAG, which appears in 25
    // patched sources and in the extraction tooling that greps for it. It is a
    // different thing that happens to share the spelling, it is not a storage
    // key, and it is not this test's business. (That the project named its
    // patch marker after the typo too is its own small story.)
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

  it('is named in no file but the ones allowed to name it', () => {
    const root = repo('').replace(/\/$/, '');
    const offenders = walk(root)
      .filter((f) => readFileSync(f, 'utf8').includes(STORAGE_PREFIX))
      .map((f) => f.slice(root.length + 1))
      .filter((rel) => !ALLOWED.has(rel))
      .sort();
    expect(offenders).toEqual([]);
  });

  it('keeps the engine override on the same namespace as everything else', () => {
    // The specific drift this closed: one key under a different prefix.
    const prefixes = new Set(
      [nsKey('designs:index'), nsKey('settings:v1'), nsKey('engine')].map((k) => k.split(':')[0]),
    );
    expect([...prefixes]).toEqual([STORAGE_PREFIX]);
  });
});
