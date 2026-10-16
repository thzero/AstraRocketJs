// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { NumberRow } from '../../../src/components/common/NumberRow';
import { renderWithProviders } from '../../testing/renderWithProviders';

/** `commitOnBlur` holds the edit until blur; without it each keystroke reports. */
describe('NumberRow', () => {
  it('reports each keystroke by default', () => {
    const onChange = vi.fn();
    renderWithProviders(<NumberRow label="Height" value={1} onChange={onChange} />);
    const box = screen.getByRole('spinbutton', { name: 'Height' });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '12' } });
    expect(onChange).toHaveBeenCalledWith(12);
  });

  it('reports once, on blur, with commitOnBlur', () => {
    const onChange = vi.fn();
    renderWithProviders(<NumberRow label="Height" value={1} commitOnBlur onChange={onChange} />);
    const box = screen.getByRole('spinbutton', { name: 'Height' });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '1' } });
    fireEvent.change(box, { target: { value: '12' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(box);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(12);
  });
});
