import { useTranslation } from 'react-i18next';
import { fmtNum } from '../../i18n/format';
import { useUnits } from '../../prefs/useUnits';
import { PLUGGED_DELAY, type MotorSpec } from '../../engine/openRocketEngine';
import { ThrustChart, SpecItem } from './MotorDetail';
import { initialThrust } from '../../services/motors/motorPicker';
import { curveStats } from '../../services/motors/motorMath';
import { motorStatistics } from '../../engine/openRocketEngine';
import { useEngineStore } from '../../state/engineStore';
import { Dialog } from '../common/Dialog';
import { inUserUnit, withFixedUnit } from './motorFormat';
import { motorName } from '../../services/motors/motorName';

/**
 * Read-only popup for the simulation's current motor: its (flown) thrust curve
 * and the specs derived from it. Works from the resolved MotorSpec, exactly the
 * curve the engine simulates, including whichever alternate curve was chosen.
 *
 * Mounted only while open (`{open && <MotorSpecDialog />}`), so there is no
 * `open` prop and nothing to reset on close.
 */
export function MotorSpecDialog({ motor, onClose }: { motor: MotorSpec; onClose: () => void }) {
  const { t } = useTranslation();
  const u = useUnits();

  const samples: [number, number][] = motor.times.map((tt, i) => [tt, motor.thrusts[i] ?? 0]);
  // The burn and average are the kernel's (ThrustCurveMotor.computeStatistics:
  // between the crossings of 5% of peak), as desktop's motor table shows them,
  // and unknown until it has loaded rather than worked out another way. The
  // impulse and peak are the curve's own either way.
  const engineReady = useEngineStore((s) => s.phase) === 'ready';
  const { impulse, max } = curveStats(samples);
  const kernel = engineReady ? motorStatistics(samples) : null;
  const burn = kernel?.burnTime ?? null;
  const avg = kernel?.averageThrust ?? null;
  const init = initialThrust(samples);
  const g = withFixedUnit;
  // MotorSpec is SI; `q` converts to the user's unit and appends its symbol.
  const q = (quantity: Parameters<typeof u.fmt>[0], si: number | null, d?: number) => inUserUnit(u, quantity, si, 1, d);
  const delay =
    motor.ejectionDelay >= PLUGGED_DELAY
      ? t('motor.plugged')
      : `${fmtNum(motor.ejectionDelay, 1)} ${t('units.second')}`;

  return (
    <Dialog
      id="motorSpec"
      eyebrow={motor.manufacturer || undefined}
      title={motorName(motor)}
      onClose={onClose}
      layout="pad"
      // A thrust chart and up to ten stats. Worth widening on a big screen.
      size="lg"
    >
      {samples.length >= 2 ? (
        <ThrustChart samples={samples} avg={avg} burn={burn} />
      ) : (
        <p className="my-4 text-xs text-ink-muted">{t('motorDlg.noCurve')}</p>
      )}

      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <SpecItem label={t('prop.diameter')} value={q('motorDimensions', motor.diameter)} />
        <SpecItem label={t('prop.length')} value={q('motorDimensions', motor.length)} />
        <SpecItem label={t('motorDlg.totalWeight')} value={q('mass', motor.masses[0]!)} />
        <SpecItem label={t('sims.delay')} value={delay} />
        <SpecItem label={t('motorDlg.avgThrust')} value={q('force', avg, 1)} />
        <SpecItem label={t('motorDlg.maxThrust')} value={q('force', max, 1)} />
        <SpecItem label={t('motorDlg.initialThrust') + '*'} value={q('force', init, 1)} />
        <SpecItem label={t('motorDlg.totalImpulse')} value={q('impulse', impulse, 1)} />
        <SpecItem label={t('motorDlg.burnTime')} value={g(burn, 's', 2)} />
        {motor.curveSrc && <SpecItem label={t('motorDlg.curve')} value={motor.curveSrc} />}
      </dl>
      <p className="mt-2 text-[11px] leading-snug text-ink-faint">{t('motorDlg.initialNote')}</p>
    </Dialog>
  );
}
