// @vitest-environment jsdom
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { LocationPicker } from './LocationPicker';
import { renderWithProviders } from '../../testing/renderWithProviders';
import {
  setLaunchLocationStore,
  type LaunchLocation,
  type LaunchLocationStore,
} from '../../services/launchLocationStore';
import type { LaunchConditions } from '../../services/orkTree';

/**
 * The picker, with an in-memory store so nothing touches IndexedDB.
 *
 * Rendered under StrictMode for the same reason MaterialPicker's test is: the
 * store round-trip finishes after an await behind a `mounted` ref, and the
 * development double-invoke runs the cleanup once and then the effect again —
 * a guard that is only ever cleared in cleanup stays false for the component's
 * whole life, and the location list never appears.
 */

function memoryStore(seed: LaunchLocation[] = []): LaunchLocationStore {
  let items = [...seed];
  return {
    list: async () => items,
    save: async (p) => {
      items = [p, ...items.filter((x) => x.id !== p.id)];
    },
    remove: async (id) => {
      items = items.filter((x) => x.id !== id);
    },
  };
}

const HOME: LaunchLocation = {
  id: 'home',
  name: 'Home field',
  latitudeDeg: 39.05,
  longitudeDeg: -104.8,
  launchAltitudeM: 1830,
};

/** Only the site fields matter here; the rest is what the panel would pass. */
const launch = (over: Partial<LaunchConditions> = {}): LaunchConditions =>
  ({
    launchRodLengthM: 1,
    launchRodAngleDeg: 0,
    windAverage: 2,
    windStdDev: 0.2,
    launchAltitudeM: 0,
    latitudeDeg: 28.6,
    longitudeDeg: -80.6,
    temperatureC: null,
    pressureHPa: null,
    ...over,
  }) as LaunchConditions;

const render = (props: Partial<Parameters<typeof LocationPicker>[0]> = {}) => {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  renderWithProviders(
    <StrictMode>
      <LocationPicker launch={launch()} onChange={onChange} onCommit={onCommit} {...props} />
    </StrictMode>,
  );
  return { onChange, onCommit };
};

describe('LocationPicker', () => {
  beforeEach(() => setLaunchLocationStore(memoryStore([HOME])));

  it('lists saved locations after the store round-trip', async () => {
    render();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Home field' })).toBeTruthy());
  });

  it('applies the three site fields, and nothing else', async () => {
    const { onChange, onCommit } = render();
    await waitFor(() => screen.getByRole('option', { name: 'Home field' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'home' } });

    // Exactly the location's three fields: a location is a PLACE, so restoring the rod or
    // the wind with it would put last month's conditions on today's flight.
    expect(onChange).toHaveBeenCalledWith({
      latitudeDeg: 39.05,
      longitudeDeg: -104.8,
      launchAltitudeM: 1830,
    });
    // Committed, so applying a location is one undo step rather than none.
    expect(onCommit).toHaveBeenCalled();
  });

  it('clears the site when Custom location is picked from a saved location', async () => {
    // The complaint this covers: the option was inert. The select's value is
    // derived from the fields, so choosing it changed nothing and React put the
    // matching location straight back — you could highlight it but never pick it.
    const { onChange, onCommit } = render({
      launch: launch({ latitudeDeg: 39.05, longitudeDeg: -104.8, launchAltitudeM: 1830 }),
    });
    const select = () => screen.getByRole('combobox') as HTMLSelectElement;
    await waitFor(() => expect(select().value).toBe('home'));

    fireEvent.change(select(), { target: { value: '' } });
    // Cleared, not defaulted: the three fields go blank the way "use my
    // location" or typing over them would leave them, and the Run button names
    // a blank required launch field, so the state is explained rather than hidden.
    // Null, not undefined: `JSON.stringify` drops an undefined property, so a
    // cleared longitude would come back from the defaults on the next reload.
    expect(onChange).toHaveBeenCalledWith({
      latitudeDeg: null,
      longitudeDeg: null,
      launchAltitudeM: null,
    });
    expect(onCommit).toHaveBeenCalled();
  });

  it('shows Custom when the fields match no saved location, and the location when they do', async () => {
    render();
    const select = () => screen.getByRole('combobox') as HTMLSelectElement;
    await waitFor(() => screen.getByRole('option', { name: 'Home field' }));
    // The default launch is Florida, not the saved Colorado field.
    expect(select().value).toBe('');

    // Re-rendered with the location's own coordinates, the select recognizes it —
    // matched on the NUMBERS, so a location applied, imported from a `.ork` or set
    // by "use my location" is recognized the same way.
    renderWithProviders(
      <LocationPicker
        launch={launch({ latitudeDeg: 39.05, longitudeDeg: -104.8, launchAltitudeM: 1830 })}
        onChange={vi.fn()}
      />,
    );
    await waitFor(() => {
      const matches = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(matches.some((s) => s.value === 'home')).toBe(true);
    });
  });

  it('saves the fields on screen under a name', async () => {
    render();
    await waitFor(() => screen.getByRole('option', { name: 'Home field' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save this location' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'The Cape' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByRole('option', { name: 'The Cape' })).toBeTruthy());
    const saved = await setPadThenList();
    expect(saved.find((p) => p.name === 'The Cape')).toMatchObject({
      latitudeDeg: 28.6,
      longitudeDeg: -80.6,
      launchAltitudeM: 0,
    });
  });

  it('updates a location rather than duplicating it when the name is reused', async () => {
    // Two entries called "Home field" in a dropdown cannot be told apart, so
    // saving over the name is an update.
    render();
    await waitFor(() => screen.getByRole('option', { name: 'Home field' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save this location' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Home field' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => {
      const list = await setPadThenList();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id: 'home', latitudeDeg: 28.6 });
    });
  });

  it('says so when the store refuses the write', async () => {
    // The user holds the only copy of what they just typed; a clean resolve
    // over a refused write leaves a list that simply lacks it.
    setLaunchLocationStore({
      list: async () => [],
      save: async () => {
        throw new Error('storage-full');
      },
      remove: async () => undefined,
    });
    render();
    fireEvent.click(screen.getByRole('button', { name: 'Save this location' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Nowhere' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText(/could not be saved/i)).toBeTruthy());
  });

  it('manages saved locations: the list shows their coordinates', async () => {
    render();
    await waitFor(() => screen.getByRole('option', { name: 'Home field' }));
    fireEvent.click(screen.getByRole('button', { name: 'Manage saved locations' }));

    const dialog = await screen.findByRole('dialog', { name: 'Manage saved locations' });
    // The row that lets you tell two fields with the same name apart.
    expect(dialog.textContent).toContain('39.0500');
    // The elevation is formatted in the user's own unit, so it carries a
    // thousands separator — matched loosely rather than pinned to a locale.
    expect(dialog.textContent).toMatch(/1[,. ]?830\s*m/);
  });

  it('has nothing to manage before anything is saved', async () => {
    setLaunchLocationStore(memoryStore([]));
    render();
    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Manage saved locations' }) as HTMLButtonElement).disabled).toBe(true);
    });
  });
});

/** The live store's contents — the picker refreshes from it after every write. */
async function setPadThenList(): Promise<LaunchLocation[]> {
  const { getLaunchLocationStore } = await import('../../services/launchLocationStore');
  return getLaunchLocationStore().list();
}
