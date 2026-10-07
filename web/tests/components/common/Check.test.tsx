// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { Check } from '../../../src/components/common/Check';
import { renderWithProviders } from '../../testing/renderWithProviders';

describe('Check', () => {
  it('is named by its label and reports the new state', () => {
    const onChange = vi.fn();
    renderWithProviders(<Check checked={false} onChange={onChange} label="Show vectors" />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show vectors' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('disables the box and fades the row', () => {
    renderWithProviders(<Check checked onChange={() => {}} label="Nose templates" disabled />);
    const box = screen.getByRole('checkbox', { name: 'Nose templates' });
    expect((box as HTMLInputElement).disabled).toBe(true);
    expect(box.closest('label')!.className).toContain('opacity-40');
  });

  it('puts a hint under the row', () => {
    renderWithProviders(<Check checked onChange={() => {}} label="Fly it" hint="Changes the flight." />);
    expect(screen.getByText('Changes the flight.')).toBeTruthy();
  });
});
