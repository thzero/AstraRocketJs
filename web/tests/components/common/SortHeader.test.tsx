// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { SortHeader } from '../../../src/components/common/SortHeader';

const table = (cell: React.ReactNode) => (
  <table>
    <thead>
      <tr>{cell}</tr>
    </thead>
  </table>
);

describe('SortHeader', () => {
  it('announces the sort state on the header cell', () => {
    const { rerender } = renderWithProviders(
      table(
        <SortHeader active dir={-1} onSort={() => {}}>
          Impulse
        </SortHeader>,
      ),
    );
    expect(screen.getByRole('columnheader').getAttribute('aria-sort')).toBe('descending');
    rerender(table(<SortHeader onSort={() => {}}>Impulse</SortHeader>));
    expect(screen.getByRole('columnheader').getAttribute('aria-sort')).toBe('none');
  });

  it('sorts from its button, and is a plain cell without onSort', () => {
    const onSort = vi.fn();
    const { rerender } = renderWithProviders(table(<SortHeader onSort={onSort}>Class</SortHeader>));
    fireEvent.click(screen.getByRole('button', { name: 'Class' }));
    expect(onSort).toHaveBeenCalled();
    rerender(table(<SortHeader>Compare</SortHeader>));
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('columnheader').hasAttribute('aria-sort')).toBe(false);
  });
});
