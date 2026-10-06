// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { DeploymentSection } from '../../../src/components/config/DeploymentSection';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';
import type { FlightConfig } from '../../../src/services/flight/flightConfigs';

describe('DeploymentSection', () => {
  it("names the kernel's event and altitude for a device that sets neither", () => {
    // The bridge leaves an absent key at OpenRocket's own default, so this
    // device opens on the ejection charge, and "As designed" has to say so.
    const device = { type: 'parachute', id: 'chute', name: 'Main' } as ComponentNode;
    const config = { id: 'c', name: null, motors: {} } as FlightConfig;
    renderWithProviders(<DeploymentSection config={config} device={device} />);
    const select = screen.getByRole('combobox', { name: /Main/ }) as HTMLSelectElement;
    expect(select.options[0]!.textContent).toMatch(/ejection/i);
    const altitude = screen.getByRole('spinbutton', { name: /Main - .*altitude/i }) as HTMLInputElement;
    expect(altitude.placeholder).toMatch(/^200/);
  });
});
