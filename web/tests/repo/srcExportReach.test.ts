import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Which `src` exports are reached only from tests.
 *
 * A test rather than a knip configuration, because knip cannot express it:
 *
 * - A knip run with `project: ['src/**']` reports nothing. knip resolves
 *   importers through the TypeScript program, so a `tests/` file importing an src
 *   export counts as a use however `project` is scoped. A genuinely unreferenced
 *   export planted beside a known test-only one is flagged; the test-only one is
 *   not.
 * - Giving that run its own tsconfig with `include: ['src']` changes nothing, for
 *   the same reason.
 * - `knip --production` reports none of these and emits ten false-positive unused
 *   dependencies.
 *
 * So the rule lives here. A test-only export is not wrong in itself - a reset for
 * module state is a legitimate seam - but the set of them should be a decision.
 * Left invisible this is where dead code hides: an export with a test and no
 * caller looks covered.
 */

const web = fileURLToPath(new URL('../..', import.meta.url));

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    // The vendored TeaVM bundle is generated and 3 MB of it; scanning it would
    // match half these names by coincidence.
    if (entry === 'vendor' || entry === 'node_modules') continue;
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
};

const srcFiles = walk(`${web}src`);
const testFiles = [...walk(`${web}tests`), ...walk(`${web}e2e`)];

const cache = new Map<string, string>();
const text = (f: string): string => {
  const hit = cache.get(f);
  if (hit !== undefined) return hit;
  const t = readFileSync(f, 'utf8');
  cache.set(f, t);
  return t;
};

/** `export { a, b as c }` and `export { a } from './x'`, one statement per match. */
const EXPORT_LIST = /^export\s+\{([^}]*)\}(?:\s*from\s*['"]([^'"]+)['"])?\s*;?/gm;

/**
 * An exported value name, and whether the module only forwards it.
 *
 * A forwarded name is one the module re-exports from another (`export { a } from`)
 * or imports and lists (`import { a }` then `export { a }`). Its uses inside the
 * module do not need the export, so only an importer of this module counts.
 */
type Exported = { name: string; forwarded: boolean };

/**
 * Exported value names in a file: declarations and export lists.
 *
 * Values only. A `type` or `interface` costs nothing at runtime. knip reports
 * one nothing imports, but counts a test's import as a use, so a type only tests
 * import is not reported; such a type belongs in `tests/testing`.
 * `export default` and `export *` are skipped: neither is a name to track, and the
 * project has exactly two sanctioned default exports.
 */
const exportedValues = (t: string): Exported[] => {
  const out: Exported[] = [];
  const decl = /^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of t.matchAll(decl)) out.push({ name: m[1]!, forwarded: false });
  const imports = [...t.matchAll(/^import\s+(?!type\b)[^;]*?\{([^}]*)\}[^;]*?from/gm)]
    .flatMap((m) => m[1]!.split(','))
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('type '))
    .map((s) => s.split(/\s+as\s+/).pop()!);
  for (const m of t.matchAll(EXPORT_LIST)) {
    for (const raw of m[1]!.split(',')) {
      const item = raw.trim();
      if (!item || item.startsWith('type ')) continue;
      const [local, exported = local] = item.split(/\s+as\s+/);
      out.push({ name: exported!, forwarded: m[2] !== undefined || imports.includes(local!) });
    }
  }
  return out;
};

const occurrences = (t: string, name: string): number => (t.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length;

const mentionedElsewhere = (files: string[], name: string, self: string): boolean =>
  files.some((f) => f !== self && occurrences(text(f), name) > 0);

/** `file` without its extension, with forward slashes, for comparing module paths. */
const modulePath = (file: string): string =>
  file
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\.(ts|tsx)$/, '');

