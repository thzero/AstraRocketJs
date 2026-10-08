import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CatalogMotor } from '../../services/motors/motorDb';
import { Dialog } from '../common/Dialog';
import { MotorDetail } from './MotorDetail';
import { keyOf } from '../../services/motors/motorKey';
import { useCatalog } from './useCatalog';
import {
  ClassChips,
  DiameterRange,
  ImpulseRange,
  ManufacturerMenu,
  PluggedFilter,
  OopFilter,
  useMotorFilter,
} from './MotorFilterBar';
import { useVisibleColumns } from './motorColumns';
import { useMotorSort } from './useMotorSort';
import { ColumnChooser, MotorGrid } from './MotorGrid';
import { MotorComparePane } from './MotorComparePane';
import { MotorCombinePane } from './MotorCombinePane';
import { ToggleButton } from '../common/ToggleButton';

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
    imp,
    setImp,
    plugged,
    setPlugged,
    classes,
    manufacturers,
    matches: filtered,
    hideOop,
    setHideOop,
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
    <Dialog
      id="motorDashboard"
      title={t('dash.title')}
      onClose={onClose}
      size="6xl"
      // A two-pane browser: the grid and the detail rail scroll separately, flush
      // to the panel's edges, so the body takes the height and adds no padding
      // of its own.
      layout="fill"
      // A definite height rather than the viewport's, so a thousand-row grid
      // does not make the dialog as tall as the screen on a large monitor.
      height={760}
      actions={
        checked.size > 0 && (
          <>
            <span className="text-xs text-ink-muted">{t('dash.selectedN', { n: checked.size })}</span>
            <button
              onClick={() => {
                setChecked(new Map());
                setMode('detail');
              }}
              className="rounded-lg bg-raised px-2 py-1 text-xs text-ink-soft hover:bg-elevated"
            >
              {t('dash.clear')}
            </button>
          </>
        )
      }
    >
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* LEFT: filters + sortable grid. min-w-0 lets this flex child shrink
              below the table's intrinsic width so the grid scrolls internally
              instead of pushing the detail pane. Hidden while a full-width tool
              (compare/combine) is open. */}
        <div
          className={`${effMode === 'detail' ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-1 flex-col md:border-r md:border-line/10`}
        >
          <div className="flex flex-wrap items-center gap-2 p-3">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
              placeholder={t('motorDlg.searchCode')}
              className="min-w-[140px] flex-1 rounded-lg bg-canvas px-3 py-1.5 text-sm text-ink-strong ring-1 ring-line/10 placeholder:text-ink-faint focus:outline-none focus:ring-accent-500"
            />
            <ManufacturerMenu manufacturers={manufacturers} mfrs={mfrs} onChange={setMfrs} align="right" />
            <ColumnChooser visCols={visCols} onToggle={toggleCol} />
            <DiameterRange dia={dia} onChange={setDia} />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-2">
            <ClassChips classes={classes} cls={cls} onChange={setCls} />
            {/* Beside the class chips, which answer the coarse version of the
                same question: a class is a doubling bucket, so H runs from 160
                to 320 N·s and a threshold out of a design lands between two
                letters. */}
            <ImpulseRange imp={imp} onChange={setImp} />
            <PluggedFilter plugged={plugged} onChange={setPlugged} />
            <OopFilter on={hideOop} onChange={setHideOop} />
          </div>

          <MotorGrid
            // Hidden by a CSS class above, not unmounted, so the grid has to be
            // told when it is not the surface on screen: its window-level
            // arrow-key listener would otherwise still be live.
            active={effMode === 'detail'}
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
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line/10 bg-surface px-3 py-2">
              <button
                onClick={() => setMode('detail')}
                className="rounded-lg bg-raised px-3 py-1 text-xs font-medium text-ink hover:bg-elevated"
              >
                ← {t('dash.back')}
              </button>
              <ToggleButton
                active={effMode === 'compare'}
                disabled={checked.size < 2}
                onClick={() => setMode('compare')}
                className="w-24 rounded-lg px-3 py-1 text-center text-xs font-medium ring-1 ring-line/10"
              >
                {t('dash.compareN', { n: checked.size })}
              </ToggleButton>
              <ToggleButton
                active={effMode === 'combine'}
                disabled={checked.size < 2}
                onClick={() => setMode('combine')}
                className="w-24 rounded-lg px-3 py-1 text-center text-xs font-medium ring-1 ring-line/10"
              >
                {t('dash.combine', { n: checked.size })}
              </ToggleButton>
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
                <div className="text-xs uppercase tracking-wide text-ink-faint">
                  {t('dash.selectedN', { n: checked.size })}
                </div>
                <div className="space-y-2 text-left">
                  <button
                    onClick={() => setMode('compare')}
                    className="w-full rounded-lg bg-accent-600 px-3 py-2 text-sm font-medium text-on-accent hover:bg-accent-500"
                  >
                    {t('dash.compareN', { n: checked.size })}
                  </button>
                  <p className="text-xs leading-snug text-ink-faint">{t('dash.compareDesc')}</p>
                  <button
                    onClick={() => setMode('combine')}
                    className="w-full rounded-lg bg-elevated px-3 py-2 text-sm font-medium text-ink-strong hover:bg-prominent"
                  >
                    {t('dash.combine', { n: checked.size })}
                  </button>
                  <p className="text-xs leading-snug text-ink-faint">{t('dash.combineDesc')}</p>
                </div>
              </div>
            </div>
          ) : selected ? (
            <MotorDetail motor={selected} curveIndex={curveIdx} onCurveChange={setCurveIdx} />
          ) : (
            <div className="grid h-full place-items-center p-6 text-center text-sm text-ink-faint">
              {t('dash.hint')}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
