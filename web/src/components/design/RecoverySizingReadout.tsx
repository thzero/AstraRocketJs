import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComponentNode } from '../../engine/openRocketEngine';
import { fmtNum } from '../../i18n/format';
import { num } from '../../tree/nodeProps';
import { useWorkspaceStore, selectActive } from '../../state/store';
import {
  airDensity,
  canopyDiameter,
  classifyRate,
  descentMass,
  descentRate,
  DROGUE_BAND,
  MAIN_BAND,
  msToFtS,
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
  const info = useWorkspaceStore((s) => s.info);
  const motor = useWorkspaceStore((s) => selectActive(s).motor);
  const extraMotors = useWorkspaceStore((s) => s.extraMotors);
  const launch = useWorkspaceStore((s) => selectActive(s).launch);

  const cd = num(node, 'cd') || 0.8;
  const diameter = num(node, 'diameter');

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
            {t('recovery.forMass', { mass: fmtNum(sizing.mass * 1000, 0) })}
          </p>
          {sizing.rate != null && sizing.verdict != null && (
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-slate-400">{t('recovery.thisChute')}</span>
              <span className="text-sm tabular-nums">
                <span className={VERDICT_TONE[sizing.verdict]}>
                  {fmtNum(sizing.rate, 1)} m/s
                </span>{' '}
                <span className="text-slate-500">
                  ({fmtNum(msToFtS(sizing.rate), 0)} ft/s · {t(`recovery.verdict.${sizing.verdict}`)})
                </span>
              </span>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-slate-400">{t('recovery.mainTarget')}</span>
            <span className="text-sm tabular-nums text-slate-200">Ø {fmtNum(sizing.mainD * 100, 0)} cm</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-slate-400">{t('recovery.drogueTarget')}</span>
            <span className="text-sm tabular-nums text-slate-200">Ø {fmtNum(sizing.drogueD * 100, 0)} cm</span>
          </div>
          <p className="text-[10px] text-slate-600">{t('recovery.atCd', { cd: fmtNum(cd, 2) })}</p>
        </>
      )}
    </div>
  );
}
