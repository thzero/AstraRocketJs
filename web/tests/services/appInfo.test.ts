// @vitest-environment jsdom
// jsdom: importing appInfo pulls in the i18next singleton (needs navigator/document).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isPreRelease } from '../../src/services/appInfo';

describe('isPreRelease', () => {
  it('is true for pre-1.0 (major 0) versions', () => {
    expect(isPreRelease('0.0.0')).toBe(true);
    expect(isPreRelease('0.1.0')).toBe(true);
    expect(isPreRelease('0.9.9')).toBe(true);
    expect(isPreRelease('0.0.0-test')).toBe(true); // pre-release tag
  });

  it('is false once the major version reaches 1 or beyond', () => {
    expect(isPreRelease('1.0.0')).toBe(false);
    expect(isPreRelease('1.2.3')).toBe(false);
    expect(isPreRelease('2.0.0')).toBe(false);
  });

  it('defaults to the build version (the test build is pre-1.0)', () => {
    expect(isPreRelease()).toBe(true); // __APP_VERSION__ = '0.0.0-test'
  });
});

/**
 * The pin the About dialog shows, checked at its source.
 *
 * `UPSTREAM` in appInfo is injected by vite.config.ts from
 * engine-java/extract/UPSTREAM, so there is nothing to test about the value
 * itself here (under Vitest it is the stand-in from vitest.config.ts). What is
 * worth testing is the FILE: it now answers "which OpenRocket is this?" for
 * every reader of the app and the docs, and a bump that moves `ref` while
 * leaving `date` or `describe` behind would ship a confidently wrong answer.
 *
 * `date` against the real commit is a network question, so the `reproducible`
 * job in .github/workflows/gates.yml asks it against the tree it already checks
 * out. These are the parts that can be checked offline.
 */
describe('engine-java/extract/UPSTREAM', () => {
  const text = readFileSync(resolve(process.cwd(), '../engine-java/extract/UPSTREAM'), 'utf8');
  const field = (key: string) =>
    text
      .split('\n')
      .map((line) => /^(\w+)\s*=\s*(\S+)/.exec(line))
      .find((m) => m?.[1] === key)?.[2];

  it('names a repo, a ref, a date and a describe', () => {
    expect(field('repo')).toMatch(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/);
    expect(field('ref')).toMatch(/^[0-9a-f]{40}$/);
    expect(field('date')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(field('describe')).toBeTruthy();
  });

  it('dates the pin plausibly', () => {
    // Not the build date and not a placeholder: an OpenRocket commit that the
    // engine was extracted from, somewhere between the project's first release
    // and now.
    const date = new Date(`${field('date')}T00:00:00Z`);
    expect(Number.isNaN(date.getTime())).toBe(false);
    expect(date.getUTCFullYear()).toBeGreaterThanOrEqual(2020);
    expect(date.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('describes the commit it pins', () => {
    // `git describe` ends in g<short sha>. Tying it to `ref` is what catches
    // the half-done bump: a new ref under the old description.
    expect(field('describe')).toMatch(new RegExp(`g${field('ref')!.slice(0, 7)}`));
  });
});
