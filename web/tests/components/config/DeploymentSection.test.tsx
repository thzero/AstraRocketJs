// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { DeploymentSection } from '../../../src/components/config/DeploymentSection';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';
import type { FlightConfig } from '../../../src/services/flight/flightConfigs';
import { partName } from '../../../src/components/config/ConfigsTable';
import i18n from '../../../src/i18n';

describe('DeploymentSection', () => {
  it("names the kernel's event and altitude for a device that sets neither", () => {
    // The bridge leaves an absent key at OpenRocket's own default, so this
    // device opens on the ejection charge, and "As designed" has to say so.
    const device = { type: 'parachute', id: 'chute', name: 'Main' } as ComponentNode;
    const config = { id: 'c', name: null, motors: {} } as FlightConfig;
    renderWithProviders(<DeploymentSection config={config} device={device} index={0} />);
    const select = screen.getByRole('combobox', { name: /Main/ }) as HTMLSelectElement;
    expect(select.options[0]!.textContent).toMatch(/ejection/i);
    const altitude = screen.getByRole('spinbutton', { name: /Main - .*altitude/i }) as HTMLInputElement;
    expect(altitude.placeholder).toMatch(/^200/);
  });

  // The column headers name parts with partName, so the cards have to as well.
  it('names an unnamed device the way its column header does', () => {
    const config = { id: 'c', name: null, motors: {} } as FlightConfig;
    for (const name of [undefined, '   ']) {
      const device = { type: 'parachute', id: 'chute', name } as ComponentNode;
      const { unmount } = renderWithProviders(<DeploymentSection config={config} device={device} index={1} />);
      const header = partName(device, 1, i18n.t.bind(i18n));
      expect(header).toBe('Parachute 2');
      expect(screen.getByRole('combobox', { name: new RegExp(`^${header} - `) })).toBeTruthy();
      unmount();
    }
  });

  it('offers every deploy event the design field offers, lower stage separation included', () => {
    // DeployEvent in the kernel defines LOWER_STAGE_SEPARATION, and an imported
    // override with it has to show as itself, not as "As designed".
    const device = { type: 'parachute', id: 'chute', name: 'Main', deployEvent: 'apogee' } as ComponentNode;
    const config = {
      id: 'c',
      name: null,
      motors: {},
      deployments: { chute: { deployEvent: 'lower_stage_separation' } },
    } as unknown as FlightConfig;
    renderWithProviders(<DeploymentSection config={config} device={device} index={0} />);
    const select = screen.getByRole('combobox', { name: /Main/ }) as HTMLSelectElement;
    const values = [...select.options].map((o) => o.value).filter(Boolean);
    expect(values).toEqual(['apogee', 'ejection', 'altitude', 'launch', 'lower_stage_separation', 'never']);
    expect(select.value).toBe('lower_stage_separation');
  });
});
