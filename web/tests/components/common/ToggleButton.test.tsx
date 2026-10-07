// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { ToggleButton } from '../../../src/components/common/ToggleButton';
import { Segmented } from '../../../src/components/common/Segmented';

describe('ToggleButton', () => {
  it('says it is pressed, or current for a tab-like set', () => {
    renderWithProviders(
      <>
        <ToggleButton active onClick={() => {}}>
          On
        </ToggleButton>
        <ToggleButton active current onClick={() => {}}>
          Tab
        </ToggleButton>
      </>,
    );
    expect(screen.getByRole('button', { name: 'On' }).getAttribute('aria-pressed')).toBe('true');
    const tab = screen.getByRole('button', { name: 'Tab' });
    expect(tab.getAttribute('aria-current')).toBe('true');
    expect(tab.hasAttribute('aria-pressed')).toBe(false);
  });
});

describe('Segmented', () => {
  it('marks the chosen option and reports a new one', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <Segmented options={['a', 'b'] as const} value="a" onChange={onChange} fmt={(v) => v.toUpperCase()} />,
    );
    expect(screen.getByRole('button', { name: 'A' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'B' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('disables every button, so the keyboard cannot flip it either', () => {
    renderWithProviders(<Segmented options={[1, 2]} value={1} onChange={() => {}} fmt={String} disabled />);
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true);
  });
});
