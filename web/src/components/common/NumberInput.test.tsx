// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { NumberInput, parseFieldValue } from './NumberInput';
import { renderWithProviders } from '../../testing/renderWithProviders';

/**
 * Every numeric field in the app funnels through here, so this is the one
 * place worth holding to "nothing that is not a real number gets out".
 *
 * It rejected NaN and clamped to the declared bounds, but `Infinity` slipped
 * through both: `<input type="number">` accepts "1e999" as a valid
 * floating-point string, `parseFloat` returns `Infinity`, `Number.isNaN` says
 * no, and the clamp cannot help because `Infinity < min` is false and most
 * callers pass no `max` at all. It reached the node, was persisted, exported
 * to `.ork`, and read back as `0` by `num()` - so the field showed Infinity
 * while the geometry behaved as if the dimension were simply absent.
 */
describe('NumberInput', () => {
  const type = (value: string, props: { min?: number; max?: number } = {}) => {
    cleanup(); // several renders per test: RTL only auto-cleans between tests
    const onChange = vi.fn();
    renderWithProviders(<NumberInput value={1} onChange={onChange} ariaLabel="len" {...props} />);
    fireEvent.change(screen.getByLabelText('len'), { target: { value } });
    return onChange;
  };

  it('reports a plain number', () => {
    expect(type('2.5')).toHaveBeenCalledWith(2.5);
  });

  it('reports null for an empty field', () => {
    expect(type('')).toHaveBeenCalledWith(null);
  });

  // The overflow cases are asserted against parseFieldValue rather than the
  // rendered input: jsdom refuses to deliver "1e999" to a type="number" field
  // at all, so a DOM test of it passes for the wrong reason. A real browser
  // does deliver it, which is how Infinity reached the geometry.
  it('reports null for Infinity rather than letting it reach the geometry', () => {
    expect(parseFieldValue('1e999')).toBeNull();
    expect(parseFieldValue('-1e999')).toBeNull();
  });

  it('never returns a non-finite value for anything a field can hold', () => {
    for (const raw of ['1e999', '-1e999', 'abc', '', 'Infinity', '-Infinity', '1e400', 'NaN']) {
      const v = parseFieldValue(raw, 0, 100);
      expect(v === null || Number.isFinite(v)).toBe(true);
    }
  });

  it('still parses and clamps ordinary values', () => {
    expect(parseFieldValue('2.5')).toBe(2.5);
    expect(parseFieldValue('-5', 0)).toBe(0);
    expect(parseFieldValue('99', 0, 10)).toBe(10);
    expect(parseFieldValue('')).toBeNull();
  });

  it('still clamps a typed value to the declared bounds', () => {
    // HTML min/max are only spinner hints; a typed-in value ignores them.
    expect(type('-5', { min: 0 })).toHaveBeenCalledWith(0);
    expect(type('99', { min: 0, max: 10 })).toHaveBeenCalledWith(10);
  });
});
