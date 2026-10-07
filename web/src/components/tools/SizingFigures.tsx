import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtNum, fmtUpTo, withUnit } from '../../i18n/format';
import { UnitChip } from '../common/UnitChip';
import { useUnits } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';
import { QNum } from '../sim/LaunchPanel';
import {
  canopyDiameter,
  classifyRate,
  descentRate,
  DROGUE_BAND,
  MAIN_BAND,
  type RateVerdict,
} from '../../services/flight/recoverySizing';

/** Tone for the current-chute descent rate: green inside a band, amber outside. */
const VERDICT_TONE: Record<RateVerdict, string> = {
  slow: 'text-warn-400',
  main: 'text-ok-400',
  between: 'text-ok-400',
  drogue: 'text-ok-400',
  fast: 'text-warn-400',
};

const useBtn =
  'rounded-md bg-raised px-2 py-0.5 text-[11px] font-medium text-ink-soft ring-1 ring-line/10 hover:bg-elevated';

/**
 * The descent-sizing figures for one descent mass and canopy Cd: how fast the
 * canopy at hand comes down, and the diameter that lands the mass inside the
 * main band, the drogue band, or at a rate of your own. Shared by the parachute
 * editor's sizing dialog and the Tools tab, which differ only in where the mass,
 * Cd and air come from.
 *
 * `onUse`, when given, offers each suggested diameter as a button that sets it.
 */
export function SizingFigures({
  massKg,
  cd,
  rho,
  diameterM,
  rateMs,
  onUse,
}: {
  massKg: number;
  cd: number;
  /** Air density at the site, kg/m³. */
  rho: number;
  /** The canopy at hand, if any. */
  diameterM: number | null;
  /** A measured rate for the canopy at hand, used in place of the equation's. */
  rateMs?: number | null;
  onUse?: (diameterM: number) => void;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const rateUnit = u.at(unitScope('recovery', 'rate'), 'velocity');
  const mainUnit = u.at(unitScope('recovery', 'mainD'), 'length');
  const drogueUnit = u.at(unitScope('recovery', 'drogueD'), 'length');
  const targetUnit = u.at(unitScope('recovery', 'targetD'), 'length');
  const [target, setTarget] = useState<number | null>(null);

  // The bands are authored in ft/s, so they are round there and nowhere else:
  // "15-20 ft/s" is "4.6-6.1 m/s". One decimal at most, trailing zeros dropped,
  // keeps both readable instead of picking a fixed count that spoils one.
  const rateBand = (minSi: number, maxSi: number) =>
    withUnit(`${fmtUpTo(rateUnit.toUi(minSi), 1)}–${fmtUpTo(rateUnit.toUi(maxSi), 1)}`, rateUnit.sym);

  const rate = rateMs ?? (diameterM != null && diameterM > 0 ? descentRate(massKg, diameterM, cd, rho) : null);
  const verdict = rate != null && Number.isFinite(rate) ? classifyRate(rate) : null;
  const mainD = canopyDiameter(massKg, MAIN_BAND.target, cd, rho);
  const drogueD = canopyDiameter(massKg, DROGUE_BAND.target, cd, rho);
  const targetD = target != null && target > 0 ? canopyDiameter(massKg, target, cd, rho) : null;

  const row = (label: string, d: number, unit: typeof mainUnit, scope: string, useLabel: string) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="flex items-baseline gap-2 text-sm tabular-nums text-ink">
        <span>
          Ø {unit.fmt(d)} <UnitChip quantity="length" scope={unitScope('recovery', scope)} />
        </span>
        {onUse && Number.isFinite(d) && (
          <button type="button" className={useBtn} aria-label={useLabel} onClick={() => onUse(d)}>
            {t('recovery.use')}
          </button>
        )}
      </span>
    </div>
  );

  return (
    <div className="space-y-2">
      {rate != null && verdict != null && (
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs text-ink-muted">{t('recovery.thisChute')}</span>
          <span className="text-sm tabular-nums">
            <span className={VERDICT_TONE[verdict]}>{rateUnit.fmt(rate, 1)}</span>{' '}
            <UnitChip quantity="velocity" scope={unitScope('recovery', 'rate')} />{' '}
            <span className="text-ink-faint">({t(`recovery.verdict.${verdict}`)})</span>
          </span>
        </div>
      )}
      {row(
        t('recovery.mainTarget', { range: rateBand(MAIN_BAND.min, MAIN_BAND.max) }),
        mainD,
        mainUnit,
        'mainD',
        t('recovery.useMain'),
      )}
      {row(
        t('recovery.drogueTarget', { range: rateBand(DROGUE_BAND.min, DROGUE_BAND.max) }),
        drogueD,
        drogueUnit,
        'drogueD',
        t('recovery.useDrogue'),
      )}
      <QNum
        label={t('recovery.targetRate')}
        field="recoveryTargetRate"
        kind="velocity"
        u={u}
        stepSi={0.5}
        minSi={0.5}
        maxSi={100}
        value={target}
        onChange={setTarget}
      />
      {targetD != null && row(t('recovery.atTarget'), targetD, targetUnit, 'targetD', t('recovery.useTarget'))}
      <p className="text-[10px] text-ink-faint">
        {t('recovery.atCd', { cd: fmtNum(cd, 2) })} {t('recovery.diametersEstimated')}
      </p>
    </div>
  );
}
