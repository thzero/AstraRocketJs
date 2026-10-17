import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Code comments and test titles state the present constraint. A comment says
 * what holds and why; a test title says what it guards. Neither narrates how
 * the code got here: no change history, issue or PR tags, audit finding IDs,
 * dates or credit to named people ("reported by", "thanks to" and a name). The
 * scan covers:
 * - comments (`//`, `/* *\/` and JSDoc) in the `.ts`, `.tsx`, `.js`, `.mjs` and
 *   `.css` files under `web/src`, `web/tests`, `web/e2e`, `web/scripts` and
 *   `website/src`, in the config files at the root of `web`, and in the Java
 *   under `engine-java/src/api`;
 * - `#` comments in the workflow YAML, and `<!-- -->` comments, inline
 *   scripts and inline styles in `web/index.html`;
 * - the first string argument of `describe`, `it` and `test` (and their chained
 *   forms such as `test.describe` or `it.skip`) in the same files.
 *
 * String literals are not searched: they are user text or data, and a date or
 * a `#` in one is a value, not a note. Markdown is not searched either. The
 * vendored TeaVM bundle under `src/engine/vendor` is generated and skipped.
 *
 * The patterns trade recall for precision: each one has no hit in the tree that
 * is not history. A phrase that also reads naturally as present state (such as
 * a value that a field stops holding) is left out rather than allowlisted.
 *
 * The patterns live in regex literals, which the scanner skips, so this file
 * does not match itself.
 */

