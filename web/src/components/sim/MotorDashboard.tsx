import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CatalogMotor } from '../../services/motorDb';
import { useFocusTrap } from '../common/useFocusTrap';
import { MotorDetail } from './MotorDetail';
import { keyOf } from './motorKey';
import { useCatalog } from './useCatalog';
import { ClassChips, DiameterRange, ManufacturerMenu, useMotorFilter } from './MotorFilterBar';
import { useVisibleColumns } from './motorColumns';
import { useMotorSort } from './useMotorSort';
import { ColumnChooser, MotorGrid } from './MotorGrid';
import { MotorComparePane } from './MotorComparePane';
import { MotorCombinePane } from './MotorCombinePane';

/**
 * The motor dashboard shell: the dialog frame, the filter row, the checked set
 * and the mode switch between the detail rail, the compare tool and the
 * combine tool. The grid, the two tools and the column/sort state each live
 * in their own module.
 */

type Mode = 'detail' | 'combine' | 'compare';

/**
 * Standalone motor reference: a sortable, column-configurable grid of every
 * bundled motor with a detail pane (thrust curve + specs) and arrow-key
 * stepping, plus two multi-select tools over the checked motors: COMBINE (sum
 * into one cluster curve) and COMPARE (overlay their curves + specs). Read-only
 * and offline: it inspects/compares, it doesn't seat a motor (that's the picker).
 *
 * Mounted only while open (`{open && <MotorDashboard />}`), which is what
 * defers the ~1.6 MB catalog download to the first opening.
 */
