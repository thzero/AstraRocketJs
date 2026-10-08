// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MaterialPicker } from '../../../src/components/design/MaterialPicker';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { setMaterialStore } from '../../../src/services/materials/materialStore';
import { serveData } from '../../testing/serveData';

/** The material select, not the density unit chip beside it. */
const materialSelect = () =>
  screen
    .getAllByRole('combobox')
    .find((s) => (s as HTMLSelectElement).querySelector('option[value="__default__"]')) as HTMLSelectElement;

/**
 * A catalog part brings its maker's material ("Balsa, bulk, BMS typical") at
 * its own density, and the part is weighed with it. Almost none of those names
 * are in the materials list, so the row has to show the part's own material
 * rather than call it "Not specified" and say it is weighed as cardboard.
 */
describe('a material the list does not hold', () => {
  beforeAll(serveData);
  beforeEach(() => setMaterialStore({ list: async () => [], add: async () => {}, remove: async () => {} }));

  it('shows as the part’s own material, with its density, and no "not specified" hint', async () => {
    renderWithProviders(<MaterialPicker value="Balsa, bulk, BMS typical" density={128} onChange={vi.fn()} />);
    const select = materialSelect();
    // Once the list has loaded, the name is still the selection.
    await waitFor(() => expect(select.options.length).toBeGreaterThan(3));
    expect(select.value).toBe('Balsa, bulk, BMS typical');
    expect(select.selectedOptions[0]!.parentElement!.getAttribute('label')).toBe('From this part');
    expect(select.selectedOptions[0]!.textContent).toBe('Balsa, bulk, BMS typical · 0.128 g/cm³');
    expect(screen.queryByText(/No material assigned/)).toBeNull();
    expect(screen.queryByText('automatic')).toBeNull();
  });

  it('still says "not specified" for a part with no material', async () => {
    renderWithProviders(<MaterialPicker onChange={vi.fn()} />);
    const select = materialSelect();
    await waitFor(() => expect(select.options.length).toBeGreaterThan(3));
    expect(select.value).toBe('__default__');
    expect(screen.getByText(/No material assigned/)).toBeTruthy();
  });
});
