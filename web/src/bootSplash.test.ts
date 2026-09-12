// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { showEngineStatus, showEngineFailed } from './bootSplash';

// Mirrors the splash markup in index.html.
const mountSplash = () => {
  document.body.innerHTML = `
    <div id="boot">
      <div class="bar indeterminate" id="boot-bar"><i></i></div>
      <div class="cap" id="boot-cap">Loading engine…</div>
    </div>`;
};

const cap = () => document.getElementById('boot-cap')!;
const bar = () => document.getElementById('boot-bar')!;
const fill = () => bar().firstElementChild as HTMLElement;

beforeEach(mountSplash);

describe('boot splash', () => {
  it('shows a determinate bar once the host declares a length', () => {
    showEngineStatus({ phase: 'downloading', loaded: 1_150_000, total: 2_300_000 });
    expect(bar().classList.contains('indeterminate')).toBe(false);
    expect(fill().style.width).toBe('50%');
    expect(cap().textContent).toMatch(/1\.1/);
    expect(cap().textContent).toMatch(/2\.2/);
  });

  it('stays indeterminate when no content-length was declared', () => {
    showEngineStatus({ phase: 'downloading', loaded: 0, total: null });
    expect(bar().classList.contains('indeterminate')).toBe(true);
    // No percentage is invented from an unknown total.
    expect(cap().textContent).not.toMatch(/%/);
  });

  it('reports bytes so far when the total is unknown', () => {
    showEngineStatus({ phase: 'downloading', loaded: 524_288, total: null });
    expect(cap().textContent).toMatch(/0\.5/);
    expect(bar().classList.contains('indeterminate')).toBe(true);
  });

  it('sweeps rather than sitting at 100% while compiling', () => {
    showEngineStatus({ phase: 'downloading', loaded: 2_300_000, total: 2_300_000 });
    expect(fill().style.width).toBe('100%');

    // Compile has no measurable progress; a full static bar would claim it is done.
    showEngineStatus({ phase: 'starting' });
    expect(bar().classList.contains('indeterminate')).toBe(true);
    expect(fill().style.width).toBe('');
  });

  it('clamps a total that under-reports the real transfer size', () => {
    // Servers behind compression can declare less than they deliver.
    showEngineStatus({ phase: 'downloading', loaded: 3_000_000, total: 2_300_000 });
    expect(fill().style.width).toBe('100%');
  });

  it('does nothing when React has already replaced the splash', () => {
    document.body.innerHTML = '<div id="root"></div>';
    expect(() => showEngineStatus({ phase: 'downloading', loaded: 1, total: 2 })).not.toThrow();
    expect(() => showEngineStatus({ phase: 'starting' })).not.toThrow();
    expect(() => showEngineFailed()).not.toThrow();
  });

  it('reports an engine failure in the caption', () => {
    showEngineFailed();
    expect(cap().textContent).toBeTruthy();
    expect(cap().textContent).not.toBe('Loading engine…');
  });
});
