import { useMemo, useState } from 'react';
import type { CatalogMotor } from '../../services/motorDb';
import { COLUMNS } from './motorColumns';

/**
 * The motor grid's sort: which column, which direction, the sorted list, and
 * the header click that cycles a column through ascending / descending.
 */

export interface MotorSort {
  id: string;
  dir: 1 | -1;
}

export function useMotorSort(filtered: CatalogMotor[]) {
  const [sort, setSort] = useState<MotorSort | null>(null);

  const shown = useMemo(() => {
    const col = sort && COLUMNS.find((c) => c.id === sort.id);
    if (!col?.sortVal) return filtered;
    const val = col.sortVal;
    return [...filtered].sort((a, b) => {
      const va = val(a),
        vb = val(b);
      const c = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sort!.dir * c;
    });
  }, [filtered, sort]);

  const clickHeader = (id: string) =>
    setSort((s) => (s && s.id === id ? { id, dir: (s.dir * -1) as 1 | -1 } : { id, dir: 1 }));

  return { sort, shown, clickHeader };
}
