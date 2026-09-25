// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, waitFor, within } from '@testing-library/react';
import { ComponentPicker } from './ComponentPicker';
import { renderWithProviders, seedSettings } from '../../testing/renderWithProviders';
import { serveData } from '../../testing/serveData';
import type { PickerType } from '../../services/componentDb';
import type { FitContext } from '../../services/componentFilter';

/**
 * The picker over the REAL catalog (`serveData`), because every complaint it is
 * answering is about volume: 1088 body tubes in one narrow column, 237 couplers
 * with no way to ask which of them fit the tube you are holding. A test against
 * six invented rows would not have caught any of it.
 */

/** A Public Missiles 2.1" airframe tube: 54.66 mm OD, 51.51 mm bore. */
const PM_TUBE = { od: 0.0546608, bore: 0.0515112 };

const open = async (type: PickerType, fit?: FitContext) => {
  const onApply = vi.fn();
  const { container, unmount } = renderWithProviders(<ComponentPicker type={type} fit={fit} onApply={onApply} />);
  // Scoped to THIS render: opening a second picker without unmounting the first
  // would otherwise find both trigger buttons.
  const button = await waitFor(() => {
    const b = within(container).getByRole('button') as HTMLButtonElement;
    expect(b.disabled).toBe(false);
    return b;
  });
  fireEvent.click(button);
  const dialog = await waitFor(() => within(container).getByRole('dialog'));
  return { dialog, onApply, unmount };
};

/** The data rows, as arrays of cell text. */
const rows = (dialog: HTMLElement): string[][] =>
  [...dialog.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => td.textContent ?? ''),
  );
const headers = (dialog: HTMLElement): string[] =>
  [...dialog.querySelectorAll('thead th')].map((th) => th.textContent?.replace(/[▲▼]/g, '').trim() ?? '');
const footer = (dialog: HTMLElement): string => dialog.lastElementChild?.textContent ?? '';

