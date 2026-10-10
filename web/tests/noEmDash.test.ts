import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * No em dash (U+2014) in the project's own text: UI strings, code, tests, scripts,
 * workflows and the docs. Prose takes a colon, comma, period or parentheses, and
 * an empty readout shows `NO_VALUE` from `src/i18n/noValue`.
 *
 * Out of scope on purpose:
 * - the non-English locale files, where the em dash (es, ru) is native
 *   punctuation;
 * - the vendored TeaVM bundle under `src/engine/vendor`, which is generated;
 * - `docs/rasaero/diffs`, which quotes RASAero's own files.
 *
 * This file names the character only as an escape, so it does not match itself.
 */

const EM_DASH = '\u2014';

// Forward slashes on every platform, so the path tests below read the same on Windows.
const slashed = (url: URL): string => fileURLToPath(url).replace(/\\/g, '/');
const web = slashed(new URL('..', import.meta.url));
const repo = slashed(new URL('../..', import.meta.url));

/** Locale files other than en.json carry each language's own punctuation. */
const isForeignLocale = (path: string): boolean => /\/i18n\/locales\/(?!en\.json$)[^/]+\.json$/.test(path);

const walk = (dir: string, keep: (path: string) => boolean, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = `${dir}/${entry}`;
    if (full.endsWith('/src/engine/vendor') || full.endsWith('/docs/rasaero/diffs')) continue;
    if (statSync(full).isDirectory()) walk(full, keep, out);
    else if (keep(full)) out.push(full);
  }
  return out;
};

const anyFile = (path: string): boolean => !isForeignLocale(path);
const markdown = (path: string): boolean => path.endsWith('.md');

const files = [
  ...walk(`${web}src`, anyFile),
  ...walk(`${web}tests`, anyFile),
  ...walk(`${web}e2e`, anyFile),
  ...walk(`${web}scripts`, anyFile),
  `${web}index.html`,
  `${web}package.json`,
  ...walk(`${repo}.github/workflows`, anyFile),
  ...walk(`${repo}docs`, markdown),
  ...['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'TODO.md'].map((f) => `${repo}${f}`).filter(existsSync),
];

/** Every `file:line` holding the character; binary files (a NUL byte) are skipped. */
const hits = (paths: string[]): string[] => {
  const found: string[] = [];
  for (const path of paths) {
    const bytes = readFileSync(path);
    if (bytes.includes(0)) continue;
    const lines = bytes.toString('utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.includes(EM_DASH)) found.push(`${path.slice(repo.length)}:${i + 1}`);
    });
  }
  return found;
};

describe('the em dash', () => {
  it('scans the trees it claims to', () => {
    expect(files.some((f) => f.endsWith('/src/i18n/locales/en.json'))).toBe(true);
    expect(files.some((f) => f.endsWith('/src/i18n/locales/es.json'))).toBe(false);
    expect(files.some((f) => f.includes('/src/engine/vendor/'))).toBe(false);
    expect(files.some((f) => f.includes('/.github/workflows/'))).toBe(true);
  });

  it('appears nowhere in scope', () => {
    expect(hits(files)).toEqual([]);
  });
});
