// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { CheckMenu } from '../../../src/components/common/CheckMenu';
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
