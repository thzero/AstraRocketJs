import { useEffect, useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import type { CatalogMotor } from '../../services/motorDb';
import { avgThrustOf as avgOf, ispOf, massFracOf } from '../../services/motorMath';
import { fmtNum } from '../../i18n/format';
import type { Units } from '../../prefs/useUnits';
import type { Quantity } from '../../prefs/units';

/**
 * The motor dashboard's column table: every column the grid can show, how each
 * one formats and sorts, the persisted choice of visible columns, and the
 * header/alignment helpers the grid and the compare table share.
 */

/** Format a numeric cell to `d` decimals, or a dash when absent / non-finite. */
const fmtCell = (v: number | undefined, d: number) => (v != null && Number.isFinite(v) ? fmtNum(v, d) : '—');

/** Sortable numeric that sinks unknowns to the bottom on ascending sort. */
const sortNum = (v: number) => (Number.isFinite(v) ? v : -1);

export interface Col {
  id: string;
  label: string; // i18n suffix under `dash.*`
  align: 'left' | 'center' | 'right';
  always?: boolean;
  cell: (m: CatalogMotor, u: Units) => string;
  sortVal?: (m: CatalogMotor) => number | string; // omit → not sortable
  /**
   * Preference group for the column's unit. The header appends its symbol, so
   * the labels stay unitless; a column with a FIXED unit (seconds, a percent)
   * keeps it in the label instead. `siScale` lifts the catalog's own units
   * (mm / g — see CatalogMotor) to SI first.
   */
  quantity?: Quantity;
  siScale?: number;
}

/** Column heading: the unitless label, plus the unit the column is shown in. */
export const heading = (c: Col, t: TFunction, u: Units): string =>
  c.quantity ? `${t(`dash.${c.label}`)} ${u.sym(c.quantity)}` : t(`dash.${c.label}`);

/** A catalog value in the user's unit — the catalog's mm/g lifted to SI first. */
const cell = (u: Units, q: Quantity, v: number | undefined, siScale: number, d: number): string =>
  v != null && Number.isFinite(v) ? u.fmt(q, v * siScale, d) : '—';

// Every column the grid can show. `always` = the anchor (Motor), never hidden.
export const COLUMNS: Col[] = [
  {
    id: 'designation',
    label: 'colMotor',
    align: 'left',
    always: true,
    cell: (m) => m.designation,
    sortVal: (m) => m.designation,
  },
  { id: 'manufacturer', label: 'colMfr', align: 'left', cell: (m) => m.manufacturer, sortVal: (m) => m.manufacturer },
  { id: 'class', label: 'colClass', align: 'center', cell: (m) => m.class, sortVal: (m) => m.class },
  {
    id: 'diameter',
    label: 'colDia',
    align: 'right',
    quantity: 'motorDimensions',
    siScale: 0.001,
    cell: (m, u) => cell(u, 'motorDimensions', m.diameter, 0.001, 0),
    sortVal: (m) => m.diameter,
  },
  {
    id: 'impulse',
    label: 'colImpulse',
    align: 'right',
    quantity: 'impulse',
    cell: (m, u) => u.fmt('impulse', m.impulse, m.impulse < 10 ? 1 : 0),
    sortVal: (m) => m.impulse,
  },
  {
    id: 'avg',
    label: 'colAvg',
    align: 'right',
    quantity: 'force',
    cell: (m, u) => cell(u, 'force', avgOf(m), 1, 0),
    sortVal: (m) => avgOf(m),
  },
  {
    id: 'peak',
    label: 'colPeak',
    align: 'right',
    quantity: 'force',
    cell: (m, u) => cell(u, 'force', m.maxThrust, 1, 0),
    sortVal: (m) => m.maxThrust ?? 0,
  },
  { id: 'burn', label: 'colBurn', align: 'right', cell: (m) => fmtNum(m.burn, 1), sortVal: (m) => m.burn },
  {
    id: 'length',
    label: 'colLength',
    align: 'right',
    quantity: 'motorDimensions',
    cell: (m, u) => cell(u, 'motorDimensions', m.length, 0.001, 0),
    sortVal: (m) => m.length ?? 0,
  },
  {
    id: 'mass',
    label: 'colMass',
    align: 'right',
    quantity: 'mass',
    cell: (m, u) => cell(u, 'mass', m.mass, 0.001, 0),
    sortVal: (m) => m.mass ?? 0,
  },
  {
    id: 'prop',
    label: 'colProp',
    align: 'right',
    quantity: 'mass',
    cell: (m, u) => cell(u, 'mass', m.propWeightG, 0.001, 0),
    sortVal: (m) => m.propWeightG ?? 0,
  },
  { id: 'delays', label: 'colDelays', align: 'center', cell: (m) => m.delays ?? '—' },
  { id: 'type', label: 'colType', align: 'center', cell: (m) => m.type ?? '—', sortVal: (m) => m.type ?? '' },
  {
    id: 'code',
    label: 'colCode',
    align: 'left',
    cell: (m) => m.code || m.designation,
    sortVal: (m) => m.code || m.designation,
  },
  { id: 'isp', label: 'colIsp', align: 'right', cell: (m) => fmtCell(ispOf(m), 0), sortVal: (m) => sortNum(ispOf(m)) },
  {
    id: 'massFrac',
    label: 'colMassFrac',
    align: 'right',
    cell: (m) => (Number.isFinite(massFracOf(m)) ? `${fmtNum(massFracOf(m), 0)}%` : '—'),
    sortVal: (m) => sortNum(massFracOf(m)),
  },
  {
    id: 'sparky',
    label: 'colSparky',
    align: 'center',
    cell: (m) => (m.sparky ? '⚡' : '—'),
    sortVal: (m) => (m.sparky ? 1 : 0),
  },
  {
    id: 'curves',
    label: 'colCurves',
    align: 'right',
    cell: (m) => String(m.curves?.length ?? 0),
    sortVal: (m) => m.curves?.length ?? 0,
  },
];
const DEFAULT_COLS = ['designation', 'manufacturer', 'class', 'diameter', 'impulse', 'avg', 'burn'];
export const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;

// The chosen columns persist across sessions.
const COLS_KEY = 'astrarrocketjs:motorDash:cols';
const loadCols = (): string[] => {
  try {
    const r = JSON.parse(localStorage.getItem(COLS_KEY) ?? 'null');
    return Array.isArray(r) && r.length ? (r as string[]) : DEFAULT_COLS;
  } catch {
    return DEFAULT_COLS;
  }
};
const saveCols = (ids: string[]) => {
  try {
    localStorage.setItem(COLS_KEY, JSON.stringify(ids));
  } catch {
    /* storage off */
  }
};

/** The user's column choice (persisted) and the columns to render from it. */
export function useVisibleColumns() {
  const [visCols, setVisCols] = useState<string[]>(loadCols);
  useEffect(() => {
    saveCols(visCols);
  }, [visCols]);

  // Columns to render — in canonical COLUMNS order regardless of toggle order.
  const cols = useMemo(() => COLUMNS.filter((c) => c.always || visCols.includes(c.id)), [visCols]);
  const toggleCol = (id: string) =>
    setVisCols((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return { visCols, cols, toggleCol };
}
