// @vitest-environment jsdom
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MaterialPicker } from './MaterialPicker';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { setMaterialStore, type MaterialStore } from '../../services/materialStore';
import type { Material } from '../../data/materials';

/**
 * The picker's two store round-trips finish after an await and are guarded by
 * a `mounted` ref. `main.tsx` renders the app under React.StrictMode, whose
 * development double-invoke runs every effect's cleanup once and then re-runs
 * the effect - a guard that only ever flips the ref to false is therefore
 * false for the component's whole life, and the post-await state never lands.
 */

/** An in-memory material store, so the test never touches IndexedDB. */
function memoryStore(): MaterialStore {
  let items: Material[] = [];
  return {
    list: async () => items,
    add: async (m) => {
      items = [{ ...m, custom: true }, ...items.filter((x) => !(x.name === m.name && x.type === m.type))];
    },
    remove: async (name, type) => {
      items = items.filter((x) => !(x.name === name && x.type === type));
    },
  };
}

describe('MaterialPicker under StrictMode', () => {
  beforeEach(() => setMaterialStore(memoryStore()));

  it('still applies a custom material added after the store round-trip', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <StrictMode>
        <MaterialPicker onChange={onChange} />
      </StrictMode>,
    );
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '__add__' } });

    fireEvent.change(screen.getByPlaceholderText('Name (e.g. G10 fiberglass)'), { target: { value: 'Moon Cheese' } });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // The `submitCustom` path: two awaits, then setMats + onChange. The
    // density is typed in the user's unit (g/cm³ by default) and handed on in
    // SI, so only the name is pinned here.
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('Moon Cheese', expect.any(Number)));
    expect(onChange.mock.calls[0]![1]).toBeGreaterThan(0);
    expect(screen.getByRole('option', { name: /Moon Cheese/ })).toBeTruthy();
  });
});
