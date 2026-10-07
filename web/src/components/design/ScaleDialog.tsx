import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../common/Dialog';
import { useWorkspaceStore } from '../../state/store';
import { NumberInput } from '../common/NumberInput';
import { UnitChip } from '../common/UnitChip';
import { useUnits } from '../../prefs/useUnits';
import { onSi } from '../../prefs/entryValue';
import { unitScope } from '../../prefs/units';
import { maxBodyDiameter, rocketLength } from '../../tree/scaleRocket';
import { fmtNum } from '../../i18n/format';
import { DialogButton } from '../common/DialogButton';

/**
 * Scale the whole rocket by one factor: every length, diameter, wall, fin
 * planform and axial position multiplied together, applied as a single undoable
 * step (see the store's {@link scaleDesign}). Two linked entry points, the way
 * builders think about it: a bare FACTOR ("make it half size"), or a TARGET
 * body diameter ("I have 4-inch tube; what does this 2.6-inch plan become?").
 *
 * Mounted only while open (`{open && <ScaleDialog />}`), so the factor starts
 * fresh at 2x each time by construction.
 */
export function ScaleDialog({ onClose }: { onClose: () => void }) {
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

  const pct = fmtNum(factor * 100, 0);
  const usable = Number.isFinite(factor) && factor > 0 && factor !== 1 && baseD > 0;
  const apply = () => {
    if (!usable) return;
    scaleDesign(factor);
    onClose();
  };
  const input =
    'w-24 rounded-md bg-raised px-2 py-1.5 text-sm tabular-nums text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500';
  const chip = 'rounded-md bg-raised px-2 py-1 text-xs font-medium text-ink ring-1 ring-line/10 hover:bg-elevated';

  return (
    <Dialog id="scale" title={t('scale.title')} onClose={onClose} layer="over" layout="pad" size="md">
      {baseD <= 0 ? (
        <p className="mt-4 text-sm leading-relaxed text-ink-muted">{t('scale.noAirframe')}</p>
      ) : (
        <>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">{t('scale.intro')}</p>

          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2">
              <label className="w-28 shrink-0 text-xs font-medium uppercase tracking-wide text-ink-muted">
                {t('scale.factor')}
              </label>
              <NumberInput
                value={factor}
                onChange={(v) => v !== null && v > 0 && setFactor(v)}
                step={0.05}
                min={0.01}
                className={input}
              />
              <span className="text-xs tabular-nums text-ink-faint">× · {pct}%</span>
              <div className="ml-auto flex gap-1">
                {[0.5, 2].map((f) => (
                  <button key={f} type="button" onClick={() => setFactor(f)} className={chip}>
                    {f}×
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="w-28 shrink-0 text-xs font-medium uppercase tracking-wide text-ink-muted">
                {t('scale.newDiameter')}
              </label>
              {/* In the field's own unit: a fixed step of 1 and floor of 0.1
                    were millimeter-sized numbers beside a value that may be
                    in inches, and the toFixed(2) pre-rounded what NumberInput
                    already formats. 1 mm of step and floor, converted. */}
              <NumberInput
                value={fu.toUi(baseD * factor)}
                onChange={onSi(
                  fu,
                  (si) => si !== null && si > 0 && setFactor(si),
                  // The box holds a diameter and the dialog holds the RATIO of
                  // it to the design's own, so the division is part of the
                  // conversion and is checked with it.
                  (si) => (baseD > 0 ? si / baseD : NaN),
                )}
                step={fu.step(0.001)}
                min={fu.toUi(0.001)}
                className={input}
              />
              <span className="text-xs text-ink-faint">
                {t('scale.currentDiameter', { mm: `${fu.fmtSym(baseD)}` })}
              </span>
            </div>
          </div>

          <p className="mt-4 text-sm leading-relaxed text-ink-soft">
            <span className="font-semibold text-ink-strong">
              {fu.fmt(baseL)} × {fu.fmt(baseD)} <UnitChip quantity="length" scope={scope} />
            </span>{' '}
            {t('scale.becomes')}{' '}
            <span className="font-semibold text-accent-300">
              {fu.fmt(baseL * factor)} × {fu.fmt(baseD * factor)} <UnitChip quantity="length" scope={scope} />
            </span>
          </p>
          <p className="mt-2 text-xs leading-relaxed text-ink-faint">
            {t('scale.massNote', { cube: fmtNum(factor ** 3, 2) })}
          </p>

          <div className="mt-5 flex justify-end gap-2">
            <DialogButton onClick={onClose} variant="secondary">
              {t('common.cancel')}
            </DialogButton>
            <DialogButton onClick={apply} disabled={!usable} variant="primary">
              {t('scale.apply', { pct })}
            </DialogButton>
          </div>
        </>
      )}
    </Dialog>
  );
}
