// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MaterialPicker } from '../../../src/components/design/MaterialPicker';
import { renderWithProviders } from '../../testing/renderWithProviders';

/**
 * When the material catalog does not arrive.
 *
 * It is a runtime file (public/data/materials.generated.json) rather than part
 * of the bundle, which buys a table that can be regenerated without a rebuild
 * and costs a failure mode an import did not have: offline, a bad deploy, or a
 * configured data host that answers with something that is not a catalog.
 *
 * An empty list is not an acceptable way to say so. It looks exactly like "this
 * app has no materials", and on a part that HAS a material the select would
 * fall back to its "not specified" option — the panel describing a design
 * wrongly, in the one control meant to describe it.
 */
const stubFetch = (impl: () => Promise<unknown>) => vi.stubGlobal('fetch', impl);

describe('MaterialPicker with no catalog', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    stubFetch(() => Promise.reject(new Error('offline')));
  });

  it('says the list could not be loaded', async () => {
    renderWithProviders(<MaterialPicker value={undefined} onChange={() => {}} />);
    await waitFor(() => expect(screen.getByText(/could not be loaded/i)).toBeTruthy());
  });

  it('still names the material the part is made of', async () => {
    renderWithProviders(<MaterialPicker value="Plywood (birch)" onChange={() => {}} />);
    await waitFor(() => expect(screen.getByText(/could not be loaded/i)).toBeTruthy());
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('Plywood (birch)');
  });

  it('does not claim the part has no material', async () => {
    // The "weighed with a built-in density" hint is true of a part with no
    // material and false of this one; it must not be what a failed download
    // shows.
    renderWithProviders(<MaterialPicker value="Plywood (birch)" onChange={() => {}} />);
    await waitFor(() => expect(screen.getByText(/could not be loaded/i)).toBeTruthy());
    expect(screen.queryByText(/No material assigned/i)).toBeNull();
  });
});
