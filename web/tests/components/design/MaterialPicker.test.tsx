// @vitest-environment jsdom
import { StrictMode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useConfirmStore } from '../../../src/state/confirmStore';
import { MaterialPicker } from '../../../src/components/design/MaterialPicker';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { setMaterialStore, type MaterialStore } from '../../../src/services/materials/materialStore';
import { serveData } from '../../testing/serveData';
import type { Material } from '../../../src/services/materials/materialTypes';

/**
 * The picker's two store round-trips finish after an await and are guarded by
 * `useLatest().observe()`. `main.tsx` renders the app under React.StrictMode,
 * whose development double-invoke runs every effect's cleanup once and then
 * re-runs the effect, so a guard that only ever flips to stale on cleanup would
 * stay stale for the component's whole life, and the post-await state would
 * never land.
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
  beforeAll(serveData);
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
    // SI, so only the name is pinned here; the third argument is the group the
    // material was filed under, which the .ork writer wants.
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('Moon Cheese', expect.any(Number), expect.any(String)));
    expect(onChange.mock.calls[0]![1]).toBeGreaterThan(0);
    expect(screen.getByRole('option', { name: /Moon Cheese/ })).toBeTruthy();
  });
});

/**
 * Deleting a custom material reloads the list afterwards. That reload can fail
 * on its own (the catalog fetch offline), and the click must say so rather than
 * leave an unhandled rejection with nothing on screen.
 */
describe('MaterialPicker deleting a custom material', () => {
  beforeAll(serveData);

  it('shows the reload failure and still clears the part', async () => {
    let items: Material[] = [{ name: 'Moon Cheese', density: 1234, type: 'bulk', group: 'Other', custom: true }];
    let removed = false;
    let listsAfterRemove = 0;
    setMaterialStore({
      // The delete itself reads the list back once; the reload after it fails.
      list: async () => {
        if (removed && ++listsAfterRemove > 1) throw new Error('list unavailable');
        return items;
      },
      add: async () => {},
      remove: async (name) => {
        items = items.filter((x) => x.name !== name);
        removed = true;
      },
    });
    const onChange = vi.fn();
    renderWithProviders(<MaterialPicker value="Moon Cheese" onChange={onChange} />);
    const del = await screen.findByRole('button', { name: /Delete/ });
    fireEvent.click(del);
    await waitFor(() => expect(useConfirmStore.getState().request).not.toBeNull());
    act(() => useConfirmStore.getState().settle(true));
    await waitFor(() => expect(screen.getByText('list unavailable')).toBeTruthy());
    expect(onChange).toHaveBeenCalledWith(undefined, 0);
  });
});

describe('MaterialPicker deleting asks first', () => {
  beforeAll(serveData);

  it('keeps the material when the confirmation is canceled', async () => {
    const remove = vi.fn(async () => {});
    setMaterialStore({
      list: async () => [{ name: 'Moon Cheese', density: 1234, type: 'bulk', group: 'Other', custom: true }],
      add: async () => {},
      remove,
    });
    const onChange = vi.fn();
    renderWithProviders(<MaterialPicker value="Moon Cheese" onChange={onChange} />);
    fireEvent.click(await screen.findByRole('button', { name: /Delete/ }));
    await waitFor(() => expect(useConfirmStore.getState().request?.danger).toBe(true));
    expect(useConfirmStore.getState().request?.message).toContain('Moon Cheese');
    act(() => useConfirmStore.getState().settle(false));
    await new Promise((r) => setTimeout(r, 10));
    expect(remove).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('MaterialPicker naming', () => {
  beforeAll(serveData);
  beforeEach(() => setMaterialStore(memoryStore()));

  it('names the select for a screen reader, by the row label or the default title', () => {
    renderWithProviders(<MaterialPicker onChange={() => {}} label="Fillet material" />);
    expect(screen.getByRole('combobox', { name: 'Fillet material' })).toBeTruthy();
  });

  it('falls back to Material when the row has no label', () => {
    renderWithProviders(<MaterialPicker onChange={() => {}} />);
    expect(screen.getByRole('combobox', { name: 'Material' })).toBeTruthy();
  });
});
