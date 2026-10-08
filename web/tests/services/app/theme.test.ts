// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyTheme, followSystemTheme, resolveTheme, toggleDaylight } from '../../../src/services/app/theme';

/** A matchMedia stand-in whose OS preference the test can flip. */
function mockSystem(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    get matches() {
      return dark;
    },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal('matchMedia', () => query);
  return {
    flip(next: boolean) {
      dark = next;
      listeners.forEach((fn) => fn());
    },
    listeners,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-theme');
  document.head.innerHTML = '';
});

describe('resolveTheme', () => {
  it('passes an explicit choice through', () => {
    expect(resolveTheme('dark')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('daylight')).toBe('daylight');
  });

  it('resolves "Follow system" from the OS preference', () => {
    mockSystem(false);
    expect(resolveTheme('system')).toBe('light');
    mockSystem(true);
    expect(resolveTheme('system')).toBe('dark');
  });
});

describe('applyTheme', () => {
  it('sets the attribute the stylesheet keys on and the browser chrome color', () => {
    document.head.innerHTML = '<meta name="theme-color" content="#0b1020" />';
    expect(applyTheme('light')).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute('content')).toBe('#f1f5f9');
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute('content')).toBe('#0b1020');
  });
});

describe('followSystemTheme', () => {
  it('re-applies when the OS switches, and stops when unsubscribed', () => {
    const os = mockSystem(true);
    applyTheme('system');
    const stop = followSystemTheme('system');
    os.flip(false);
    expect(document.documentElement.dataset.theme).toBe('light');
    stop();
    expect(os.listeners.size).toBe(0);
  });

  it('does not listen for an explicit choice', () => {
    const os = mockSystem(true);
    followSystemTheme('light');
    expect(os.listeners.size).toBe(0);
  });
});

/**
 * Each theme block sets only tokens the dark base defines: a misspelled name
 * there is a color no element reads, and the theme silently keeps the dark one.
 */
describe('theme blocks', () => {
  it('name only tokens the dark base defines', () => {
    const css = readFileSync(join(__dirname, '../../../src/index.css'), 'utf8');
    const base = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]!).join('\n');
    const defined = new Set([...base.matchAll(/--c-([\w-]+)\s*:/g)].map((m) => m[1]!));
    const themed = [...css.matchAll(/:root\[data-theme=[^\]]+\][^{]*\{([^}]*)\}/g)].map((m) => m[1]!);
    expect(themed.length).toBeGreaterThanOrEqual(2);
    const names = themed.flatMap((b) => [...b.matchAll(/--c-([\w-]+)\s*:/g)].map((m) => m[1]!));
    expect(names.length).toBeGreaterThan(50);
    expect(names.filter((n) => !defined.has(n))).toEqual([]);
  });
});

describe('toggleDaylight', () => {
  it('remembers the theme it leaves and goes back to it', () => {
    expect(toggleDaylight('system', 'dark')).toEqual({ theme: 'daylight', themeBeforeDaylight: 'system' });
    expect(toggleDaylight('daylight', 'system')).toEqual({ theme: 'system', themeBeforeDaylight: 'system' });
  });
});
