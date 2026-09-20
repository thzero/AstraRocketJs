import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { hasCurve, type CatalogMotor } from '../../services/motorDb';
import { useUnits } from '../../prefs/useUnits';
import { CatalogLoading, CatalogError } from '../common/CatalogLoading';
import { keyOf } from './motorKey';
import { ALIGN, COLUMNS, heading, type Col } from './motorColumns';
import type { MotorSort } from './useMotorSort';

/**
 * The motor dashboard's grid: the sortable header, one row per motor (check
 * box + the chosen columns), the catalog loading / error row, arrow-key
 * stepping through the rows, and the column chooser that picks what it shows.
 */

/** Column chooser (persisted): a checkbox per hideable column. */
export function ColumnChooser({ visCols, onToggle }: { visCols: string[]; onToggle: (id: string) => void }) {
  const { t } = useTranslation();
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-lg bg-slate-950 px-3 py-1.5 text-sm text-slate-100 ring-1 ring-white/10">
        {t('dash.columns')}
      </summary>
      <div className="absolute right-0 top-full z-20 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg bg-slate-950 p-1 shadow-xl ring-1 ring-white/10">
        {COLUMNS.filter((c) => !c.always).map((c) => (
          <label
            key={c.id}
            className="flex items-center gap-2 rounded px-2 py-1 text-sm text-slate-200 hover:bg-slate-800"
          >
            <input
              type="checkbox"
              checked={visCols.includes(c.id)}
              className="accent-sky-500"
              onChange={() => onToggle(c.id)}
            />
            {t(`dash.${c.label}`)}
          </label>
        ))}
      </div>
    </details>
  );
}

export function MotorGrid({
  shown,
  cols,
  sort,
  onSort,
  selected,
  onSelect,
  checked,
  onToggleCheck,
  catalogLoading,
  catalogError,
  onRetry,
}: {
  /** The filtered, sorted rows. */
  shown: CatalogMotor[];
  cols: Col[];
  sort: MotorSort | null;
  onSort: (id: string) => void;
  selected: CatalogMotor | null;
  onSelect: (m: CatalogMotor | null) => void;
  checked: Map<string, CatalogMotor>;
  onToggleCheck: (m: CatalogMotor) => void;
  catalogLoading: boolean;
  catalogError: string | null;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || !shown.length) return;
      e.preventDefault();
      const i = selected ? shown.findIndex((m) => keyOf(m) === keyOf(selected)) : -1;
      onSelect(shown[e.key === 'ArrowDown' ? Math.min(shown.length - 1, i + 1) : Math.max(0, i - 1)] ?? null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown, selected, onSelect]);

  useEffect(() => {
    if (!selected) return;
    bodyRef.current?.querySelector(`[data-key="${CSS.escape(keyOf(selected))}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-collapse whitespace-nowrap text-sm">
          <thead className="sticky top-0 z-10 bg-slate-900 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-8 px-2 py-1.5" />
              {cols.map((c) => (
                <th key={c.id} className={`px-2 py-1.5 font-semibold ${ALIGN[c.align]}`}>
                  {c.sortVal ? (
                    <button
                      onClick={() => onSort(c.id)}
                      className={`inline-flex items-center gap-0.5 hover:text-slate-300 ${sort?.id === c.id ? 'text-sky-400' : ''}`}
                    >
                      {heading(c, t, u)}
                      {sort?.id === c.id && <span aria-hidden>{sort.dir === 1 ? '▲' : '▼'}</span>}
                    </button>
                  ) : (
                    heading(c, t, u)
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {(catalogLoading || catalogError) && (
              <tr>
                <td colSpan={cols.length + 1} className="p-4">
                  {catalogError ? (
                    <CatalogError message={`${t('catalog.failedMotors')} ${catalogError}`} onRetry={onRetry} />
                  ) : (
                    <CatalogLoading name="motors" label={t('catalog.loadingMotors')} />
                  )}
                </td>
              </tr>
            )}
            {shown.map((m) => {
              const k = keyOf(m);
              const isSel = !!selected && keyOf(selected) === k;
              return (
                <tr
                  key={k}
                  data-key={k}
                  onClick={() => onSelect(m)}
                  className={`cursor-pointer border-t border-white/5 tabular-nums ${isSel ? 'bg-sky-600/25' : 'hover:bg-slate-800/60'}`}
                >
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={checked.has(k)}
                      disabled={!hasCurve(m)}
                      aria-label={t('dash.select', { name: m.designation })}
                      title={hasCurve(m) ? undefined : t('dash.noCurveTip')}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => onToggleCheck(m)}
                      className="accent-sky-500 disabled:opacity-30"
                    />
                  </td>
                  {cols.map((c) => (
                    <td
                      key={c.id}
                      className={`px-2 py-1.5 ${ALIGN[c.align]} ${c.always ? 'font-medium text-slate-100' : 'text-slate-300'}`}
                    >
                      {c.always && m.custom && <span className="mr-1 text-amber-400">★</span>}
                      {c.cell(m, u)}
                      {c.always && !hasCurve(m) && (
                        <span className="ml-1.5 rounded bg-slate-700 px-1 py-0.5 text-[9px] font-normal uppercase tracking-wide text-slate-400">
                          {t('dash.noCurve')}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-white/10 p-2 text-center text-[11px] uppercase tracking-wide text-slate-500">
        {t('motor.count', { total: shown.length })}
      </div>
    </>
  );
}
