import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../common/Dialog';
import { useWorkspaceStore } from '../../state/store';
import { NumberInput } from '../common/NumberInput';
import { UnitChip } from '../common/UnitChip';
import { useUnits } from '../../prefs/useUnits';
import { onSi } from '../../prefs/entryValue';
import { unitScope } from '../../prefs/units';
import { hasExplicitMass, maxBodyDiameter, rocketLength, type ScaleScope } from '../../tree/scaleRocket';
import { findNode } from '../../services/design/treeEdit';
import { isChainType } from '../../tree/componentKinds';
import { num } from '../../tree/nodeProps';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { fmtNum } from '../../i18n/format';
import { DialogButton } from '../common/DialogButton';

/**
 * The size "Scale from" starts at, as desktop's Scale dialog picks it: a body
 * part's larger end diameter, a pod's or booster's radial offset, any other
 * part's length, and with nothing selected the design's widest body.
 */
function initialSize(node: ComponentNode | null, widest: number): number {
  if (!node) return widest;
  if (isChainType(node.type)) {
    const ends = ['foreRadius', 'aftRadius', 'outerRadius'].map((k) => num(node, k)).filter((r) => r > 0);
    return ends.length ? Math.max(...ends) * 2 : widest;
  }
  if (node.type === 'podset' || node.type === 'parallelstage') return num(node, 'radiusOffset');
  return num(node, 'length');
}

/**
 * Desktop OpenRocket's Scale dialog: what to scale (the whole design, the
 * selected part and everything inside it, or the part alone), the factor or a
 * from/to pair of lengths that sets it, whether typed masses follow, and
 * whether positions do. Applied as one undoable step (the store's
 * {@link scaleDesign}).
 *
 * Mounted only while open (`{open && <ScaleDialog />}`), so every choice starts
 * fresh each time by construction.
 */
