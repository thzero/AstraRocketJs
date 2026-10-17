// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NumberInput, parseFieldValue } from '../../../src/components/common/NumberInput';
import { renderWithProviders } from '../../testing/renderWithProviders';

/**
 * Every numeric field in the app funnels through here, so this is the one
 * place worth holding to "nothing that is not a real number gets out".
 *
 * A NaN check and a clamp are not enough on their own: `parseFloat("1e999")` is
 * `Infinity`, `Number.isNaN` says no, and the clamp cannot help because
 * `Infinity < min` is false and most callers pass no `max` at all. An Infinity
 * that gets out reaches the node, is persisted, exported to `.ork`, and read back
 * as `0` by `num()`, so the field shows Infinity while the geometry behaves as if
 * the dimension were absent.
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
  // rendered input: jsdom sanitizes "1e999" on a type="number" field to an
  // empty value, so a DOM test of it passes for the wrong reason.
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

  /**
   * The blurred box shows the noise-trimmed value, and focusing it must seed the
   * draft with that same text. Seeded with `String(value)`, a unit-converted
   * 0.1 + 0.2 turns into "0.30000000000000004" the moment the user clicks in.
   */
  it('seeds the editing draft with the same trimmed text the box showed', () => {
    cleanup();
    renderWithProviders(<NumberInput value={0.1 + 0.2} onChange={() => {}} ariaLabel="len" />);
    const input = screen.getByLabelText('len') as HTMLInputElement;
    expect(input.value).toBe('0.3');
    fireEvent.focus(input);
    expect(input.value).toBe('0.3');
  });

  it('still clamps a typed value to the declared bounds', () => {
    // HTML min/max are only spinner hints; a typed-in value ignores them.
    expect(type('-5', { min: 0 })).toHaveBeenCalledWith(0);
    expect(type('99', { min: 0, max: 10 })).toHaveBeenCalledWith(10);
  });
});

/**
 * commitOnBlur: for a field whose every value costs something to apply (the aero
 * sweep runs the kernel; a settings write hits storage), the typed value goes
 * out once, on blur or Enter, not per keystroke, and not at all if nothing was
 * typed.
 */
describe('NumberInput commitOnBlur', () => {
  it('reports once, on blur, and not per keystroke', () => {
    const onChange = vi.fn();
    renderWithProviders(<NumberInput value={1} onChange={onChange} commitOnBlur ariaLabel="Mach" />);
    const el = screen.getByLabelText('Mach');
    fireEvent.focus(el);
    fireEvent.change(el, { target: { value: '1' } });
    fireEvent.change(el, { target: { value: '12' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(el);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(12);
  });

  it('commits on Enter too', () => {
    const onChange = vi.fn();
    renderWithProviders(<NumberInput value={1} onChange={onChange} commitOnBlur ariaLabel="Mach" />);
    const el = screen.getByLabelText('Mach');
    fireEvent.focus(el);
    fireEvent.change(el, { target: { value: '3' } });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('reports nothing for a visit that typed nothing', () => {
    const onChange = vi.fn();
    renderWithProviders(<NumberInput value={1} onChange={onChange} commitOnBlur ariaLabel="Mach" />);
    const el = screen.getByLabelText('Mach');
    fireEvent.focus(el);
    fireEvent.blur(el);
    expect(onChange).not.toHaveBeenCalled();
  });
});

/**
 * A field unmounted mid-edit, as a dialog closed on Escape unmounts it. React
 * fires no blur for a removed node, so the typed value is reported by the
 * unmount, through the same rules a blur applies.
 */
describe('NumberInput commitOnBlur, unmounted mid-edit', () => {
  const typeThenUnmount = (value: string, props: { min?: number; max?: number } = {}) => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const { unmount } = renderWithProviders(
      <NumberInput value={1} onChange={onChange} onCommit={onCommit} commitOnBlur ariaLabel="step" {...props} />,
    );
    const el = screen.getByLabelText('step');
    fireEvent.focus(el);
    fireEvent.change(el, { target: { value } });
    expect(onChange).not.toHaveBeenCalled();
    unmount();
    return { onChange, onCommit };
  };

  it('reports the typed value, clamped, and closes the edit', () => {
    for (const [typed, want, bounds] of [
      ['0.005', 0.005, {}],
      ['12', 12, { min: 0 }],
      ['-3', 0, { min: 0 }],
      ['500', 10, { min: 0, max: 10 }],
    ] as const) {
      const { onChange, onCommit } = typeThenUnmount(typed, bounds);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(want);
      expect(onCommit).toHaveBeenCalledTimes(1);
    }
  });

  it('reports a cleared box as cleared', () => {
    expect(typeThenUnmount('').onChange).toHaveBeenCalledWith(null);
  });

  it('reports nothing for a visit that typed nothing', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const { unmount } = renderWithProviders(
      <NumberInput value={1} onChange={onChange} onCommit={onCommit} commitOnBlur ariaLabel="step" />,
    );
    fireEvent.focus(screen.getByLabelText('step'));
    unmount();
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('does not report again an edit a blur already reported', () => {
    const onChange = vi.fn();
    const { unmount } = renderWithProviders(
      <NumberInput value={1} onChange={onChange} commitOnBlur ariaLabel="step" />,
    );
    const el = screen.getByLabelText('step');
    fireEvent.focus(el);
    fireEvent.change(el, { target: { value: '4' } });
    fireEvent.blur(el);
    unmount();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('reports to the latest handler, not the one from the first render', () => {
    const first = vi.fn();
    const second = vi.fn();
    // A bare render, so the rerender updates this input rather than replacing it.
    const { rerender, unmount } = render(<NumberInput value={1} onChange={first} commitOnBlur ariaLabel="step" />);
    const el = screen.getByLabelText('step');
    fireEvent.focus(el);
    fireEvent.change(el, { target: { value: '6' } });
    rerender(<NumberInput value={1} onChange={second} commitOnBlur ariaLabel="step" />);
    unmount();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(6);
  });
});