describe('ComponentPicker', () => {
  beforeAll(serveData);
  // Millimeters so the assertions read like the catalog does. The default is cm,
  // which would put every airframe at 5.47 and hide the point.
  beforeEach(() => seedSettings({ units: { length: 'mm' } }));
  afterEach(() => vi.clearAllMocks());

  it('names every dimension it shows, and the unit once in the heading', async () => {
    const { dialog } = await open('bodytube');
    // The bore was previously nowhere but the description prose, though it is
    // the number that decides what goes inside the tube.
    expect(headers(dialog)).toEqual(['Mfr.', 'Part no.', 'OD (mm)', 'ID (mm)', 'Length (mm)', 'Material', 'Notes']);
  });

  it('gives each type the columns that identify it', async () => {
    // A ring's `length` is a thickness, a parachute has no length at all, and a
    // nose cone's shape is part of its identity. One shared column set meant the
    // picker showed a blank or a mislabeled cell for each of those.
    const ring = await open('centeringring');
    expect(headers(ring.dialog)).toContain('Thickness (mm)');
    expect(headers(ring.dialog)).toContain('ID (mm)');
    ring.unmount();

    const chute = await open('parachute');
    expect(headers(chute.dialog)).toEqual(['Mfr.', 'Part no.', 'Diameter (mm)', 'Drag coeff', 'Notes']);
    expect(headers(chute.dialog)).not.toContain('Length (mm)');
  });

  it('translates the nose cone shape instead of printing the raw enum', async () => {
    const { dialog } = await open('nosecone');
    const shapes = new Set(rows(dialog).map((r) => r[2]));
    expect(shapes.size).toBeGreaterThan(0);
    // The catalog stores `ogive` / `haack` / `ellipsoid`; the column used to
    // show exactly that, lowercase, beside translated headings.
    for (const s of shapes) expect(s).not.toMatch(/^(ogive|haack|ellipsoid|conical|parabolic)$/);
    expect([...shapes].some((s) => s === 'Ogive' || s === 'Ellipsoid' || s === 'Haack')).toBe(true);
  });

  describe('without a fit context', () => {
    it('offers no fit column and no fit toggle, rather than a control that cannot answer', async () => {
      const { dialog } = await open('tubecoupler');
      expect(headers(dialog)).not.toContain('Fit (mm)');
      expect(within(dialog).queryByLabelText('Fits here')).toBeNull();
      expect(within(dialog).queryByText('Fits here')).toBeNull();
    });

    it('reports the true match count and says when it is holding rows back', async () => {
      // 1088 body tubes, 200 rendered. The old picker sliced to 300 and then
      // printed "300 parts" as though that were the catalog.
      const { dialog } = await open('bodytube');
      expect(rows(dialog).length).toBe(200);
      expect(footer(dialog)).toMatch(/Showing 200 of 1[,. ]?088/);
    });
  });

  describe('with a fit context', () => {
    const insideTube: FitContext = { parentInner: PM_TUBE.bore };

    it('ranks the fitting parts first WITHOUT hiding the rest', async () => {
      // Ranking rather than filtering is the deliberate default. Hiding by fit
      // opens empty on ordinary designs: no nose cone in the catalog is within
      // the match tolerance of a 54.66 mm airframe.
      const { dialog } = await open('tubecoupler', insideTube);
      expect(rows(dialog).length).toBe(200); // still the whole catalog, capped
      expect(footer(dialog)).toMatch(/Showing 200 of 237/);
      // The ones that fit lead, best first, and the gaps ascend.
      const fits = rows(dialog)
        .map((r) => r[0])
        .filter((f) => f !== '')
        .map(Number);
      expect(fits.length).toBeGreaterThan(0);
      expect(fits).toEqual([...fits].sort((a, b) => a - b));
      // Every scored row's OD is within a glue gap of the bore.
      for (const r of rows(dialog).filter((r) => r[0] !== '')) {
        const od = Number(r[3]); // Fit, Mfr, Part no, OD
        expect(od).toBeGreaterThan(49);
        expect(od).toBeLessThanOrEqual(51.6);
      }
    });

    it('hides the rest only when asked', async () => {
      const { dialog } = await open('tubecoupler', insideTube);
      fireEvent.click(within(dialog).getByLabelText('Fits here'));
      const n = rows(dialog).length;
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThan(12); // 237 couplers, a handful fit a 51.5 mm bore
      expect(footer(dialog)).toMatch(new RegExp(`${n} parts?`));
      for (const r of rows(dialog)) expect(r[0]).not.toBe('');
    });

    it('leaves the fit column blank for a part that is not in the running', async () => {
      const { dialog } = await open('tubecoupler', insideTube);
      const fits = rows(dialog).map((r) => r[0]);
      expect(fits.some((f) => f !== '')).toBe(true);
      expect(fits.at(-1)).toBe('');
    });

    it('abstains for a parachute, whose fit is packed volume the model lacks', async () => {
      const { dialog } = await open('parachute', insideTube);
      expect(headers(dialog)).not.toContain('Fit (mm)');
      expect(within(dialog).queryByLabelText('Fits here')).toBeNull();
    });
  });

  describe('filters', () => {
    it('narrows by manufacturer', async () => {
      const { dialog } = await open('bodytube');
      const select = within(dialog).getByLabelText('Mfr.') as HTMLSelectElement;
      expect([...select.options][0]!.textContent).toBe('All manufacturers');
      fireEvent.change(select, { target: { value: 'Estes' } });
      const mfrs = new Set(rows(dialog).map((r) => r[0]));
      expect(mfrs).toEqual(new Set(['Estes']));
    });

    it('narrows by outer diameter, in the unit on screen', async () => {
      const { dialog } = await open('bodytube');
      fireEvent.change(within(dialog).getByLabelText('min'), { target: { value: '50' } });
      fireEvent.change(within(dialog).getByLabelText('max'), { target: { value: '60' } });
      const ods = rows(dialog).map((r) => Number(r[2]));
      expect(ods.length).toBeGreaterThan(0);
      for (const od of ods) {
        expect(od).toBeGreaterThanOrEqual(50);
        expect(od).toBeLessThanOrEqual(60);
      }
    });

    it('ANDs the search terms across manufacturer, part number and description', async () => {
      const { dialog } = await open('bodytube');
      fireEvent.change(within(dialog).getByLabelText(/Search parts/), { target: { value: 'blue tube mmt' } });
      const shown = rows(dialog);
      expect(shown.length).toBeGreaterThan(0);
      // "Blue Tube" is the trade name and "MMT" the role, and both live only in
      // the description, which is why the Notes column exists.
      for (const r of shown) expect(r[6]).toContain('MMT');
    });

    it('narrows by material family', async () => {
      const { dialog } = await open('bodytube');
      const select = within(dialog).getByLabelText('Material') as HTMLSelectElement;
      expect([...select.options][0]!.textContent).toBe('All materials');
      // The facet groups the catalog's 39 raw body tube material names into the
      // handful of families people actually ask for.
      const families = [...select.options].slice(1).map((o) => o.value);
      expect(families).toContain('Fiberglass');
      expect(families.length).toBeLessThan(10);
      fireEvent.change(select, { target: { value: 'Fiberglass' } });
      // The column still shows the RAW name, because G10 and G12 are not the
      // same material to build with even though the filter groups them.
      for (const r of rows(dialog)) expect(r[5]).toContain('Fiberglass');
    });

    it('narrows nose cones by shape, with translated labels', async () => {
      const { dialog } = await open('nosecone');
      const select = within(dialog).getByLabelText('Shape') as HTMLSelectElement;
      expect([...select.options][0]!.textContent).toBe('All shapes');
      // The value is the kernel's enum, the label is the translated word.
      const ogive = [...select.options].find((o) => o.value === 'ogive')!;
      expect(ogive.textContent).toBe('Ogive');
      fireEvent.change(select, { target: { value: 'ogive' } });
      for (const r of rows(dialog)) expect(r[2]).toBe('Ogive');
    });

    it('offers neither control where the type has nothing to offer', async () => {
      // A parachute has no material in the catalog and no shape.
      const chute = await open('parachute');
      expect(within(chute.dialog).queryByLabelText('Material')).toBeNull();
      expect(within(chute.dialog).queryByLabelText('Shape')).toBeNull();
      chute.unmount();
      // A body tube has materials but no shape.
      const tube = await open('bodytube');
      expect(within(tube.dialog).queryByLabelText('Material')).not.toBeNull();
      expect(within(tube.dialog).queryByLabelText('Shape')).toBeNull();
    });

    it('offers a way out of a filter set that matches nothing', async () => {
      const { dialog } = await open('bodytube');
      fireEvent.change(within(dialog).getByLabelText(/Search parts/), { target: { value: '~~~' } });
      expect(rows(dialog).length).toBe(1);
      expect(rows(dialog)[0]![0]).toContain('No matching parts');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Clear filters' }));
      expect(rows(dialog).length).toBe(200);
    });

    it('clears the material and shape facets too', async () => {
      const { dialog } = await open('nosecone');
      fireEvent.change(within(dialog).getByLabelText('Material'), { target: { value: 'Balsa' } });
      fireEvent.change(within(dialog).getByLabelText('Shape'), { target: { value: 'conical' } });
      const narrowed = rows(dialog).length;
      fireEvent.click(within(dialog).getByRole('button', { name: 'Clear filters' }));
      expect(rows(dialog).length).toBeGreaterThan(narrowed);
      expect((within(dialog).getByLabelText('Material') as HTMLSelectElement).value).toBe('');
      expect((within(dialog).getByLabelText('Shape') as HTMLSelectElement).value).toBe('');
    });

    it('names the fit filter when IT is what emptied the list', async () => {
      // With the filter on, an empty list is likeliest to be its doing, and a
      // bare "no matching parts" would read as a gap in the catalog.
      const { dialog } = await open('tubecoupler', { parentInner: 0.4 }); // no 400 mm couplers
      fireEvent.click(within(dialog).getByLabelText('Fits here'));
      expect(rows(dialog)[0]![0]).toContain('Only parts that fit');
    });
  });

  describe('sorting', () => {
    it('sorts by a column, and flips when the same heading is clicked again', async () => {
      const { dialog } = await open('bodytube');
      const head = (name: string) => within(dialog).getByRole('button', { name: new RegExp(`^${name}`) });

      fireEvent.click(head('OD'));
      const up = rows(dialog).map((r) => Number(r[2]));
      expect(up).toEqual([...up].sort((a, b) => a - b));

      fireEvent.click(head('OD'));
      const down = rows(dialog).map((r) => Number(r[2]));
      expect(down).toEqual([...down].sort((a, b) => b - a));
    });

    it('tells assistive tech which column is sorted, and which way', async () => {
      const { dialog } = await open('bodytube');
      fireEvent.click(within(dialog).getByRole('button', { name: /^Length/ }));
      const th = [...dialog.querySelectorAll('thead th')];
      const sorted = th.filter((h) => h.getAttribute('aria-sort') !== 'none');
      expect(sorted.length).toBe(1);
      expect(sorted[0]!.textContent).toContain('Length');
      expect(sorted[0]!.getAttribute('aria-sort')).toBe('ascending');
      fireEvent.click(within(dialog).getByRole('button', { name: /^Length/ }));
      expect(sorted[0]!.getAttribute('aria-sort')).toBe('descending');
    });
  });

  describe('an inner tube', () => {
    it('can be picked at all, from the body tube rows', async () => {
      // The catalog has no inner-tube type, and neither does OpenRocket: an inner
      // tube IS a body tube dimensionally, and 51 of those rows are motor mounts.
      const { dialog, onApply } = await open('innertube');
      expect(headers(dialog)).toEqual(['Mfr.', 'Part no.', 'OD (mm)', 'ID (mm)', 'Length (mm)', 'Material', 'Notes']);
      fireEvent.change(within(dialog).getByLabelText(/Search parts/), { target: { value: 'mmt' } });
      expect(rows(dialog).length).toBeGreaterThan(10);
      fireEvent.click(dialog.querySelector('tbody tr')!);
      // A body tube ROW, which is what catalogPatch already knows how to apply.
      expect(onApply.mock.calls[0]![0]).toMatchObject({ type: 'bodytube' });
    });

    it('offers no fit control, because the motor it has to take is not in the tree', async () => {
      const { dialog } = await open('innertube', { parentInner: PM_TUBE.bore, parentOuter: PM_TUBE.od });
      expect(headers(dialog)).not.toContain('Fit (mm)');
      expect(within(dialog).queryByLabelText('Fits here')).toBeNull();
    });
  });

  describe('sorting the columns that were not sortable', () => {
    it('sorts a nose cone by shape', async () => {
      const { dialog } = await open('nosecone');
      fireEvent.click(within(dialog).getByRole('button', { name: /^Shape/ }));
      const shapes = rows(dialog).map((r) => r[2]!);
      expect(new Set(shapes).size).toBeGreaterThan(1);
      expect(shapes).toEqual([...shapes].sort((a, b) => a.localeCompare(b)));
      const th = [...dialog.querySelectorAll('thead th')].find((h) => h.textContent!.includes('Shape'))!;
      expect(th.getAttribute('aria-sort')).toBe('ascending');
    });

    it('sorts a parachute by drag coefficient', async () => {
      const { dialog } = await open('parachute');
      const head = within(dialog).getByRole('button', { name: /^Drag coeff/ });
      expect(head).toBeTruthy(); // it was not a button at all before
      fireEvent.click(head);
      const th = [...dialog.querySelectorAll('thead th')].find((h) => h.textContent!.includes('Drag coeff'))!;
      expect(th.getAttribute('aria-sort')).toBe('ascending');
    });
  });

  it('marks a drag coefficient the catalog did not publish as a default', async () => {
    // Every parachute the catalog ships omits its Cd, so a bare "0.80" read as a
    // manufacturer spec. It is still shown, because it is what picking applies.
    const { dialog } = await open('parachute');
    const cds = rows(dialog).map((r) => r[3]);
    expect(cds.every((c) => c === '(0.80)')).toBe(true);
    const cell = [...dialog.querySelectorAll('tbody tr')[0]!.querySelectorAll('td')][3]!;
    expect(cell.getAttribute('title')).toContain('does not publish');
  });

  it('puts the filters on two rows with the way out on the right', async () => {
    const { dialog } = await open('bodytube');
    // Row one is the search box on its own; row two holds every narrowing control.
    const search = within(dialog).getByLabelText(/Search parts/);
    const facets = within(dialog).getByLabelText('Mfr.').parentElement!;
    expect(facets.contains(search)).toBe(false);
    expect(facets.querySelectorAll('select').length).toBeGreaterThan(1);
    // Clear is pushed to the far right rather than sitting in the run of filters.
    fireEvent.change(search, { target: { value: 'estes' } });
    const clear = within(dialog).getByRole('button', { name: 'Clear filters' });
    expect(clear.className).toContain('ml-auto');
    expect(facets.contains(clear)).toBe(true);
  });

  it('holds its column widths still while you type', async () => {
    // The complaint this fixes: with the browser's default auto layout the
    // widths came from whichever rows were rendered, so every keystroke relaid
    // the table out and the columns jumped.
    const { dialog } = await open('bodytube');
    const table = dialog.querySelector('table')!;
    expect(table.className).toContain('table-fixed');
    // Every column but the one that absorbs the slack states a width, and it is
    // the same width before and after the list changes under it.
    const widths = () =>
      [...dialog.querySelectorAll('thead th')].map((th) => th.className.match(/\bw-\d+\b/)?.[0] ?? null);
    const before = widths();
    expect(before.filter(Boolean).length).toBe(before.length - 1); // Notes takes the rest
    fireEvent.change(within(dialog).getByLabelText(/Search parts/), { target: { value: 'estes' } });
    expect(widths()).toEqual(before);
    fireEvent.change(within(dialog).getByLabelText(/Search parts/), { target: { value: 'fiberglass filament' } });
    expect(widths()).toEqual(before);
  });

  it('puts the whole value on hover where a fixed width has to cut it off', async () => {
    const { dialog } = await open('bodytube');
    const cells = [...dialog.querySelectorAll('tbody tr')[0]!.querySelectorAll('td')];
    for (const td of cells) expect(td.className).toContain('truncate');
    // The material names run to `Paper, spiral kraft glassine, Estes avg, bulk`,
    // which no sane column width fits.
    const material = cells[5]!;
    expect(material.getAttribute('title')).toBeTruthy();
    expect(material.getAttribute('title')!.length).toBeGreaterThanOrEqual(material.textContent!.length);
  });

  it('applies the part that was clicked', async () => {
    const { dialog, onApply } = await open('bodytube');
    fireEvent.change(within(dialog).getByLabelText(/Search parts/), { target: { value: 'BT_1.15_12_MMT' } });
    const first = dialog.querySelector('tbody tr')!;
    fireEvent.click(first);
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]![0]).toMatchObject({ partNo: 'BT_1.15_12_MMT', type: 'bodytube' });
  });

  it('applies from the keyboard, so the table is not mouse-only', async () => {
    const { dialog, onApply } = await open('bodytube');
    fireEvent.change(within(dialog).getByLabelText(/Search parts/), { target: { value: 'BT_1.15_12_MMT' } });
    fireEvent.keyDown(dialog.querySelector('tbody tr')!, { key: 'Enter' });
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
