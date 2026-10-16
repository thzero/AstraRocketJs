// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { SiteFields, type ToolSite } from '../../../src/components/tools/SiteFields';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { setLaunchLocationStore, type LaunchLocation } from '../../../src/services/storage/launchLocationStore';
import { loadSettings } from '../../../src/services/storage/settings';

const HOME: LaunchLocation = {
  id: 'home',
  name: 'Home field',
  latitudeDeg: 39.05,
  longitudeDeg: -104.8,
  launchAltitudeM: 1830,
};

describe('SiteFields', () => {
  // A tool's starting site and its map pick leave the elevation to the terrain
  // model; Custom location is a third way back to the defaults and has to agree.
  it('returns to the launch defaults with the elevation left to the terrain model', async () => {
    setLaunchLocationStore({ list: async () => [HOME], save: async () => {}, remove: async () => {} });
    let site: ToolSite = { latitudeDeg: 39.05, longitudeDeg: -104.8, launchAltitudeM: 1830 };
    const onChange = vi.fn((update: (s: ToolSite) => ToolSite) => {
      site = update(site);
    });
    renderWithProviders(<SiteFields site={site} onChange={onChange} />);
    const select = () => screen.getByRole('combobox') as HTMLSelectElement;
    await waitFor(() => expect(select().value).toBe('home'));

    fireEvent.change(select(), { target: { value: '' } });
    const defaults = loadSettings().launchDefaults;
    expect(site).toEqual({
      latitudeDeg: defaults.latitudeDeg,
      longitudeDeg: defaults.longitudeDeg,
      launchAltitudeM: null,
    });
  });
});