const PATTERNS: { name: string; re: RegExp }[] = [
  // `#123` as a reference, not `#1` in a list or a quoted `'#123456'` color.
  { name: 'issue reference', re: /(?<![\w&'"`#/:])#\d{2,}(?![\w-])/ },
  { name: 'PR reference', re: /\bPR #?\d+\b/ },
  { name: 'issue reference', re: /\bissues? #?\d+\b/i },
  { name: 'upstream issue', re: /\bopenrocket#\d+\b/i },
  { name: 'audit finding', re: /\bfindings? #?\d+\b/i },
  // A bare `K12` is a motor designation; only an ID beside audit/finding counts.
  { name: 'audit finding', re: /\b(?:audit|finding)s?\b[^.\n]{0,20}?\b[A-Z]{1,3}-?\d{1,3}\b/i },
  { name: 'audit finding', re: /\b[A-Z]{1,3}-?\d{1,3}\b\)?\s+(?:audit|finding)\b/ },
  { name: 'date', re: /\b20\d\d-[01]\d-[0-3]\d\b/ },
  {
    name: 'history',
    re: /\b(?:until now|previously|as of now|was (?:changed|fixed)|after the fix|regression from|before this change|we now|now fixed|used to be|(?:this|it|we|that) used to)\b/i,
  },
  { name: 'history', re: /\bbeing fixed\b/i },
  // A bare commit hash beside upstream/commit cites a point in history, not a constraint.
  { name: 'commit hash', re: /\b(?:upstream|commit)\s+[0-9a-f]{7,40}\b/i },
  // A rename, or how things were, closing a clause. Followed by more
  // words they are present tense: the rename prompt, the same station as
  // before the switch.
  { name: 'history', re: /\b(?:the rename|as before)(?=\s*(?:[.,;:)!?'"`]|$))/i },
  // A feature arriving rather than a state. Two words, so a lone "now" in a
  // sequence of steps does not trip it.
  { name: 'history', re: /\bnow (?:gets|get|has|have)\b/i },
  // A pronoun, a past action and nothing after "before" but the end of the
  // clause. "is cleared before each run" goes on, and is left alone.
  { name: 'history', re: /\b(?:it|they|we|this|that|which)\s+\w{2,}ed before(?=\s*(?:[.,;:)!?'"`]|$))/i },
  // Credit or a ruling by a person, by name.
  { name: 'named person', re: /\b(?:thanks to|(?:reported|requested|suggested|asked|ruled) by)\s+[A-Z][a-z]+\b/ },
];

/**
 * Lines that legitimately need a pattern: `file` is the path from the repo
 * root, `text` a substring of the comment or title line, and `reason` why the
 * words are not history (a quote of upstream, a step in a state machine).
 * An entry that matches nothing fails, so the list cannot go stale.
 */
const ALLOWED: { file: string; text: string; reason: string }[] = [];

// Forward slashes on every platform, so the path tests below read the same on Windows.
const slashed = (url: URL): string => fileURLToPath(url).replace(/\\/g, '/');
const web = slashed(new URL('../..', import.meta.url));
const repo = slashed(new URL('../../..', import.meta.url));

/** Trees that are generated, never edited by hand. */
const skipped = ['/src/engine/vendor'];
const isCode = (path: string): boolean => /\.(?:[cm]?[jt]sx?|java|css)$/.test(path);

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = `${dir}/${entry}`;
    if (skipped.some((tail) => full.endsWith(tail))) continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (isCode(full)) out.push(full);
  }
  return out;
};

const workflows = `${repo}.github/workflows`;

const files = [
  ...walk(`${web}src`),
  ...walk(`${web}tests`),
  ...walk(`${web}e2e`),
  ...walk(`${web}scripts`),
  ...walk(`${repo}website/src`),
  ...walk(`${repo}engine-java/src/api`),
  // The config files at the root of web, not the folders beside them.
  ...readdirSync(web)
    .filter((f) => isCode(f) && statSync(`${web}${f}`).isFile())
    .map((f) => `${web}${f}`),
  `${web}index.html`,
  ...readdirSync(workflows)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => `${workflows}/${f}`),
];

interface Line {
  kind: 'comment' | 'title';
  line: number;
  text: string;
}

/** A `/` here starts a regex literal rather than a division. */
const REGEX_BEFORE = /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\breturn|\btypeof|\bcase|\bof|\bin)\s*$/;
/** A string here is a test title. */
const TITLE_BEFORE = /\b(?:describe|it|test)(?:\.\w+)*\(\s*$/;

/**
 * The comment lines and test-title lines of one source file. A small lexer:
 * strings, template literals and regex literals are stepped over so that a
 * `//` inside one is not a comment. A quote left open by JSX text ends at the
 * line break, so a stray apostrophe costs at most the rest of its line.
 */
const scan = (src: string, path: string): Line[] => {
  if (/\.ya?ml$/.test(path)) return yamlComments(src);
  if (path.endsWith('.html')) return htmlComments(src);
  const out: Line[] = [];
  const java = path.endsWith('.java');
  const css = path.endsWith('.css');
  const push = (kind: Line['kind'], from: number, text: string) =>
    text.split('\n').forEach((t, k) => out.push({ kind, line: from + k, text: t }));
  const lines = (s: string) => (s.match(/\n/g) ?? []).length;
  const n = src.length;
  let i = 0;
  let line = 1;
  while (i < n) {
    const c = src[i];
    if (c === '\n') {
      line++;
      i++;
    } else if (c === '/' && src[i + 1] === '/' && !css) {
      const end = src.indexOf('\n', i);
      const e = end < 0 ? n : end;
      push('comment', line, src.slice(i + 2, e));
      i = e;
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const e = end < 0 ? n : end;
      const text = src.slice(i + 2, e);
      push('comment', line, text);
      line += lines(text);
      i = e + 2;
    } else if (css) {
      i++;
    } else if (java && src.startsWith('"""', i)) {
      const end = src.indexOf('"""', i + 3);
      const e = end < 0 ? n : end;
      line += lines(src.slice(i, e));
      i = e + 3;
    } else if (c === '"' || c === "'" || (c === '`' && !java)) {
      const before = src.slice(Math.max(0, i - 80), i);
      const from = line;
      let j = i + 1;
      let text = '';
      let depth = 0;
      while (j < n) {
        const d = src[j];
        if (d === '\\') {
          if (src[j + 1] === '\n') line++;
          text += src.slice(j, j + 2);
          j += 2;
          continue;
        }
        if (d === '\n') {
          if (c !== '`') break;
          line++;
        }
        if (c === '`' && d === '{' && (depth > 0 || src[j - 1] === '$')) depth++;
        else if (depth > 0 && d === '}') depth--;
        else if (d === c && depth === 0) {
          j++;
          break;
        }
        text += d;
        j++;
      }
      if (TITLE_BEFORE.test(before)) push('title', from, text);
      i = j;
    } else if (c === '/' && !java && REGEX_BEFORE.test(src.slice(Math.max(0, i - 20), i))) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== '\n') {
        const d = src[j];
        if (d === '\\') {
          j += 2;
          continue;
        }
        j++;
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
      }
      i = j;
    } else {
      i++;
    }
  }
  return out;
};

/**
 * The `#` comments of a YAML file: a `#` that starts the line or follows a
 * space, outside quotes. `${{ }}` and a `#` inside a word are values.
 */
const yamlComments = (src: string): Line[] => {
  const out: Line[] = [];
  src.split('\n').forEach((text, k) => {
    let quote = '';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '#' && (i === 0 || /\s/.test(text[i - 1] ?? ''))) {
        out.push({ kind: 'comment', line: k + 1, text: text.slice(i + 1) });
        return;
      }
    }
  });
  return out;
};

/** The `<!-- -->` comments of an HTML file, and the comments of its inline scripts and styles. */
const htmlComments = (src: string): Line[] => {
  const out: Line[] = [];
  const lineAt = (i: number) => (src.slice(0, i).match(/\n/g) ?? []).length + 1;
  for (const m of src.matchAll(/<!--([\s\S]*?)-->/g)) {
    const from = lineAt(m.index + 4);
    (m[1] ?? '').split('\n').forEach((t, k) => out.push({ kind: 'comment', line: from + k, text: t }));
  }
  for (const m of src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    const body = m[1] ?? '';
    const from = lineAt(m.index + m[0].indexOf(body)) - 1;
    for (const l of scan(body, '/inline.js')) out.push({ ...l, line: from + l.line });
  }
  for (const m of src.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
    const body = m[1] ?? '';
    const from = lineAt(m.index + m[0].indexOf(body)) - 1;
    for (const l of scan(body, '/inline.css')) out.push({ ...l, line: from + l.line });
  }
  return out;
};

const firstMatch = (text: string): string | undefined => PATTERNS.find((p) => p.re.test(text))?.name;

/** Every `file:line [kind] pattern: text` that narrates instead of stating. */
const hits = (paths: string[], allowed = ALLOWED): string[] => {
  const found: string[] = [];
  for (const path of paths) {
    const file = path.slice(repo.length);
    for (const { kind, line, text } of scan(readFileSync(path, 'utf8'), path)) {
      const name = firstMatch(text);
      if (!name) continue;
      if (allowed.some((a) => a.file === file && text.includes(a.text))) continue;
      found.push(`${file}:${line} [${kind}] ${name}: ${text.trim()}`);
    }
  }
  return found;
};

describe('comments and test titles state the constraint', () => {
  it('scans the trees it claims to', () => {
    expect(files.some((f) => f.endsWith('/web/src/main.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('/web/tests/repo/noEmDash.test.ts'))).toBe(true);
    expect(files.some((f) => f.includes('/web/e2e/'))).toBe(true);
    expect(files.some((f) => f.includes('/web/scripts/'))).toBe(true);
    expect(files.some((f) => f.endsWith('/engine-java/src/api/java/api/OpenRocketEngine.java'))).toBe(true);
    expect(files.some((f) => f.endsWith('/web/vite.config.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('/web/index.html'))).toBe(true);
    expect(files.some((f) => f.endsWith('/.github/workflows/gates.yml'))).toBe(true);
    expect(files.some((f) => f.includes('/website/src/'))).toBe(true);
    expect(files.some((f) => f.includes('/src/engine/vendor/'))).toBe(false);
    expect(files.some((f) => f.endsWith('.md'))).toBe(false);
  });

  it('reads comments and titles, and steps over strings and regex literals', () => {
    const src = [
      "const url = 'https://example.com/a'; // a comment",
      'const re = /\\/\\/ not a comment/;',
      "describe('a title', () => {});",
      'test.describe(`another ${1} title`, () => {});',
      "label('not a title');",
      '/** a',
      ' * block */',
    ].join('\n');
    expect(scan(src, '/a.ts')).toEqual([
      { kind: 'comment', line: 1, text: ' a comment' },
      { kind: 'title', line: 3, text: 'a title' },
      { kind: 'title', line: 4, text: 'another ${1} title' },
      { kind: 'comment', line: 6, text: '* a' },
      { kind: 'comment', line: 7, text: ' * block ' },
    ]);
  });

  it('reads YAML and HTML comments, and not their values', () => {
    const yml = ['# a note', 'run: echo "# not a note" # a tail', "if: ${{ github.ref == 'a#b' }}"].join('\n');
    expect(scan(yml, '/a.yml')).toEqual([
      { kind: 'comment', line: 1, text: ' a note' },
      { kind: 'comment', line: 2, text: ' a tail' },
    ]);
    const html = [
      '<p>#1</p>',
      '<!-- a',
      'note -->',
      '<script>',
      "const a = '//x'; // inline",
      '</script>',
      '<style>',
      'a { color: red; } /* styled */',
      '</style>',
    ].join('\n');
    expect(scan(html, '/a.html')).toEqual([
      { kind: 'comment', line: 2, text: ' a' },
      { kind: 'comment', line: 3, text: 'note ' },
      { kind: 'comment', line: 5, text: ' inline' },
      { kind: 'comment', line: 8, text: ' styled ' },
    ]);
  });

  it('flags the shapes it is for', () => {
    for (const text of [
      'see #1234',
      'from PR #56',
      'tracked in issue 78',
      'upstream openrocket#2345',
      'per finding 12',
      'audit item K12',
      'K12 finding',
      'written 2026-01-02',
      'this used to throw',
      'until now it did not',
      'previously this read the cache',
      'which is the whole point of the rename',
      'the failure being fixed',
      'opens empty, as before',
      'every dialog now gets it for free',
      'still clears everything it cleared before',
      'reported by Alice',
      'thanks to Bob',
    ]) {
      expect(firstMatch(text), text).toBeDefined();
    }
  });

  it('leaves colors, list numbers and motor designations alone', () => {
    for (const text of [
      "a '#123456' color",
      'stroked #7a786f',
      'names (#1, #2)',
      'an Estes C6 and a D12 on a K550',
      'the id it no longer has',
      'a stable id, used to remember the dialog',
      'dismissing the rename prompt',
      'the same station as before the switch',
      'catalogs published before',
      'the cache is cleared before each run',
      'a part attached before',
      'thanks to the kernel',
    ]) {
      expect(firstMatch(text), text).toBeUndefined();
    }
  });

  it('keeps no allowlist entry that matches nothing', () => {
    for (const entry of ALLOWED) {
      expect(
        hits(files, []).some((h) => h.startsWith(`${entry.file}:`) && h.includes(entry.text)),
        entry.file,
      ).toBe(true);
    }
  });

  it('finds no history in scope', () => {
    expect(hits(files)).toEqual([]);
  });
});