export function MotorDashboard({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<CatalogMotor | null>(null);
  const [curveIdx, setCurveIdx] = useState(0);
  const [checked, setChecked] = useState<Map<string, CatalogMotor>>(new Map());
  const [mode, setMode] = useState<Mode>('detail');
  const panelRef = useFocusTrap<HTMLDivElement>(true, { onEscape: onClose });

  const { catalog, loading: catalogLoading, error: catalogError, retry } = useCatalog();
  const { visCols, cols, toggleCol } = useVisibleColumns();

  const {
    text,
    setText,
    cls,
    setCls,
    mfrs,
    setMfrs,
    dia,
    setDia,
    classes,
    manufacturers,
    matches: filtered,
  } = useMotorFilter(catalog);

  const { sort, shown, clickHeader } = useMotorSort(filtered);

  // Showing a different motor starts from its best (first) curve. Beside the
  // selection write rather than in an effect on `selected`, which rendered the
  // new motor with the old curve index once before correcting itself.
  const select = (m: CatalogMotor | null) => {
    setSelected(m);
    setCurveIdx(0);
    setMode('detail');
  };

  // Derived straight from `checked` so the combine pane's memo dep is honest:
  // a fresh array every render would defeat it.
  const checkedMotors = useMemo(() => [...checked.values()], [checked]);
  const effMode: Mode = (mode === 'combine' || mode === 'compare') && checked.size >= 2 ? mode : 'detail';

  const toggleCheck = (m: CatalogMotor) =>
    setChecked((prev) => {
      const next = new Map(prev);
      const k = keyOf(m);
      if (next.has(k)) next.delete(k);
      else next.set(k, m);
      return next;
    });

  return (
    <div
      className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="motor-dashboard-title"
        className="dialog-panel flex h-[760px] max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-white/10 p-3">
          <h2 id="motor-dashboard-title" className="text-sm font-semibold text-slate-200">
            {t('dash.title')}
          </h2>
          <div className="flex items-center gap-2">
            {checked.size > 0 && (
              <>
                <span className="text-xs text-slate-400">{t('dash.selectedN', { n: checked.size })}</span>
                <button
                  onClick={() => {
                    setChecked(new Map());
                    setMode('detail');
                  }}
                  className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
                >
                  {t('dash.clear')}
                </button>
              </>
            )}
            <button
              onClick={onClose}
              aria-label={t('banner.close')}
              className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* LEFT: filters + sortable grid. min-w-0 lets this flex child shrink
              below the table's intrinsic width so the grid scrolls internally
              instead of pushing the detail pane. Hidden while a full-width tool
              (compare/combine) is open. */}
          <div
            className={`${effMode === 'detail' ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-1 flex-col md:border-r md:border-white/10`}
          >
            <div className="flex flex-wrap items-center gap-2 p-3">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoFocus
                placeholder={t('motorDlg.searchCode')}
                className="min-w-[140px] flex-1 rounded-lg bg-slate-950 px-3 py-1.5 text-sm text-slate-100 ring-1 ring-white/10 placeholder:text-slate-500 focus:outline-none focus:ring-sky-500"
              />
              <ManufacturerMenu manufacturers={manufacturers} mfrs={mfrs} onChange={setMfrs} align="right" />
              <ColumnChooser visCols={visCols} onToggle={toggleCol} />
              <DiameterRange dia={dia} onChange={setDia} />
            </div>
            <div className="flex flex-wrap gap-1 px-3 pb-2">
              <ClassChips classes={classes} cls={cls} onChange={setCls} />
            </div>

            <MotorGrid
              shown={shown}
              cols={cols}
              sort={sort}
              onSort={clickHeader}
              selected={selected}
              onSelect={select}
              checked={checked}
              onToggleCheck={toggleCheck}
              catalogLoading={catalogLoading}
              catalogError={catalogError}
              onRetry={retry}
            />
          </div>

          {/* RIGHT: detail rail (narrow) or a full-width tool (compare/combine). */}
          <div
            className={`min-h-0 overflow-y-auto ${effMode === 'detail' ? 'w-full md:w-[440px] md:shrink-0' : 'w-full flex-1'}`}
          >
            {effMode !== 'detail' && (
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-white/10 bg-slate-900 px-3 py-2">
                <button
                  onClick={() => setMode('detail')}
                  className="rounded-lg bg-slate-800 px-3 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700"
                >
                  ← {t('dash.back')}
                </button>
                <ToolBtn active={effMode === 'compare'} disabled={checked.size < 2} onClick={() => setMode('compare')}>
                  {t('dash.compareN', { n: checked.size })}
                </ToolBtn>
                <ToolBtn active={effMode === 'combine'} disabled={checked.size < 2} onClick={() => setMode('combine')}>
                  {t('dash.combine', { n: checked.size })}
                </ToolBtn>
              </div>
            )}
            {effMode === 'compare' ? (
              <MotorComparePane motors={checkedMotors} cols={cols} />
            ) : effMode === 'combine' ? (
              <MotorCombinePane motors={checkedMotors} />
            ) : checked.size >= 2 ? (
              // A multi-selection is active: prompt with what the two tools do,
              // rather than a single motor's detail.
              <div className="p-6">
                <div className="mx-auto max-w-xs space-y-4 text-center">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    {t('dash.selectedN', { n: checked.size })}
                  </div>
                  <div className="space-y-2 text-left">
                    <button
                      onClick={() => setMode('compare')}
                      className="w-full rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500"
                    >
                      {t('dash.compareN', { n: checked.size })}
                    </button>
                    <p className="text-xs leading-snug text-slate-500">{t('dash.compareDesc')}</p>
                    <button
                      onClick={() => setMode('combine')}
                      className="w-full rounded-lg bg-slate-700 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600"
                    >
                      {t('dash.combine', { n: checked.size })}
                    </button>
                    <p className="text-xs leading-snug text-slate-500">{t('dash.combineDesc')}</p>
                  </div>
                </div>
              </div>
            ) : selected ? (
              <MotorDetail motor={selected} curveIndex={curveIdx} onCurveChange={setCurveIdx} />
            ) : (
              <div className="grid h-full place-items-center p-6 text-center text-sm text-slate-500">
                {t('dash.hint')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolBtn({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`w-24 rounded-lg px-3 py-1 text-center text-xs font-medium ring-1 ring-white/10 disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}
    >
      {children}
    </button>
  );
}
