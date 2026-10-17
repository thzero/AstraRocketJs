// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { MotorRow } from '../../../src/components/sim/MotorRow';
import { C6 } from '../../../src/engine/api';
import type { IgnitionEvent } from '../../../src/engine/openRocketEngine';

/**
 * The ignition control's scope and reset, as desktop has them.
 *
 * IgnitionSelectionDialog asks which configurations a change reaches, and
 * starts on this one for a mount with a motor. MotorConfigurationPanel's Reset
 * ignition is `MotorConfiguration.useDefaultIgnition`: Automatic, no delay, in
 * this configuration alone.
 */
afterEach(cleanup);

function row(event: IgnitionEvent, delay: number, everywhere = false) {
  const onIgnitionChange = vi.fn();
  renderWithProviders(
    <MotorRow
      motor={C6}
      onChange={() => {}}
      onError={() => {}}
      ignition={{ event, delay }}
      onIgnitionChange={onIgnitionChange}
      ignitionEverywhere={everywhere}
    />,
  );
  return onIgnitionChange;
}

describe('ignition scope and reset', () => {
  it('changes this configuration until "All configurations" is picked', () => {
    const onIgnitionChange = row('automatic', 0);
    const select = screen.getByRole('combobox', { name: 'Ignition' });
    fireEvent.change(select, { target: { value: 'burnout' } });
    expect(onIgnitionChange).toHaveBeenLastCalledWith('burnout', 0, 'config');

    fireEvent.click(screen.getByRole('radio', { name: 'All configurations' }));
    expect(screen.getByText(/in every configuration/)).toBeTruthy();
    fireEvent.change(select, { target: { value: 'launch' } });
    expect(onIgnitionChange).toHaveBeenLastCalledWith('launch', 0, 'all');
  });

  // Desktop's OK applies the dialog's values whether or not they were edited.
  it('applies the ignition as it stands to all configurations, unless they already have it', () => {
    const onIgnitionChange = row('launch', 1);
    expect(screen.queryByRole('button', { name: 'Apply to all configurations' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'All configurations' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply to all configurations' }));
    expect(onIgnitionChange).toHaveBeenLastCalledWith('launch', 1, 'all');
    cleanup();

    row('launch', 1, true);
    fireEvent.click(screen.getByRole('radio', { name: 'All configurations' }));
    expect((screen.getByRole('button', { name: 'Apply to all configurations' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('resets this configuration to Automatic with no delay', () => {
    const onIgnitionChange = row('burnout', 2);
    fireEvent.click(screen.getByRole('radio', { name: 'All configurations' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset ignition' }));
    expect(onIgnitionChange).toHaveBeenLastCalledWith('automatic', 0, 'config');
  });

  // A zero committed on clear would light an air-start at separation.
  it('commits no delay while the delay box is cleared to retype', () => {
    const onIgnitionChange = row('burnout', 2);
    const box = screen.getByRole('spinbutton', { name: 'Ignition delay (s)' });
    fireEvent.change(box, { target: { value: '' } });
    expect(onIgnitionChange).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: '3' } });
    expect(onIgnitionChange).toHaveBeenLastCalledWith('burnout', 3, 'config');
  });

  it('offers no reset when the ignition is already Automatic with no delay', () => {
    row('automatic', 0);
    expect((screen.getByRole('button', { name: 'Reset ignition' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
