// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NumberInput } from '../../../src/components/common/NumberInput';

/**
 * Clearing a delay box to retype must not commit a delay.
 *
 * With a raw `<input type="number">` and `… ?? 0`, the fallback fires the moment
 * the field goes empty: `MotorDialog`'s custom ejection delay would store a
 * 0-second charge, and `MotorRow`'s ignition delay a 0-second air-start. Both are
 * values the kernel flies, and both would be committed by the ordinary act of
 * selecting the text and pressing Backspace before typing the real number.
 *
 * `NumberInput` prevents this: it holds the keystrokes in a draft buffer and
 * reports `null` for an empty field.
 */
afterEach(cleanup);

describe('a cleared number box reports null rather than zero', () => {
  it('reports null, not 0, when the field is emptied', () => {
    const onChange = vi.fn();
    render(<NumberInput value={5} onChange={onChange} min={0} ariaLabel="delay" />);
    const box = screen.getByLabelText('delay');
    fireEvent.change(box, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(null);
    expect(onChange).not.toHaveBeenCalledWith(0);
  });

  it('reports the number once one is typed', () => {
    const onChange = vi.fn();
    render(<NumberInput value={5} onChange={onChange} min={0} ariaLabel="delay" />);
    const box = screen.getByLabelText('delay');
    fireEvent.change(box, { target: { value: '' } });
    fireEvent.change(box, { target: { value: '7' } });
    expect(onChange).toHaveBeenLastCalledWith(7);
  });

  it('clamps a typed value into the declared bounds', () => {
    // The HTML min/max are spinner hints only; the clamp is what keeps an
    // out-of-range delay out of the kernel.
    const onChange = vi.fn();
    render(<NumberInput value={5} onChange={onChange} min={0} max={10} ariaLabel="delay" />);
    fireEvent.change(screen.getByLabelText('delay'), { target: { value: '-3' } });
    expect(onChange).toHaveBeenLastCalledWith(0);
  });
});
