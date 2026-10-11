import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * No em dash (U+2014) in the project's own text. Prose takes a colon, comma,
 * period or parentheses, and an empty readout shows `NO_VALUE` from
 * `src/i18n/noValue`. The scan covers:
 * - `web/`: src, tests, e2e, scripts and the root config files;
 * - `website/`: the docs, the English translations, src and the config files;
 * - `.github/`: the workflows and the issue forms;
 * - `engine-java/`: the facade under `src/api` (its exception text reaches the
 *   UI), the build files and the Markdown;
 * - `docs/` Markdown, the root Markdown, the root dotfiles and `cspell.json`.
 *
 * Out of scope on purpose:
 * - the non-English locale files (`web/src/i18n/locales`, `website/i18n`), where
 *   the em dash (es, ru) is native punctuation;
 * - the vendored TeaVM bundle under `src/engine/vendor`, which is generated;
 * - the extracted OpenRocket sources under `engine-java/src/java`, which are
 *   upstream's text;
 * - `docs/rasaero/diffs`, which quotes RASAero's own files;
 * - `web/package-lock.json`, and the `node_modules`, `build` and `.docusaurus`
 *   output trees.
 *
 * This file names the character only as an escape, so it does not match itself.
 */

const EM_DASH = '\u2014';

// Forward slashes on every platform, so the path tests below read the same on Windows.
const slashed = (url: URL): string => fileURLToPath(url).replace(/\\/g, '/');
const web = slashed(new URL('..', import.meta.url));
const repo = slashed(new URL('../..', import.meta.url));

/** Locale files other than English carry each language's own punctuation. */
const isForeignLocale = (path: string): boolean =>
  /\/i18n\/locales\/(?!en\.json$)[^/]+\.json$/.test(path) || /\/website\/i18n\/(?!en\/)/.test(path);

/** Trees that are generated, vendored or quoted, never edited by hand. */
const skipped = ['/src/engine/vendor', '/docs/rasaero/diffs', '/website/build', '/website/.docusaurus'];

const walk = (dir: string, keep: (path: string) => boolean, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = `${dir}/${entry}`;
    if (skipped.some((tail) => full.endsWith(tail))) continue;
    if (statSync(full).isDirectory()) walk(full, keep, out);
    else if (keep(full)) out.push(full);
  }
  return out;
};

const anyFile = (path: string): boolean => !isForeignLocale(path);
const markdown = (path: string): boolean => path.endsWith('.md');

/** The files directly in `dir` (no subfolders) that pass `keep`. */
const shallow = (dir: string, keep: (path: string) => boolean): string[] =>
  readdirSync(dir)
    .map((entry) => `${dir}/${entry}`)
    .filter((full) => statSync(full).isFile() && keep(full));

const files = [
  ...walk(`${web}src`, anyFile),
  ...walk(`${web}tests`, anyFile),
  ...walk(`${web}e2e`, anyFile),
  ...walk(`${web}scripts`, anyFile),
  ...shallow(web.slice(0, -1), (f) => !f.endsWith('/package-lock.json')),
  ...walk(`${repo}website`, anyFile),
  ...walk(`${repo}.github`, anyFile),
  ...walk(`${repo}engine-java/src/api`, anyFile),
  ...shallow(`${repo}engine-java`, (f) => markdown(f) || /\/(build\.gradle|gradle\.properties)$/.test(f)),
  ...shallow(`${repo}engine-java/patches`, markdown),
  ...walk(`${repo}docs`, markdown),
  ...shallow(repo.slice(0, -1), (f) => markdown(f) || /\/(\.[^/]+|cspell\.json)$/.test(f)),
  ...walk(`${repo}.cspell`, anyFile),
  ...walk(`${repo}.vscode`, anyFile),
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
    expect(files.some((f) => f.includes('/.github/ISSUE_TEMPLATE/'))).toBe(true);
    expect(files.some((f) => f.includes('/website/docs/'))).toBe(true);
    expect(files.some((f) => f.includes('/website/i18n/es/'))).toBe(false);
    expect(files.some((f) => f.includes('/website/build/'))).toBe(false);
    expect(files.some((f) => f.endsWith('/engine-java/src/api/java/api/OpenRocketEngine.java'))).toBe(true);
    expect(files.some((f) => f.includes('/engine-java/src/java/'))).toBe(false);
    expect(files.some((f) => f.endsWith('/engine-java/build.gradle'))).toBe(true);
    expect(files.some((f) => f.endsWith('/web/vitest.config.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('/.gitattributes'))).toBe(true);
    expect(files.some((f) => f.endsWith('/CODE_OF_CONDUCT.md'))).toBe(true);
  });

  it('appears nowhere in scope', () => {
    expect(hits(files)).toEqual([]);
  });
});
