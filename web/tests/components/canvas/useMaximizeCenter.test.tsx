// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { useMaximizeCenter } from '../../../src/components/canvas/useMaximizeCenter';
import { AlertDialog } from '../../../src/components/common/AlertDialog';
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
});
