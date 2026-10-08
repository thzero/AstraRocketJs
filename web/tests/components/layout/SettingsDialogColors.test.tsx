// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { SettingsDialog } from '../../../src/components/layout/SettingsDialog';
import { readSettings, renderWithProviders } from '../../testing/renderWithProviders';

/**
 * A color in Settings is written when the picker closes, not on every drag tick:
 * each tick would write the whole settings object to storage, dozens of writes
 * per gesture.
 */
describe('Settings colors', () => {
  beforeEach(() => localStorage.clear());

  it('writes the phase color once, when the picker closes', () => {
    renderWithProviders(<SettingsDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Colors' }));
    const boost = screen.getByLabelText('Boost') as HTMLInputElement;
    fireEvent.input(boost, { target: { value: '#123456' } });
    expect((readSettings()['phaseColors'] as Record<string, string> | undefined)?.['boost']).not.toBe('#123456');
    fireEvent.change(boost, { target: { value: '#123456' } });
    expect((readSettings()['phaseColors'] as Record<string, string>)['boost']).toBe('#123456');
  });
});
