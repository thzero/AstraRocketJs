// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { MotorGrid } from '../../../src/components/sim/MotorGrid';
import { useVisibleColumns } from '../../../src/components/sim/motorColumns';
import type { CatalogMotor } from '../../../src/services/motors/motorDb';

/**
 * The grid's arrow-key stepper is a `window` listener, and `MotorDashboard`
 * keeps the grid mounted while a full-width tool (Compare / Combine) is open:
 * it only hides it with a CSS class. Unguarded, ArrowDown pressed while reading
 * the Compare pane would step the selection, and the dashboard's `onSelect`
 * flips the mode back to the detail rail, closing the comparison that had just
 * been set up. A hidden surface must not own a global key.
 */
const motor = (designation: string): CatalogMotor =>
  ({
    manufacturer: 'Test',
    designation,
    class: 'C',
    diameter: 0.018,
    length: 0.07,
    totalImpulse: 10,
    avgThrust: 5,
    burnTime: 2,
    propMass: 0.01,
    totalMass: 0.024,
    delays: null,
    code: designation,
  }) as unknown as CatalogMotor;

const rows = [motor('A'), motor('B'), motor('C')];

function Grid({ active, onSelect }: { active: boolean; onSelect: (m: CatalogMotor | null) => void }) {
  const { cols } = useVisibleColumns();
  return (
    <MotorGrid
      active={active}
      shown={rows}
      cols={cols}
      sort={null}
      onSort={() => {}}
      selected={rows[0]!}
      onSelect={onSelect}
      checked={new Map()}
      onToggleCheck={() => {}}
      catalogLoading={false}
      catalogError={null}
      onRetry={() => {}}
    />
  );
}

describe('MotorGrid arrow keys', () => {
  // jsdom does not lay out, so it has no scrollIntoView; the grid scrolls the
  // selected row into view whenever the selection moves. Same stub as
  // ComponentTree.test.tsx.
  beforeAll(() => {
    Element.prototype.scrollIntoView = () => {};
  });

  it('steps the selection while it is the surface on screen', async () => {
    const onSelect = vi.fn();
    renderWithProviders(<Grid active onSelect={onSelect} />);
    await screen.findByText('A');

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ designation: 'B' });
  });

  it('does NOT step while a full-width tool is open over it', async () => {
    const onSelect = vi.fn();
    renderWithProviders(<Grid active={false} onSelect={onSelect} />);
    await screen.findByText('A');

    // Still mounted, still rendering its rows, and must not answer the key.
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('leaves a key typed into a field alone even when it is active', async () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <>
        <input aria-label="search" />
        <Grid active onSelect={onSelect} />
      </>,
    );
    const input = await screen.findByLabelText('search');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(onSelect).not.toHaveBeenCalled();
  });
});

/** The sorted column says so to assistive technology, not only with its arrow. */
describe('MotorGrid sort header', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = () => {};
  });

  it('marks the sorted column with aria-sort', () => {
    function Sorted() {
      const { cols } = useVisibleColumns();
      const id = cols.find((c) => c.sortVal)!.id;
      return (
        <MotorGrid
          active
          shown={rows}
          cols={cols}
          sort={{ id, dir: -1 }}
          onSort={() => {}}
          selected={null}
          onSelect={() => {}}
          checked={new Map()}
          onToggleCheck={() => {}}
          catalogLoading={false}
          catalogError={null}
          onRetry={() => {}}
        />
      );
    }
    renderWithProviders(<Sorted />);
    const sorts = screen.getAllByRole('columnheader').map((h) => h.getAttribute('aria-sort'));
    expect(sorts).toContain('descending');
  });
});
