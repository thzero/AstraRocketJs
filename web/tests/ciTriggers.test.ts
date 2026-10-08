import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Which pushes are checked at all.
 *
 * The three workflows divide the work by trigger, and between them they have to
 * leave no commit unchecked: `ci.yml` is `pull_request`-only, `deploy.yml` is
 * master-push-only, so `dev.yml` has to cover a push to every other branch. With
 * a branch allowlist there, a push to an unlisted branch runs no format, spell,
 * typecheck, lint, knip or unit-test gate at all.
 *
 * Deliberately a textual assertion rather than a parsed one. The failure being
 * guarded is someone narrowing the trigger to a list of branch names, and
 * the hazard is the shape of the config, not a value computed from it. Parsing
 * would also mean importing a YAML package that is only present transitively,
 * which `knip` would then report as an unlisted dependency.
 */
const wf = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../.github/workflows/${name}`, import.meta.url)), 'utf8');

describe('CI trigger coverage', () => {
  it('checks a push to every branch except master', () => {
    const dev = wf('dev.yml');
    // `branches-ignore`, not `branches`: an allowlist leaves every unlisted branch
    // unchecked.
    expect(dev).toMatch(/push:\s*\n\s*branches-ignore:\s*\[master\]/);
    expect(dev).not.toMatch(/push:\s*\n\s*branches:/);
  });

  it('leaves master to the deploy workflow, which runs the full gates', () => {
    // master is the one branch dev.yml may skip, and only because deploy.yml
    // covers it with more than dev.yml would.
    expect(wf('deploy.yml')).toMatch(/push:\s*\n\s*branches:\s*\[master\]/);
    expect(wf('deploy.yml')).toContain('uses: ./.github/workflows/gates.yml');
  });

  it('keeps the full gate set on every pull request', () => {
    expect(wf('ci.yml')).toMatch(/on:\s*\n\s*pull_request:/);
    expect(wf('ci.yml')).toContain('uses: ./.github/workflows/gates.yml');
  });

  it('runs the same verify list a developer runs locally', () => {
    // The point of dev.yml being `npm run verify` and not its own list: the two
    // cannot drift. If this ever needs its own steps, the drift is the finding.
    expect(wf('dev.yml')).toContain('npm run verify');
  });
});

/**
 * Every job that runs steps has a wall-clock cap.
 *
 * A job without one inherits GitHub's 360-minute default: per shard for a
 * sharded `e2e` matrix, and on a `sync` job that holds `contents: write`
 * against the `data` branch the live app reads. The cap is
 * not about slowness: it is about a hang. A Playwright locator waiting on an
 * element that never appears, a deadlocked kernel build, a fetch with no timeout
 * of its own; uncapped, each of those sits burning runner minutes for six hours
 * with the PR showing "in progress".
 *
 * Textual, like the trigger assertions above, and for the same two reasons: the
 * hazard is the shape of the config, and parsing would mean a YAML dependency that
 * knip would then report as unlisted.
 *
 * A job that only calls a reusable workflow (`uses: ./.github/workflows/...`) is
 * skipped: it runs no steps of its own, and its duration is the sum of the called
 * workflow's jobs, each of which is capped here.
 */
describe('every job has a timeout', () => {
  const FILES = ['ci.yml', 'deploy.yml', 'dev.yml', 'gates.yml', 'sync-catalogs.yml'];

  /** Job blocks in one workflow, as `[name, body]`, split on the 2-space indent. */
  const jobsOf = (text: string): [string, string][] => {
    const after = text.split(/^jobs:\s*$/m)[1];
    if (!after) return [];
    const out: [string, string][] = [];
    const parts = after.split(/^ {2}([A-Za-z][\w-]*):\s*$/m);
    for (let i = 1; i < parts.length; i += 2) out.push([parts[i]!, parts[i + 1] ?? '']);
    return out;
  };

  it('caps every job that runs steps', () => {
    const uncapped: string[] = [];
    for (const f of FILES) {
      for (const [name, body] of jobsOf(wf(f))) {
        if (/^\s*uses:/m.test(body) && !/^\s*steps:/m.test(body)) continue; // reusable-workflow call
        if (!/^\s*timeout-minutes:\s*\d+/m.test(body)) uncapped.push(`${f}#${name}`);
      }
    }
    expect(uncapped).toEqual([]);
  });

  it('finds the jobs at all, so a broken split cannot pass', () => {
    // Without this, a regex that stops matching makes the loop above iterate over
    // nothing and report a clean sweep of a file it never read.
    const names = FILES.flatMap((f) => jobsOf(wf(f)).map(([n]) => n));
    expect(names).toContain('build-and-test');
    expect(names).toContain('e2e');
    expect(names).toContain('sync');
    expect(names.length).toBeGreaterThanOrEqual(10);
  });

  it('leaves no cap at the 360-minute default by writing it out', () => {
    // A literal 360 is someone documenting the default rather than choosing a
    // bound, which is the same hazard wearing a number.
    for (const f of FILES) expect(wf(f), f).not.toMatch(/timeout-minutes:\s*360/);
  });
});
