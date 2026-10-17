import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * No em dash (U+2014) in the project's own text. Prose takes a colon, comma,
 * period or parentheses, and an empty readout shows `NO_VALUE` from
 * `src/i18n/noValue`. The scan covers:
 * - `web/`: src, tests, e2e, scripts and the root config files;
 * - `website/`: the docs, src and the config files, and an `i18n/en` tree if
 *   one is added;
 * - `.github/`: the workflows and the issue forms;
 * - `engine-java/`: everything the project writes there: the facade under
 *   `src/api` (its exception text reaches the UI), the build files, the extract
 *   and build scripts, the manifest, the patches, the parity and validation
 *   harnesses, and the Markdown;
 * - `docs/` Markdown, the root Markdown, the root dotfiles and `cspell.json`.
 *
 * Out of scope on purpose:
 * - the non-English locale files (`web/src/i18n/locales`, `website/i18n`), where
 *   the em dash (es, ru) is native punctuation;
 * - the vendored TeaVM bundle under `src/engine/vendor`, which is generated;
 * - the extracted OpenRocket sources under `engine-java/src/java` and the
 *   upstream checkout `engine-java/.openrocket-src`, which are upstream's text,
 *   and the Gradle output under `build`, `reference/build` and `.gradle`;
 * - `docs/rasaero/diffs`, which quotes RASAero's own files;
 * - `web/package-lock.json`, and the `node_modules`, `build` and `.docusaurus`
 *   output trees.
 *
 * The character written as an HTML entity (named, decimal or hex) counts too:
 * JSX and Markdown render it as the character. In Markdown an entity inside a
 * code span is shown as written, so code spans are not searched for it.
 *
 * This file names the character only as an escape and the entity only as a
 * pattern, so it does not match itself.
 */

const EM_DASH = '\u2014';
const EM_DASH_ENTITY = /&(?:mdash|#0*8212|#x0*2014);/i;

/** The line as it renders the entity: a Markdown code span shows it literally. */
const searchable = (path: string, line: string): string =>
  /\.mdx?$/.test(path) ? line.replace(/`[^`\n]*`/g, '') : line;

// Forward slashes on every platform, so the path tests below read the same on Windows.
const slashed = (url: URL): string => fileURLToPath(url).replace(/\\/g, '/');
const web = slashed(new URL('../..', import.meta.url));
const repo = slashed(new URL('../../..', import.meta.url));

/** Locale files other than English carry each language's own punctuation. */
const isForeignLocale = (path: string): boolean =>
  /\/i18n\/locales\/(?!en\.json$)[^/]+\.json$/.test(path) || /\/website\/i18n\/(?!en\/)/.test(path);

/** Trees that are generated, vendored or quoted, never edited by hand. */
const skipped = [
  '/src/engine/vendor',
  '/docs/rasaero/diffs',
  '/website/build',
  '/website/.docusaurus',
  '/engine-java/src/java',
  '/engine-java/.openrocket-src',
  '/engine-java/build',
  '/engine-java/reference/build',
  '/engine-java/.gradle',
];

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

/**
 * Every folder the scan starts from. A missing one scans as empty rather than
 * throwing while this file loads, and the first test fails on it instead.
 */
const roots: string[] = [];
const from = (dir: string, list: (dir: string) => string[]): string[] => {
  roots.push(dir);
  return existsSync(dir) ? list(dir) : [];
};
const tree = (dir: string, keep: (path: string) => boolean): string[] => from(dir, (d) => walk(d, keep));
const top = (dir: string, keep: (path: string) => boolean): string[] => from(dir, (d) => shallow(d, keep));

const files = [
  ...tree(`${web}src`, anyFile),
  ...tree(`${web}tests`, anyFile),
  ...tree(`${web}e2e`, anyFile),
  ...tree(`${web}scripts`, anyFile),
  ...top(web.slice(0, -1), (f) => !f.endsWith('/package-lock.json')),
  ...tree(`${repo}website`, anyFile),
  ...tree(`${repo}.github`, anyFile),
  ...tree(`${repo}engine-java`, anyFile),
  ...tree(`${repo}docs`, markdown),
  ...top(repo.slice(0, -1), (f) => markdown(f) || /\/(\.[^/]+|cspell\.json)$/.test(f)),
  ...tree(`${repo}.cspell`, anyFile),
];

/** Every `file:line` holding the character; binary files (a NUL byte) are skipped. */
const hits = (paths: string[]): string[] => {
  const found: string[] = [];
  for (const path of paths) {
    const bytes = readFileSync(path);
    if (bytes.includes(0)) continue;
    const lines = bytes.toString('utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.includes(EM_DASH) || EM_DASH_ENTITY.test(searchable(path, line))) {
        found.push(`${path.slice(repo.length)}:${i + 1}`);
      }
    });
  }
  return found;
};

describe('the em dash', () => {
  // A folder that is missing, or that git does not track, exists only in some
  // checkouts: the scan would pass on one machine and fail to load on CI.
  it('starts only from folders the repository tracks', () => {
    const untracked = roots.filter(
      (dir) => !existsSync(dir) || execFileSync('git', ['ls-files', '--', dir], { cwd: repo }).length === 0,
    );
    expect(untracked).toEqual([]);
  });

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
    expect(files.some((f) => f.endsWith('/engine-java/extract/manifest.txt'))).toBe(true);
    expect(files.some((f) => f.includes('/engine-java/.openrocket-src/'))).toBe(false);
    expect(files.some((f) => f.endsWith('/web/vitest.config.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('/.gitattributes'))).toBe(true);
    expect(files.some((f) => f.endsWith('/CODE_OF_CONDUCT.md'))).toBe(true);
  });

  it('is caught written as an entity, outside a Markdown code span', () => {
    const amp = '&';
    for (const e of [`${amp}mdash;`, `${amp}#8212;`, `${amp}#x2014;`, `${amp}#X2014;`]) {
      expect(EM_DASH_ENTITY.test(searchable('/a.tsx', `<td>${e}</td>`))).toBe(true);
      expect(EM_DASH_ENTITY.test(searchable('/a.md', `a ${e} b`))).toBe(true);
      expect(EM_DASH_ENTITY.test(searchable('/a.md', `a \`${e}\` b`))).toBe(false);
    }
    expect(EM_DASH_ENTITY.test(`${amp}ndash;`)).toBe(false);
  });

  it('appears nowhere in scope', () => {
    expect(hits(files)).toEqual([]);
  });
});
