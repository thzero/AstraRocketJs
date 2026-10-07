import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { hasCurve, type CatalogMotor } from '../../services/motors/motorDb';
import { useUnits } from '../../prefs/useUnits';
import { CatalogLoading, CatalogError } from '../common/CatalogLoading';
import { keyOf } from './motorKey';
import { ALIGN, COLUMNS, heading, type Col } from './motorColumns';
import type { MotorSort } from './useMotorSort';
import { SortHeader } from '../common/SortHeader';
import { CheckMenu } from '../common/CheckMenu';
import { isTextEntry } from '../common/isTextEntry';

/**
 * The motor dashboard's grid: the sortable header, one row per motor (check
 * box + the chosen columns), the catalog loading / error row, arrow-key
 * stepping through the rows, and the column chooser that picks what it shows.
 */

/** Column chooser (persisted): a checkbox per hideable column. */
export function ColumnChooser({ visCols, onToggle }: { visCols: string[]; onToggle: (id: string) => void }) {
  const { t } = useTranslation();
  return (
    <CheckMenu
      summary={t('dash.columns')}
      items={COLUMNS.filter((c) => !c.always).map((c) => ({
        key: c.id,
        label: t(`dash.${c.label}`),
        checked: visCols.includes(c.id),
      }))}
      onToggle={onToggle}
      width="w-56"
      align="right"
    />
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
  active,
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
  /**
   * Whether the grid is the surface on screen.
   *
   * The arrow-key stepper is a `window` listener, and the dashboard keeps this
   * grid MOUNTED while a full-width tool is open -- it only hides it with a
   * CSS class. So pressing ArrowDown while reading the Compare pane stepped the
   * selection and `onSelect` flipped the mode back to the detail rail, closing
   * the comparison you had just set up.
   */
  active: boolean;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (isTextEntry(e.target as Element) || !shown.length) return;
      e.preventDefault();
      const i = selected ? shown.findIndex((m) => keyOf(m) === keyOf(selected)) : -1;
      onSelect(shown[e.key === 'ArrowDown' ? Math.min(shown.length - 1, i + 1) : Math.max(0, i - 1)] ?? null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, shown, selected, onSelect]);

  useEffect(() => {
    if (!selected) return;
    bodyRef.current?.querySelector(`[data-key="${CSS.escape(keyOf(selected))}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-collapse whitespace-nowrap text-sm">
          <thead className="sticky top-0 z-10 bg-surface text-[10px] uppercase tracking-wide text-ink-faint">
            <tr>
              <th scope="col" className="w-8 px-2 py-1.5">
                <span className="sr-only">{t('dash.compareTitle')}</span>
              </th>
              {cols.map((c) => (
                <SortHeader
                  key={c.id}
                  className={`px-2 py-1.5 font-semibold ${ALIGN[c.align]}`}
                  active={sort?.id === c.id}
                  dir={sort?.dir === -1 ? -1 : 1}
                  onSort={c.sortVal ? () => onSort(c.id) : undefined}
                >
                  {heading(c, t, u)}
                </SortHeader>
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
                  className={`cursor-pointer border-t border-line/5 tabular-nums ${isSel ? 'bg-accent-600/25' : 'hover:bg-raised/60'}`}
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
                      className="accent-accent-500 disabled:opacity-30"
                    />
                  </td>
                  {cols.map((c) => (
                    <td
                      key={c.id}
                      className={`px-2 py-1.5 ${ALIGN[c.align]} ${c.always ? 'font-medium text-ink-strong' : 'text-ink-soft'}`}
                    >
                      {c.always && m.custom && <span className="mr-1 text-warn-400">★</span>}
                      {c.cell(m, u)}
                      {c.always && !hasCurve(m) && (
                        <span className="ml-1.5 rounded bg-elevated px-1 py-0.5 text-[9px] font-normal uppercase tracking-wide text-ink-muted">
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
      <div className="border-t border-line/10 p-2 text-center text-[11px] uppercase tracking-wide text-ink-faint">
        {t('motor.count', { total: shown.length })}
      </div>
    </>
  );
}
