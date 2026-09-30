import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { fmtNum, fmtUpTo, withUnit } from '../../i18n/format';
import { UnitChip } from '../common/UnitChip';
import { useUnits } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';
import { num } from '../../tree/nodeProps';
import { useWorkspaceStore, selectActive, selectConfig } from '../../state/store';
import { motorSpecs } from '../../services/flight/flightConfigs';
import { deviceDescent } from '../../services/flight/recoveryFlown';
import {
  airDensity,
  canopyDiameter,
  classifyRate,
  descentMass,
  descentRate,
  DROGUE_BAND,
  MAIN_BAND,
  type RateVerdict,
} from '../../services/flight/recoverySizing';

/** Tone for the current-chute descent rate: green inside a band, amber outside. */
const VERDICT_TONE: Record<RateVerdict, string> = {
  slow: 'text-amber-400',
  main: 'text-emerald-400',
  between: 'text-emerald-400',
  drogue: 'text-emerald-400',
  fast: 'text-amber-400',
};

/**
 * Descent-sizing help shown under a selected parachute.
 *
 * An ESTIMATE, and it says so. The mass is the loaded mass less the propellant
 * that burns off, the rate comes from the descent equation at a launch-site air
 * density of our own, and the two diameters are that equation solved backwards.
 * None of it is the kernel's, which is why it can be shown before the design has
 * ever flown and why it must not be mistaken for a result.
 *
 * Once a run HAS flown this device the mass and the rate are replaced by what the
 * kernel recorded (`recoveryFlown`), and the block says which it is showing. The
 * two diameters stay an estimate throughout: "what size should I use" is a
 * question about a design, and no flight can answer it.
 *
 * The suggestion is worth more against the measured mass than against ours, so
 * when a run is available every line is computed from that one.
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
  const tree = useWorkspaceStore((s) => s.tree);
  const config = useWorkspaceStore(selectConfig);
  const launch = useWorkspaceStore((s) => selectActive(s).launch);
  // An OUTDATED run describes a design or settings that have since moved, so its
  // figures are not this device's any more; the estimate is the honest fallback.
  const result = useWorkspaceStore((s) => (selectActive(s).outdated ? null : selectActive(s).result));

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

  const name = typeof node.name === 'string' ? node.name : '';
  const sizing = useMemo(() => {
    // What the run recorded for THIS device, if it flew one.
    const flown = deviceDescent(result, name);
    const mass = flown?.mass ?? descentMass(info?.mass, motorSpecs(tree, config));
    if (mass == null) return null;
    const rho = airDensity(launch);
    const rate = flown?.rate ?? (diameter > 0 ? descentRate(mass, diameter, cd, rho) : null);
    return {
      mass,
      rate,
      measured: flown != null,
      branch: flown?.branch ?? '',
      verdict: rate != null ? classifyRate(rate) : null,
      mainD: canopyDiameter(mass, MAIN_BAND.target, cd, rho),
      drogueD: canopyDiameter(mass, DROGUE_BAND.target, cd, rho),
    };
  }, [info?.mass, tree, config, launch, cd, diameter, result, name]);

  return (
    <div className="space-y-2 border-t border-white/5 pt-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('recovery.title')}</div>
      {sizing == null ? (
        <p className="text-xs text-slate-500">{t('recovery.needsMotor')}</p>
      ) : (
        <>
          <p className="text-[11px] text-slate-500">
            {/* Three keys, not one with a conditional clause: i18next cannot
                omit a fragment, and gluing the branch name on here would not
                translate. The branch is named only when the flight HAD more than
                one, since otherwise there is nothing to distinguish. */}
            {t(
              sizing.measured
                ? sizing.branch
                  ? 'recovery.forMassRunBranch'
                  : 'recovery.forMassRun'
                : 'recovery.forMass',
              { mass: `${massUnit.fmt(sizing.mass)} ${massUnit.sym}`, branch: sizing.branch },
            )}
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
          <p className="text-[10px] text-slate-600">
            {t('recovery.atCd', { cd: fmtNum(cd, 2) })} {t('recovery.diametersEstimated')}
          </p>
        </>
      )}
    </div>
  );
}
