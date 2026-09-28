// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useUnits, type Units } from '../../src/prefs/useUnits';
import { unitScope } from '../../src/prefs/units';
import { renderWithProviders, seedSettings } from '../testing/renderWithProviders';

const SCOPE = unitScope('prop', 'nosecone', 'length');

/** Renders nothing useful; it just exposes the hook's output to the test. */
function Probe({ read }: { read: (u: Units) => string }) {
  return <span>{read(useUnits())}</span>;
}

/**
 * One reading of the hook. It unmounts immediately so several calls can sit in
 * one test without their probes piling up in the same document.
 */
const value = (read: (u: Units) => string): string => {
  const { container, unmount } = renderWithProviders(<Probe read={read} />);
  const text = container.textContent ?? '';
  unmount();
  return text;
};

/**
 * The conversions are covered in units.test.ts; what is NOT covered there is
 * the wiring — that `at()` actually consults the per-field layer while the
 * quantity-level calls deliberately don't, which is the whole contract the
 * rest of the UI is written against.
 */
describe('useUnits', () => {
  beforeEach(() => localStorage.clear());

  it('reads the preferences for the quantity-level helpers', () => {
    seedSettings({ units: { length: 'in' } });
    expect(value((u) => u.sym('length'))).toBe('in');
    expect(value((u) => u.fmt('length', 0.0254, 2))).toBe('1.00');
  });

  it('gives a field its own unit through at()', () => {
    seedSettings({ units: { length: 'cm' }, unitOverrides: { [SCOPE]: 'in' } });
    expect(value((u) => u.at(SCOPE, 'length').sym)).toBe('in');
    expect(value((u) => String(u.at(SCOPE, 'length').toUi(0.0254)))).toBe('1');
  });

  it('leaves the quantity-level helpers on the preference, overrides or not', () => {
    // This is what keeps a chip from leaking into the tree, the rulers and the
    // exports, all of which take the quantity-level calls.
    seedSettings({ units: { length: 'cm' }, unitOverrides: { [SCOPE]: 'in' } });
    expect(value((u) => u.sym('length'))).toBe('cm');
    expect(value((u) => String(u.factor('length')))).toBe('100');
  });

  it('falls back to the preference for a field with no override', () => {
    seedSettings({ units: { length: 'mm' }, unitOverrides: { [SCOPE]: 'in' } });
    const other = unitScope('prop', 'nosecone', 'thickness');
    expect(value((u) => u.at(other, 'length').sym)).toBe('mm');
  });

  it('round-trips a typed value through a field with its own unit', () => {
    seedSettings({ units: { length: 'cm' }, unitOverrides: { [SCOPE]: 'in' } });
    // 24 in is 0.6096 m underneath, and reads back as 24 in. Compared as
    // numbers, not strings: 24 * 0.0254 is 0.6095999999999999 in binary float,
    // and pinning that spelling would be testing IEEE-754, not the units.
    expect(Number(value((u) => String(u.at(SCOPE, 'length').fromUi(24))))).toBeCloseTo(0.6096, 12);
    expect(Number(value((u) => String(u.at(SCOPE, 'length').toUi(0.6096))))).toBeCloseTo(24, 9);
  });

  it('shows an em dash rather than a confident zero for an absent value', () => {
    // The kernel emits null for NaN/Infinity and `null / toSI` is 0, which
    // would print a missing apogee as 0.
    expect(value((u) => u.fmt('distance', NaN))).toBe('—');
    expect(value((u) => u.at(SCOPE, 'length').fmt(Number.POSITIVE_INFINITY))).toBe('—');
  });
});
