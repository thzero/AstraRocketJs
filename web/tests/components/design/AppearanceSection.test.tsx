// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { AppearanceSection } from '../../../src/components/design/AppearanceSection';
import { renderWithProviders } from '../../testing/renderWithProviders';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';

/**
 * The part color is one undo step per pick: nothing while the OS picker is
 * dragged, one patch-and-commit when it closes, whether or not focus moved.
 */
describe('the part color', () => {
  const node = { type: 'bodytube', id: 'b', color: '#000000' } as unknown as ComponentNode;

  it('writes nothing while the picker is dragged and commits once when it closes', () => {
    const onCommitChange = vi.fn();
    renderWithProviders(<AppearanceSection node={node} onCommitChange={onCommitChange} />);
    const el = screen.getByLabelText('Color') as HTMLInputElement;
    fireEvent.input(el, { target: { value: '#111111' } });
    fireEvent.input(el, { target: { value: '#222222' } });
    expect(onCommitChange).not.toHaveBeenCalled();
    fireEvent.change(el, { target: { value: '#333333' } });
    expect(onCommitChange).toHaveBeenCalledTimes(1);
    expect(onCommitChange).toHaveBeenCalledWith({ color: '#333333' });
  });
});
