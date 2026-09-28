import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { fmtNum, fmtUpTo, withUnit } from '../../i18n/format';
import { UnitChip } from '../common/UnitChip';
import { useUnits } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';
import { num } from '../../tree/nodeProps';
import { useWorkspaceStore, selectActive, selectExtraMotors } from '../../state/store';
import {
  airDensity,
  canopyDiameter,
  classifyRate,
  descentMass,
  descentRate,
  DROGUE_BAND,
  MAIN_BAND,
  type RateVerdict,
} from '../../services/recoverySizing';

/** Tone for the current-chute descent rate: green inside a band, amber outside. */
const VERDICT_TONE: Record<RateVerdict, string> = {
  slow: 'text-amber-400',
  main: 'text-emerald-400',
  between: 'text-emerald-400',
  drogue: 'text-emerald-400',
  fast: 'text-amber-400',
};

/**
 * Descent-sizing help shown under a selected parachute. Uses the descent mass
 * (loaded minus expelled propellant) and the launch-site air density to report
 * how fast THIS canopy brings the rocket down, and the diameter it would take
 * to hit the main / drogue descent bands at this canopy's own Cd.
 *
 * Reads the workspace store directly so PropertyPanel needn't thread it through.
 */
export function RecoverySizingReadout({ node }: { node: ComponentNode }) {
  const { t } = useTranslation();
  const u = useUnits();
  const rateUnit = u.at(unitScope('recovery', 'rate'), 'velocity');
  const mainUnit = u.at(unitScope('recovery', 'mainD'), 'length');
  const drogueUnit = u.at(unitScope('recovery', 'drogueD'), 'length');
  const massUnit = u.at(unitScope('recovery', 'mass'), 'mass');
  const info = useWorkspaceStore((s) => s.info);
  const motor = useWorkspaceStore((s) => selectActive(s).motor);
  const extraMotors = useWorkspaceStore(selectExtraMotors);
  const launch = useWorkspaceStore((s) => selectActive(s).launch);

  // `num(..., 0.8)`, not `|| 0.8`: `nodeProps.num` already returns 0 for an
  // absent or non-finite value, so the truthiness fallback also swallowed a
  // deliberately stored `cd: 0` and reported a finite descent rate for a
  // canopy with no drag - instead of the infinite rate `descentRate`'s own
  // guard exists to render as a dash. requiredComponent lists `cd` as required
  // precisely because 0 is invalid.
  const cd = num(node, 'cd', 0.8);
  const diameter = num(node, 'diameter');

  // The bands are authored in ft/s, so they are round there and nowhere else:
  // "15-20 ft/s" is "4.6-6.1 m/s". One decimal at most, trailing zeros dropped,
  // keeps both readable instead of picking a fixed count that spoils one.
  const rateBand = (minSi: number, maxSi: number) =>
    withUnit(`${fmtUpTo(rateUnit.toUi(minSi), 1)}–${fmtUpTo(rateUnit.toUi(maxSi), 1)}`, rateUnit.sym);

  const sizing = useMemo(() => {
    const mass = descentMass(info?.mass, [motor, ...Object.values(extraMotors).map((e) => e.spec)]);
    if (mass == null) return null;
    const rho = airDensity(launch);
    const rate = diameter > 0 ? descentRate(mass, diameter, cd, rho) : null;
    return {
      mass,
      rate,
      verdict: rate != null ? classifyRate(rate) : null,
      mainD: canopyDiameter(mass, MAIN_BAND.target, cd, rho),
      drogueD: canopyDiameter(mass, DROGUE_BAND.target, cd, rho),
    };
  }, [info?.mass, motor, extraMotors, launch, cd, diameter]);

  return (
    <div className="space-y-2 border-t border-white/5 pt-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('recovery.title')}</div>
      {sizing == null ? (
        <p className="text-xs text-slate-500">{t('recovery.needsMotor')}</p>
      ) : (
        <>
          <p className="text-[11px] text-slate-500">
            {t('recovery.forMass', { mass: `${massUnit.fmt(sizing.mass)} ${massUnit.sym}` })}
          </p>
          {sizing.rate != null && sizing.verdict != null && (
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-slate-400">{t('recovery.thisChute')}</span>
              <span className="text-sm tabular-nums">
                <span className={VERDICT_TONE[sizing.verdict]}>{rateUnit.fmt(sizing.rate, 1)}</span>{' '}
                <UnitChip quantity="velocity" scope={unitScope('recovery', 'rate')} />{' '}
                <span className="text-slate-500">({t(`recovery.verdict.${sizing.verdict}`)})</span>
              </span>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-slate-400">
              {t('recovery.mainTarget', { range: rateBand(MAIN_BAND.min, MAIN_BAND.max) })}
            </span>
            <span className="text-sm tabular-nums text-slate-200">
              Ø {mainUnit.fmt(sizing.mainD)} <UnitChip quantity="length" scope={unitScope('recovery', 'mainD')} />
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-slate-400">
              {t('recovery.drogueTarget', { range: rateBand(DROGUE_BAND.min, DROGUE_BAND.max) })}
            </span>
            <span className="text-sm tabular-nums text-slate-200">
              Ø {drogueUnit.fmt(sizing.drogueD)} <UnitChip quantity="length" scope={unitScope('recovery', 'drogueD')} />
            </span>
          </div>
          <p className="text-[10px] text-slate-600">{t('recovery.atCd', { cd: fmtNum(cd, 2) })}</p>
        </>
      )}
    </div>
  );
}
