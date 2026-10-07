import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Which `src` exports are reached ONLY from tests.
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
 * module state is a legitimate seam - but the SET of them should be a decision.
 * Left invisible this is where dead code hides: an export with a test and no
 * caller looks covered.
 */

const web = fileURLToPath(new URL('..', import.meta.url));

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    // The vendored TeaVM bundle is generated and 2.9 MB of it; scanning it would
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

/**
 * Exported VALUE names declared in a file.
 *
 * Values only. A `type` or `interface` exported so a test can annotate a fixture
 * costs nothing at runtime, and knip reports unused ones separately and correctly.
 * `export default` and `export *` are skipped: neither is a name to track, and the
 * project has exactly two sanctioned default exports.
 */
const exportedValues = (t: string): string[] => {
  const names: string[] = [];
  const decl = /^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of t.matchAll(decl)) names.push(m[1]!);
  return names;
};

const occurrences = (t: string, name: string): number => (t.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length;

const mentionedElsewhere = (files: string[], name: string, self: string): boolean =>
  files.some((f) => f !== self && occurrences(text(f), name) > 0);

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
 * used, so this UNDER-reports rather than crying wolf.
 */
const testOnlyExports = (): string[] => {
  const found: string[] = [];
  for (const file of srcFiles) {
    const t = text(file);
    for (const name of exportedValues(t)) {
      if (occurrences(t, name) > 1) continue; // used inside its own module
      if (mentionedElsewhere(srcFiles, name, file)) continue; // a real src caller
      if (!mentionedElsewhere(testFiles, name, file)) continue; // reached by nothing: knip's job
      found.push(`${file.slice(web.length).replace(/\\/g, '/')}#${name}`);
    }
  }
  return found.sort();
};

/**
 * Exports a test reaches and nothing in the app does. Each is a deliberate test
 * seam over module state, and says so where it is declared.
 *
 * Delete one, or give it a real caller, and the second test below fails until its
 * line goes too.
 */
const BASELINE = [
  'src/engine/openRocketEngine.ts#__setEngineForTests',
  'src/components/tools/LandingEstimator.tsx#forgetLandingEstimator',
  'src/components/tools/OffTheRail.tsx#forgetOffTheRail',
  'src/components/tools/ParachuteTool.tsx#forgetParachuteTool',
  'src/components/tools/ToolsPane.tsx#forgetToolsPane',
  'src/services/app/helpSearch.ts#resetHelpIndex',
  'src/services/weather/openMeteo.ts#resetWeatherState',
  'src/services/weather/openMeteo.ts#setWeatherTransport',
];

describe('src exports reached only from tests are a decision', () => {
  const found = testOnlyExports();

  it('adds none that is not in the baseline', () => {
    // A NEW one failing here is the point. Either it has a caller and the export is
    // real, or it does not and someone is about to ship a function with a test and
    // no user.
    expect(found.filter((e) => !BASELINE.includes(e))).toEqual([]);
  });

  it('keeps no baseline entry that is no longer test-only', () => {
    // So deleting a dead export, or giving it a real caller, also deletes its line
    // here, rather than leaving a list that describes last month.
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