/** Whether `from` imports or re-exports from the module `self` by a relative specifier. */
const importsFrom = (from: string, self: string): boolean => {
  const dir = modulePath(from).replace(/\/[^/]*$/, '');
  const target = modulePath(self);
  for (const m of text(from).matchAll(/\bfrom\s*['"](\.[^'"]*)['"]/g)) {
    const parts = `${dir}/${m[1]!}`.split('/');
    const resolved: string[] = [];
    for (const p of parts) {
      if (p === '..') resolved.pop();
      else if (p !== '.') resolved.push(p);
    }
    const spec = resolved.join('/');
    if (spec === target || `${spec}/index` === target) return true;
  }
  return false;
};

/** Whether a file other than `self` names `name` and imports it through `self`. */
const reachedThrough = (files: string[], name: string, self: string): boolean =>
  files.some((f) => f !== self && occurrences(text(f), name) > 0 && importsFrom(f, self));

/**
 * Every src export that no src file uses, including its own, but a test does.
 *
 * The same-file check is the half that matters and the one easy to forget: an
 * export a sibling function in the same module calls is not dead by any reading -
 * it is exported so a test can reach it directly, which is the pattern knip spells
 * `ignoreExportsUsedInFile`. Without it this reports forty extra names.
 *
 * Token matching, deliberately. A real import graph needs a parser, and the error
 * direction here is the safe one: a name mentioned in an unrelated comment reads as
 * used, so this under-reports rather than over-reports.
 */
const testOnlyExports = (): string[] => {
  const found: string[] = [];
  for (const file of srcFiles) {
    const t = text(file);
    for (const { name, forwarded } of exportedValues(t)) {
      const where = `${file.slice(web.length).replace(/\\/g, '/')}#${name}`;
      if (forwarded) {
        if (reachedThrough(srcFiles, name, file)) continue; // a real src importer
        if (reachedThrough(testFiles, name, file)) found.push(where);
        continue;
      }
      if (occurrences(t.replace(EXPORT_LIST, ''), name) > 1) continue; // used inside its own module
      if (mentionedElsewhere(srcFiles, name, file)) continue; // a real src caller
      if (!mentionedElsewhere(testFiles, name, file)) continue; // reached by nothing: knip's job
      found.push(where);
    }
  }
  return found.sort();
};

/**
 * Exports a test reaches and nothing in the app does.
 *
 * Delete one, or give it a real caller, and the second test below fails until its
 * line goes too.
 */
const BASELINE = [
  // Test seams over module state, each saying so where it is declared.
  'src/engine/openRocketEngine.ts#__setEngineForTests',
  'src/components/tools/LandingEstimator.tsx#forgetLandingEstimator',
  'src/components/tools/OffTheRail.tsx#forgetOffTheRail',
  'src/components/tools/ParachuteTool.tsx#forgetParachuteTool',
  'src/components/tools/ToolsPane.tsx#forgetToolsPane',
  'src/services/app/helpSearch.ts#resetHelpIndex',
  'src/services/weather/openMeteo.ts#resetWeatherState',
  'src/services/weather/openMeteo.ts#setWeatherTransport',
  'src/services/report/reportFonts.ts#resetReportFontsForTests',
];

describe('src exports reached only from tests are a decision', () => {
  const found = testOnlyExports();

  it('adds none that is not in the baseline', () => {
    // A new one failing here is the point. Either it has a caller and the export is
    // real, or it does not and someone is about to ship a function with a test and
    // no user.
    expect(found.filter((e) => !BASELINE.includes(e))).toEqual([]);
  });

  it('keeps no baseline entry that is no longer test-only', () => {
    // So deleting a dead export, or giving it a real caller, also deletes its line
    // here, rather than leaving a stale entry.
    expect(BASELINE.filter((e) => !found.includes(e))).toEqual([]);
  });

  it('actually finds things, so a broken scan cannot pass as a clean repo', () => {
    // The failure this guards: a regex that stops matching makes `found` empty and
    // sends both assertions above green on a scan that saw nothing.
    expect(found).toHaveLength(BASELINE.length);
    expect(srcFiles.length).toBeGreaterThan(200);
    expect(testFiles.length).toBeGreaterThan(200);
  });
});
