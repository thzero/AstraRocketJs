// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { CheckMenu } from '../../../src/components/common/CheckMenu';
import { Dialog } from '../../../src/components/common/Dialog';
import { renderWithProviders } from '../../testing/renderWithProviders';

describe('CheckMenu', () => {
  const items = [
    { key: 'a', label: 'Alpha', checked: true },
    { key: 'b', label: 'Bravo', checked: false },
  ];

  it('names each box by its label and reports the key toggled', () => {
    const onToggle = vi.fn();
    renderWithProviders(<CheckMenu summary="Columns" items={items} onToggle={onToggle} width="w-56" />);
    expect((screen.getByRole('checkbox', { name: 'Alpha' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bravo' }));
    expect(onToggle).toHaveBeenCalledWith('b');
  });

  it('renders children above the items and hangs from the chosen edge', () => {
    const { container } = renderWithProviders(
      <CheckMenu summary="Makers" items={items} onToggle={() => {}} width="w-64" align="right">
        <button>All</button>
      </CheckMenu>,
    );
    const panel = container.querySelector('details > div')!;
    expect(panel.className).toContain('right-0');
    expect(panel.className).toContain('w-64');
    expect(panel.firstElementChild!.textContent).toBe('All');
  });
});

describe('an open CheckMenu', () => {
  const items = [{ key: 'a', label: 'Alpha', checked: true }];

  const openIn = () => {
    const onClose = vi.fn();
    const r = renderWithProviders(
      <Dialog id="check-menu-host" title="Host" onClose={onClose}>
        <CheckMenu summary="Columns" items={items} onToggle={() => {}} width="w-56" />
        <p>outside</p>
      </Dialog>,
    );
    const details = r.container.querySelector('details')!;
    act(() => {
      details.open = true;
      fireEvent(details, new Event('toggle'));
    });
    expect(details.open).toBe(true);
    return { details, onClose };
  };

  it('closes on Escape without closing the dialog it sits in', () => {
    const { details, onClose } = openIn();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(details.open).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(details.querySelector('summary'));
  });

  it('closes on a press outside it', () => {
    const { details } = openIn();
    fireEvent.pointerDown(screen.getByText('outside'));
    expect(details.open).toBe(false);
  });

  it('stays open on a press inside it', () => {
    const { details } = openIn();
    fireEvent.pointerDown(screen.getByRole('checkbox', { name: 'Alpha' }));
    expect(details.open).toBe(true);
  });
});
