import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';
import { NumberInput } from '../common/NumberInput';
import { UnitChip } from '../common/UnitChip';
import { useUnits } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';
import { maxBodyDiameter, rocketLength } from '../../tree/scaleRocket';

/**
 * Scale the whole rocket by one factor — every length, diameter, wall, fin
 * planform and axial position multiplied together, applied as a single undoable
 * step (see the store's {@link scaleDesign}). Two linked entry points, the way
 * builders think about it: a bare FACTOR ("make it half size"), or a TARGET
 * body diameter ("I have 4-inch tube — what does this 2.6-inch plan become?").
 */
export function ScaleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const u = useUnits();
  // The typed target diameter and the before/after summary read the same unit;
  // one scope keeps them agreeing.
  const scope = unitScope('scale', 'length');
  const fu = u.at(scope, 'length');
  const tree = useWorkspaceStore((s) => s.tree);
  const scaleDesign = useWorkspaceStore((s) => s.scaleDesign);
  const [factor, setFactor] = useState(2);

  const baseD = maxBodyDiameter(tree); // m
  const baseL = rocketLength(tree); // m

  // Start fresh at 2× each time it opens; Escape closes.
  useEffect(() => {
    if (open) setFactor(2);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const pct = (factor * 100).toFixed(0);
  const usable = Number.isFinite(factor) && factor > 0 && factor !== 1 && baseD > 0;
  const apply = () => {
    if (!usable) return;
    scaleDesign(factor);
    onClose();
  };
  const input =
    'w-24 rounded-md bg-slate-800 px-2 py-1.5 text-sm tabular-nums text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500';
  const chip = 'rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700';

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl bg-slate-900 p-6 ring-1 ring-white/10"
        role="dialog"
        aria-modal="true"
        aria-label={t('scale.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-100">{t('scale.title')}</h2>
          <button
            onClick={onClose}
            aria-label={t('common.cancel')}
            className="shrink-0 rounded-lg bg-slate-800 px-2 py-1 text-sm text-slate-300 ring-1 ring-white/10 hover:bg-slate-700"
          >
            ✕
          </button>
        </div>

        {baseD <= 0 ? (
          <p className="mt-4 text-sm leading-relaxed text-slate-400">{t('scale.noAirframe')}</p>
        ) : (
          <>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">{t('scale.intro')}</p>

            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2">
                <label className="w-28 shrink-0 text-xs font-medium uppercase tracking-wide text-slate-400">
                  {t('scale.factor')}
                </label>
                <NumberInput
                  value={factor}
                  onChange={(v) => v !== null && v > 0 && setFactor(v)}
                  step={0.05}
                  min={0.01}
                  className={input}
                />
                <span className="text-xs tabular-nums text-slate-500">× · {pct}%</span>
                <div className="ml-auto flex gap-1">
                  {[0.5, 2].map((f) => (
                    <button key={f} type="button" onClick={() => setFactor(f)} className={chip}>
                      {f}×
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <label className="w-28 shrink-0 text-xs font-medium uppercase tracking-wide text-slate-400">
                  {t('scale.newDiameter')}
                </label>
                <NumberInput
                  value={Number(fu.toUi(baseD * factor).toFixed(2))}
                  onChange={(v) => v !== null && v > 0 && baseD > 0 && setFactor(fu.fromUi(v) / baseD)}
                  step={1}
                  min={0.1}
                  className={input}
                />
                <span className="text-xs text-slate-500">
                  {t('scale.currentDiameter', { mm: `${fu.fmt(baseD)} ${fu.sym}` })}
                </span>
              </div>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-slate-300">
              <span className="font-semibold text-slate-100">
                {fu.fmt(baseL)} × {fu.fmt(baseD)} <UnitChip quantity="length" scope={scope} />
              </span>{' '}
              {t('scale.becomes')}{' '}
              <span className="font-semibold text-sky-300">
                {fu.fmt(baseL * factor)} × {fu.fmt(baseD * factor)}{' '}
                <UnitChip quantity="length" scope={scope} />
              </span>
            </p>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              {t('scale.massNote', { cube: (factor ** 3).toFixed(2) })}
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={apply}
                disabled={!usable}
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
              >
                {t('scale.apply', { pct })}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
