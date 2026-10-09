import { useMemo, useState } from 'react';
import type { CatalogMotor } from '../../services/motors/motorDb';
import { COLUMNS } from './motorColumns';

/**
 * The motor grid's sort: which column, which direction, the sorted list, and
 * the header click that cycles a column through ascending / descending.
 */

export interface MotorSort {
  id: string;
  dir: 1 | -1;
}

/** A sort key the motor has no value for: a non-finite number or an empty string. */
const unknown = (v: number | string): boolean => (typeof v === 'number' ? !Number.isFinite(v) : v === '');

/**
 * Compare two sort keys in the direction `dir` (1 ascending, -1 descending).
 * Unknown keys sort last in both directions, so reversing a column never
 * brings the blank rows to the top.
 */
export function compareSortKeys(va: number | string, vb: number | string, dir: 1 | -1): number {
  const ua = unknown(va);
  const ub = unknown(vb);
  if (ua || ub) return ua === ub ? 0 : ua ? 1 : -1;
  const c = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number);
  return dir * c;
}

export function useMotorSort(filtered: CatalogMotor[]) {
  const [sort, setSort] = useState<MotorSort | null>(null);

  const shown = useMemo(() => {
    const col = sort && COLUMNS.find((c) => c.id === sort.id);
    if (!col?.sortVal) return filtered;
    const val = col.sortVal;
    return [...filtered].sort((a, b) => compareSortKeys(val(a), val(b), sort!.dir));
  }, [filtered, sort]);

  const clickHeader = (id: string) =>
    setSort((s) => (s && s.id === id ? { id, dir: (s.dir * -1) as 1 | -1 } : { id, dir: 1 }));

  return { sort, shown, clickHeader };
}