export function ScaleDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const u = useUnits();
  // The from/to lengths and the before/after summary read the same unit; one
  // scope keeps them agreeing.
  const scope = unitScope('scale', 'length');
  const fu = u.at(scope, 'length');
  const tree = useWorkspaceStore((s) => s.tree);
  const selectedId = useWorkspaceStore((s) => s.selectedId);
  const scaleDesign = useWorkspaceStore((s) => s.scaleDesign);
  const node = selectedId ? findNode(tree, selectedId) : null;

  const baseD = maxBodyDiameter(tree); // m
  const baseL = rocketLength(tree); // m

  // Desktop's choices: the whole design always; the selection with what is
  // inside it when it holds anything; the selection alone when there is one.
  // A selected part other than a stage starts on the selection, since that is
  // why someone selects one before scaling.
  const scopes: ScaleScope[] = [
    'rocket',
    ...(node?.children?.length ? ['subtree' as const] : []),
    ...(node ? ['part' as const] : []),
  ];
  const [what, setWhat] = useState<ScaleScope>(scopes.length > 1 && node?.type !== 'stage' ? scopes[1]! : 'rocket');
  const [factor, setFactor] = useState(2);
  const [from, setFrom] = useState(() => initialSize(node, baseD));
  const explicitMass = hasExplicitMass(tree);
  const [masses, setMasses] = useState(true);
  // Positions follow by default, except when one part alone is scaled: there
  // the usual intent is a bigger part at the same station.
  const [offsets, setOffsets] = useState(what !== 'part');

  const pct = fmtNum(factor * 100, 0);
  const usable = Number.isFinite(factor) && factor > 0 && factor !== 1 && (what !== 'rocket' || baseD > 0);
  const apply = () => {
    if (!usable) return;
    scaleDesign(factor, what, { masses: masses && explicitMass, offsets });
    onClose();
  };
  const input =
    'w-24 rounded-md bg-raised px-2 py-1.5 text-sm tabular-nums text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500';
  const chip = 'rounded-md bg-raised px-2 py-1 text-xs font-medium text-ink ring-1 ring-line/10 hover:bg-elevated';
  const rowLabel = 'w-28 shrink-0 text-xs font-medium uppercase tracking-wide text-ink-muted';
  const SCOPE_LABEL: Record<ScaleScope, string> = {
    rocket: t('scale.scopeRocket'),
    subtree: t('scale.scopeSubtree'),
    part: t('scale.scopePart'),
  };

  return (
    <Dialog id="scale" title={t('scale.title')} onClose={onClose} layer="over" layout="pad" size="md">
      {baseD <= 0 && !node ? (
        <p className="mt-4 text-sm leading-relaxed text-ink-muted">{t('scale.noAirframe')}</p>
      ) : (
        <>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">{t('scale.intro')}</p>

          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2">
              <label htmlFor="scale-what" className={rowLabel}>
                {t('scale.scope')}
              </label>
              <select
                id="scale-what"
                value={what}
                title={t('scale.scopeTip')}
                onChange={(e) => {
                  const next = e.target.value as ScaleScope;
                  setWhat(next);
                  setOffsets(next !== 'part');
                }}
                className="min-w-0 flex-1 rounded-md bg-raised px-2 py-1.5 text-sm text-ink ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
              >
                {scopes.map((s) => (
                  <option key={s} value={s}>
                    {SCOPE_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className={rowLabel}>{t('scale.factor')}</label>
              <NumberInput
                ariaLabel={t('scale.factor')}
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

            {/* Desktop's from/to pair: the factor is `to / from`, so typing the
                size you have ("my tube is 41.6 mm") against the size the plan
                has sets it. Changing `from` keeps the factor and moves `to`. */}
            <div className="flex flex-wrap items-center gap-2" title={t('scale.fromToTip')}>
              <label className={rowLabel}>{t('scale.from')}</label>
              <NumberInput
                ariaLabel={t('scale.from')}
                value={fu.toUi(from)}
                onChange={onSi(fu, (si) => si !== null && si > 0 && setFrom(si))}
                step={fu.step(0.001)}
                min={fu.toUi(0.001)}
                className={input}
              />
              <span className="text-xs text-ink-faint">{t('scale.to')}</span>
              <NumberInput
                ariaLabel={t('scale.toLabel')}
                value={fu.toUi(from * factor)}
                onChange={onSi(
                  fu,
                  (ratio) => ratio !== null && ratio > 0 && setFactor(ratio),
                  // The box holds a length and the dialog holds the ratio of it
                  // to `from`, so the division is part of the conversion.
                  (si) => (from > 0 ? si / from : NaN),
                )}
                step={fu.step(0.001)}
                min={fu.toUi(0.001)}
                className={input}
              />
              <UnitChip quantity="length" scope={scope} />
            </div>

            <label
              className="flex items-center gap-2 text-sm text-ink"
              title={explicitMass ? t('scale.massesTip') : t('scale.massesNone')}
            >
              <input
                type="checkbox"
                checked={masses && explicitMass}
                disabled={!explicitMass}
                onChange={(e) => setMasses(e.target.checked)}
                className="accent-accent-500"
              />
              <span className={explicitMass ? '' : 'text-ink-dim'}>{t('scale.masses')}</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-ink" title={t('scale.offsetsTip')}>
              <input
                type="checkbox"
                checked={offsets}
                onChange={(e) => setOffsets(e.target.checked)}
                className="accent-accent-500"
              />
              {t('scale.offsets')}
            </label>
          </div>

          {what === 'rocket' && (
            <p className="mt-4 text-sm leading-relaxed text-ink-soft">
              <span className="font-semibold text-ink-strong">
                {fu.fmt(baseL)} × {fu.fmt(baseD)} <UnitChip quantity="length" scope={scope} />
              </span>{' '}
              {t('scale.becomes')}{' '}
              <span className="font-semibold text-accent-300">
                {fu.fmt(baseL * factor)} × {fu.fmt(baseD * factor)} <UnitChip quantity="length" scope={scope} />
              </span>
            </p>
          )}
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
