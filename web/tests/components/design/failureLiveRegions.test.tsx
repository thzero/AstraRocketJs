// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useConfirmStore } from '../../../src/state/confirmStore';
import { setMaterialStore } from '../../../src/services/materials/materialStore';
import type { Material } from '../../../src/services/materials/materialTypes';
import { serveData } from '../../testing/serveData';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { MasterStatus } from '../../../src/components/common/MasterDetail';
import { SavePartButton } from '../../../src/components/design/SavePartButton';
import { SavedPartEditor } from '../../../src/components/design/SavedPartEditor';
import { ComponentPicker } from '../../../src/components/design/ComponentPicker';
import { MaterialPicker } from '../../../src/components/design/MaterialPicker';
import { FreeformFinActions } from '../../../src/components/design/FreeformFinActions';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';
import type { CustomPart } from '../../../src/services/parts/presetStore';

/**
 * A failure line in the library and part dialogs is announced.
 *
 * A `role="status"` element created at the same moment as its text is not
 * announced by most screen readers: the region has to be in the DOM before the
 * text is put into it. Each dialog's failure line is its only word on a refused write, so
 * each is checked the same way: before the failure a polite region is mounted
 * with nothing in it, and after the failure that same element holds the text.
 */

const parts = vi.hoisted(() => ({
  save: vi.fn<() => Promise<unknown>>(),
  update: vi.fn<() => Promise<unknown>>(),
  del: vi.fn<() => Promise<void>>(),
  saved: {
    id: 'p1',
    type: 'bodytube',
    mfr: 'Custom',
    partNo: 'BT-1',
    desc: '',
    node: { length: 0.3, outerRadius: 0.0273, thickness: 0.001 },
  } as unknown as CustomPart,
}));
vi.mock('../../../src/services/parts/customParts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../src/services/parts/customParts')>();
  return {
    ...real,
    saveCustomPart: () => parts.save(),
    updateCustomPart: () => parts.update(),
    deleteCustomPart: () => parts.del(),
    customRowsForType: async () => [real.customPartToRow(parts.saved)!],
  };
});

/** Every polite live region on screen, none of which says `message` yet. */
function regionsBefore(message: string): HTMLElement[] {
  const regions = screen.queryAllByRole('status');
  for (const r of regions) expect(r.textContent).not.toContain(message);
  return regions;
}

/** The region that was already mounted and now carries the message, which it announces politely. */
async function announced(regions: HTMLElement[], message: string): Promise<HTMLElement> {
  const region = await waitFor(() => {
    const hit = regions.find((r) => r.textContent === message);
    expect(hit).toBeDefined();
    return hit!;
  });
  expect(region.getAttribute('aria-live')).toBe('polite');
  return region;
}

/** Answers the confirm dialog the delete asks through. */
async function confirmDelete(): Promise<void> {
  await waitFor(() => expect(useConfirmStore.getState().request).not.toBeNull());
  act(() => useConfirmStore.getState().settle(true));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the failure line is a live region mounted before the failure', () => {
  it('MasterStatus: the same element is empty, then holds the text', () => {
    // Plain `render`: the line needs no provider, and `rerender` keeps the tree.
    const { rerender } = render(<MasterStatus err={null} />);
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');
    rerender(<MasterStatus err="The write was refused" />);
    expect(screen.getByRole('status')).toBe(region);
    expect(region.textContent).toBe('The write was refused');
  });

  it('SavePartButton: a refused save', async () => {
    parts.save.mockRejectedValue(new Error('Storage refused the write'));
    renderWithProviders(<SavePartButton node={{ type: 'bodytube', id: 'tube' } as ComponentNode} type="bodytube" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save as part' }));
    const dialog = await screen.findByRole('dialog');
    const before = regionsBefore('Storage refused the write');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect((await announced(before, 'Storage refused the write')).textContent).toBe('Storage refused the write');
  });

  it('SavedPartEditor: a refused update', async () => {
    parts.update.mockRejectedValue(new Error('Another part has that name'));
    renderWithProviders(
      <SavedPartEditor part={parts.saved} onDirtyChange={() => {}} onDelete={() => {}} onBack={() => {}} />,
    );
    const before = regionsBefore('Another part has that name');
    // Save is disabled until something changed.
    fireEvent.change(screen.getByLabelText('Part name'), { target: { value: 'BT-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await announced(before, 'Another part has that name')).textContent).toBe('Another part has that name');
  });

  it('FreeformFinActions: an image that cannot be decoded', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('not an image');
      }),
    );
    renderWithProviders(<FreeformFinActions node={FIN} />);
    const message = 'That file could not be read as an image.';
    const before = regionsBefore(message);
    fireEvent.change(screen.getByLabelText('Import from image'), {
      target: { files: [new File(['x'], 'fin.png', { type: 'image/png' })] },
    });
    expect((await announced(before, message)).textContent).toBe(message);
  });

  describe('over the served catalogs', () => {
    // Per test, since the `afterEach` above removes every stubbed global.
    beforeEach(serveData);

    it('MaterialPicker: a reload that fails after a delete', async () => {
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
      renderWithProviders(<MaterialPicker value="Moon Cheese" density={1234} onChange={() => {}} />);
      const del = await screen.findByRole('button', { name: /Delete/ });
      const before = regionsBefore('list unavailable');
      fireEvent.click(del);
      await confirmDelete();
      expect((await announced(before, 'list unavailable')).textContent).toBe('list unavailable');
    });

    it('ComponentPicker: a refused delete of a saved part', async () => {
      parts.del.mockRejectedValue(new Error('Storage refused the delete'));
      const { container } = renderWithProviders(<ComponentPicker type="bodytube" onApply={() => {}} />);
      const open = await waitFor(() => {
        const b = within(container).getByRole('button') as HTMLButtonElement;
        expect(b.disabled).toBe(false);
        return b;
      });
      fireEvent.click(open);
      const dialog = await waitFor(() => within(container).getByRole('dialog'));
      const del = await within(dialog).findByRole('button', { name: 'Delete saved part BT-1' });
      const before = regionsBefore('Storage refused the delete');
      fireEvent.click(del);
      await confirmDelete();
      expect((await announced(before, 'Storage refused the delete')).textContent).toBe('Storage refused the delete');
    });
  });
});

const FIN = {
  type: 'freeformfinset',
  id: 'ff',
  points: [
    [0, 0],
    [0.04, 0.03],
    [0.06, 0],
  ],
} as unknown as ComponentNode;
