// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MaterialPicker } from '../../src/components/design/MaterialPicker';
import { renderWithProviders } from '../testing/renderWithProviders';
import { setMaterialStore, type MaterialStore } from '../../src/services/materials/materialStore';
import { serveData } from '../testing/serveData';
import { UNITS } from '../../src/prefs/units';
import type { Material } from '../../src/services/materials/materialTypes';

beforeAll(serveData);

/**
 * A finite ENTRY is not a finite stored value, at a box OUTSIDE the property
 * panel — which is where this guard used to stop.
 *
 * It can only happen where a DISPLAY unit is larger than the SI one, because
 * that is the only direction the conversion multiplies in. The first test pins
 * which quantities those are, because the answer decides which fields are
 * exposed at all and it changes the moment a unit is added: a length is safe
 * today only because every length unit is a meter or less.
 *
 * The custom-material density is the clearest of them — `g/cm³` multiplies by a
 * thousand — and it is also the one quantity with a physical ceiling, so both
 * halves of the rule are visible in one form.
 *
 * `1e306`, not `1e999`: jsdom refuses to deliver text that is not a finite
 * number to a `type="number"` input at all, so the literal-overflow case can
 * only be exercised against `parseEntry` (tests/prefs/entryValue.test.ts). A
 * real browser does deliver it, and `parseFloat` returns Infinity.
 */
describe('which quantities a unit conversion can overflow', () => {
  it('is every quantity with a display unit larger than its SI unit', () => {
    const exposed = Object.entries(UNITS)
      .filter(([, defs]) => defs.some((d) => d.toSI > 1))
      .map(([q]) => q)
      .sort();
    expect(exposed).toEqual([
      'acceleration',
      'density',
      'distance',
      'force',
      'impulse',
      'lineDensity',
      'pressure',
      // r/s and Hz are 2π rad/s. Shown, never typed, so no entry box is exposed
      // yet; one that takes a roll rate needs the same guard as the rest.
      'rollRate',
      'surfaceDensity',
    ]);
  });
});

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

describe('a custom material density', () => {
  beforeEach(() => setMaterialStore(memoryStore()));

  /** Open the add form and fill in a name, leaving the density to the caller. */
  const addForm = () => {
    const onChange = vi.fn();
    renderWithProviders(<MaterialPicker onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox') as HTMLSelectElement, { target: { value: '__add__' } });
    fireEvent.change(screen.getByPlaceholderText('Name (e.g. G10 fiberglass)'), { target: { value: 'Moon Cheese' } });
    return { onChange, box: () => screen.getByRole('spinbutton') as HTMLInputElement };
  };

  it('is refused when the conversion to SI overflows', async () => {
    const { onChange, box } = addForm();
    // 1e306 g/cm³ is 1e309 kg/m³, which is Infinity. Before the guard that went
    // into the material store and then into every part made of it.
    fireEvent.change(box(), { target: { value: '1e306' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // `addCustom` rejects a non-finite density in its own words, and the form
    // shows that instead of saving the material.
    await waitFor(() => expect(screen.getByText(/Density must be a positive number/)).toBeTruthy());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is capped at the physical ceiling rather than saved as typed', async () => {
    const { onChange, box } = addForm();
    // 1e6 g/cm³ is a finite 1e9 kg/m³, so only the quantity ceiling stops it.
    fireEvent.change(box(), { target: { value: '1e6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0]![1]).toBe(30_000);
  });

  it('still saves an ordinary density unchanged', async () => {
    const { onChange, box } = addForm();
    fireEvent.change(box(), { target: { value: '1.85' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0]![1]).toBeCloseTo(1850, 6);
  });
});
