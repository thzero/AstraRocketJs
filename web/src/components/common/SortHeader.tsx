import type { ReactNode } from 'react';

/**
 * A table column header that sorts. It says which way it sorts to assistive
 * technology too (`aria-sort` on the header cell), not only with the arrow,
 * which is hidden from it; one table once showed the arrow and announced nothing.
 * Without `onSort` it is a plain header cell.
 */
export function SortHeader({
  active = false,
  dir = 1,
  onSort,
  className = '',
  children,
}: {
  active?: boolean;
  /** 1 ascending, -1 descending; read only while `active`. */
  dir?: 1 | -1;
  onSort?: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <th
      scope="col"
      aria-sort={onSort ? (!active ? 'none' : dir === 1 ? 'ascending' : 'descending') : undefined}
      className={className}
    >
      {onSort ? (
        <button
          type="button"
          onClick={onSort}
          className={`inline-flex items-center gap-0.5 hover:text-ink ${active ? 'text-accent-400' : ''}`}
        >
          {children}
          {active && <span aria-hidden="true">{dir === 1 ? '▲' : '▼'}</span>}
        </button>
      ) : (
        children
      )}
    </th>
  );
}
