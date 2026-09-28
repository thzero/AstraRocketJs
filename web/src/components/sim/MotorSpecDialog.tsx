import { useTranslation } from 'react-i18next';
import { fmtNum } from '../../i18n/format';
import { useUnits } from '../../prefs/useUnits';
import { PLUGGED_DELAY, type MotorSpec } from '../../engine/openRocketEngine';
import { ThrustChart, Stat } from './MotorDetail';
import { initialThrust } from '../../services/motorPicker';
import { curveStats } from '../../services/motorMath';
import { Dialog } from '../common/Dialog';
import { inUserUnit, withUnit } from './motorFormat';

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
  const { impulse, burn, avg, max } = curveStats(samples);
  const init = initialThrust(samples);
  const g = withUnit;
  // MotorSpec is SI; `q` converts to the user's unit and appends its symbol.
  const q = (quantity: Parameters<typeof u.fmt>[0], si: number | null, d?: number) => inUserUnit(u, quantity, si, 1, d);
  const delay = motor.ejectionDelay >= PLUGGED_DELAY ? t('motor.plugged') : `${fmtNum(motor.ejectionDelay, 1)} s`;

  return (
    <Dialog
      id="motorSpec"
      eyebrow={motor.manufacturer || undefined}
      title={motor.designation}
      onClose={onClose}
      layout="pad"
      // A thrust chart and eight stats. Worth widening on a big screen.
      size="lg"
    >
      {samples.length >= 2 ? (
        <ThrustChart samples={samples} avg={avg} burn={burn} />
      ) : (
        <p className="my-4 text-xs text-slate-400">{t('motorDlg.noCurve')}</p>
      )}

      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Stat label={t('prop.diameter')} value={q('motorDimensions', motor.diameter)} />
        <Stat label={t('prop.length')} value={q('motorDimensions', motor.length)} />
        <Stat label={t('motorDlg.totalWeight')} value={q('mass', motor.masses[0]!)} />
        <Stat label={t('sims.delay')} value={delay} />
        <Stat label={t('motorDlg.avgThrust')} value={q('force', avg, 1)} />
        <Stat label={t('motorDlg.maxThrust')} value={q('force', max, 1)} />
        <Stat label={t('motorDlg.initialThrust')} value={q('force', init, 1)} />
        <Stat label={t('motorDlg.totalImpulse')} value={q('impulse', impulse, 1)} />
        <Stat label={t('motorDlg.burnTime')} value={g(burn, 's', 2)} />
        {motor.curveSrc && <Stat label={t('motorDlg.curve')} value={motor.curveSrc} />}
      </dl>
    </Dialog>
  );
}
