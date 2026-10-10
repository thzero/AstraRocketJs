// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { ColorInput } from '../../../src/components/common/ColorInput';

describe('ColorInput', () => {
  it('writes nothing while the picker is dragged, and commits once when it closes', () => {
    const onCommit = vi.fn();
    renderWithProviders(<ColorInput value="#000000" onCommit={onCommit} ariaLabel="Fill" />);
    const el = screen.getByLabelText('Fill') as HTMLInputElement;
    fireEvent.input(el, { target: { value: '#111111' } });
    fireEvent.input(el, { target: { value: '#222222' } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.change(el, { target: { value: '#333333' } });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('#333333');
  });

  it('commits on blur when the picker closed without a change event', () => {
    const onCommit = vi.fn();
    renderWithProviders(<ColorInput value="#000000" onCommit={onCommit} ariaLabel="Fill" />);
    const el = screen.getByLabelText('Fill') as HTMLInputElement;
    el.value = '#445566';
    fireEvent.blur(el);
    expect(onCommit).toHaveBeenCalledWith('#445566');
  });

  it('commits every pick, not only the first, when the value round-trips through state', () => {
    const onCommit = vi.fn();
    function Saved() {
      const [color, setColor] = useState('#000000');
      return (
        <ColorInput
          value={color}
          onCommit={(c) => {
            onCommit(c);
            setColor(c);
          }}
          ariaLabel="Fill"
        />
      );
    }
    renderWithProviders(<Saved />);
    fireEvent.change(screen.getByLabelText('Fill'), { target: { value: '#111111' } });
    fireEvent.change(screen.getByLabelText('Fill'), { target: { value: '#222222' } });
    expect(onCommit.mock.calls.map((c) => c[0])).toEqual(['#111111', '#222222']);
  });

  it('shows a value changed from elsewhere', () => {
    const { rerender } = renderWithProviders(<ColorInput value="#000000" onCommit={() => {}} ariaLabel="Fill" />);
    rerender(<ColorInput value="#abcdef" onCommit={() => {}} ariaLabel="Fill" />);
    expect((screen.getByLabelText('Fill') as HTMLInputElement).value).toBe('#abcdef');
  });
});
