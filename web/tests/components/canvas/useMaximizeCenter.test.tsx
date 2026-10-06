// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { useMaximizeCenter } from '../../../src/components/canvas/useMaximizeCenter';
import { AlertDialog } from '../../../src/components/common/AlertDialog';
import { useMenuPopover } from '../../../src/components/common/useMenuPopover';
import { renderWithProviders, seedSettings } from '../../testing/renderWithProviders';

/** The maximize state, with an alert that can be raised over it. */
function Host() {
  const { maxed } = useMaximizeCenter();
  const [asking, setAsking] = useState(true);
  return (
    <>
      <p>{maxed ? 'maxed' : 'normal'}</p>
      {asking && (
        <AlertDialog
          title="Close?"
          message="Sure?"
          confirmLabel="OK"
          onConfirm={() => {}}
          onCancel={() => setAsking(false)}
        />
      )}
    </>
  );
}

describe('useMaximizeCenter', () => {
  beforeEach(() => {
    localStorage.clear();
    seedSettings({ maximizeCenter: true });
  });

  it('leaves Escape to an open alert, then takes the next one', () => {
    renderWithProviders(<Host />);
    fireEvent.keyDown(window, { key: 'Escape' });
    // The alert closes; the drawing stays maximized.
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText('maxed')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByText('normal')).toBeTruthy();
  });

  it('leaves Escape to an open menu, then takes the next one', () => {
    function MenuHost() {
      const { maxed } = useMaximizeCenter();
      const { open, toggle, wrapRef, triggerRef } = useMenuPopover();
      return (
        <div ref={wrapRef}>
          <p>{maxed ? 'maxed' : 'normal'}</p>
          <button ref={triggerRef} onClick={toggle}>
            Export
          </button>
          {open && <div role="menu" />}
        </div>
      );
    }
    renderWithProviders(<MenuHost />);
    fireEvent.click(screen.getByText('Export'));
    fireEvent.keyDown(screen.getByText('Export'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByText('maxed')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByText('normal')).toBeTruthy();
  });
});
