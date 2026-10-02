import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Which pushes are checked at all.
 *
 * The three workflows divide the work by trigger, and between them they have to
 * leave no commit unchecked. They did not: `ci.yml` is `pull_request`-only,
 * `deploy.yml` is master-push-only, and `dev.yml` read `branches: [dev]`, so a
 * push to any other branch ran nothing. Not format, not spell, not typecheck,
 * not lint, not knip, not one unit test. Most work happens on a branch that is
 * not called `dev`, so that was most work.
 *
 * Deliberately a TEXTUAL assertion rather than a parsed one. The failure being
 * guarded is someone narrowing the trigger back to a list of branch names, and
 * the hazard is the shape of the config, not a value computed from it. Parsing
 * would also mean importing a YAML package that is only present transitively,
 * which `knip` would then report as an unlisted dependency.
 */
const wf = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../.github/workflows/${name}`, import.meta.url)), 'utf8');

describe('CI trigger coverage', () => {
  it('checks a push to every branch except master', () => {
    const dev = wf('dev.yml');
    // `branches-ignore`, not `branches`: an allowlist is what left every branch
    // but one unchecked.
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
