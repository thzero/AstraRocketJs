// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { OverrideCard, OverrideNumber, OverrideSelect } from '../../../src/components/config/OverrideFields';

describe('OverrideFields', () => {
  it('labels each control with the part name and a plain hyphen', () => {
    renderWithProviders(
      <OverrideCard name="Main" overridden={false}>
        <OverrideSelect name="Main" label="Event" value={null} designed="Apogee" options={[]} onChange={() => {}} />
        <OverrideNumber
          name="Main"
          label="Delay"
          value={null}
          placeholder="0"
          step={0.5}
          min={0}
          unit="s"
          onChange={() => {}}
          onCommit={() => {}}
        />
      </OverrideCard>,
    );
    expect(screen.getByRole('combobox', { name: 'Main - Event' })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: 'Main - Delay' })).toBeTruthy();
  });

  it('reports null for "As designed" and the value for any other option', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <OverrideSelect
        name="Main"
        label="Event"
        value="altitude"
        designed="Apogee"
        options={[{ value: 'altitude', label: 'Altitude' }]}
        onChange={onChange}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Main - Event' });
    fireEvent.change(select, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
    fireEvent.change(select, { target: { value: 'altitude' } });
    expect(onChange).toHaveBeenLastCalledWith('altitude');
  });

  it('shows the Overridden badge only when something differs from the design', () => {
    const plain = renderWithProviders(
      <OverrideCard name="Main" overridden={false}>
        x
      </OverrideCard>,
    );
    expect(screen.queryByText(/overridden/i)).toBeNull();
    plain.unmount();
    renderWithProviders(
      <OverrideCard name="Main" overridden>
        x
      </OverrideCard>,
    );
    expect(screen.getByText(/overridden/i)).toBeTruthy();
  });
});
