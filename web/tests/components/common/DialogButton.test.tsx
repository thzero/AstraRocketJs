// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { DialogButton } from '../../../src/components/common/DialogButton';

describe('DialogButton', () => {
  it('is a plain button that does not submit a form, and passes its props through', () => {
    const onClick = vi.fn();
    renderWithProviders(
      <DialogButton variant="primary" onClick={onClick} autoFocus>
        OK
      </DialogButton>,
    );
    const b = screen.getByRole('button', { name: 'OK' });
    expect(b.getAttribute('type')).toBe('button');
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalled();
  });

  it('looks disabled the same way in every variant', () => {
    renderWithProviders(
      <>
        <DialogButton variant="primary" disabled>
          A
        </DialogButton>
        <DialogButton disabled>B</DialogButton>
      </>,
    );
    for (const name of ['A', 'B']) {
      expect(screen.getByRole('button', { name }).className).toContain('disabled:opacity-50');
    }
  });
});
