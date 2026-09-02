// @vitest-environment jsdom
// jsdom: importing appInfo pulls in the i18next singleton (needs navigator/document).
import { describe, it, expect } from 'vitest';
import { isPreRelease } from './appInfo';

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
