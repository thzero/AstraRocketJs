import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtNum } from '../../i18n/format';
import { PLUGGED_DELAY, type MotorSpec } from '../../engine/openRocketEngine';
import { ThrustChart, Stat } from './MotorDetail';
import { initialThrust } from '../../services/motorPicker';

/**
 * Read-only popup for the simulation's current motor: its (flown) thrust curve
 * and the specs derived from it. Works from the resolved MotorSpec — exactly the
 * curve the engine simulates, including whichever alternate curve was chosen.
 */
export function MotorSpecDialog({ motor, open, onClose }: { motor: MotorSpec; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const samples: [number, number][] = motor.times.map((tt, i) => [tt, motor.thrusts[i] ?? 0]);
  let impulse = 0;
  for (let i = 1; i < samples.length; i++) {
    impulse += ((samples[i]![0] - samples[i - 1]![0]) * (samples[i]![1] + samples[i - 1]![1])) / 2;
  }
  const burn = samples.length ? samples[samples.length - 1]![0] : 0;
  const avg = burn > 0 ? impulse / burn : 0;
  const max = samples.length ? Math.max(...samples.map((s) => s[1])) : 0;
  const init = initialThrust(samples);
  const g = (v: number | null, unit: string, d = 1) =>
    v == null || !Number.isFinite(v) ? '—' : `${fmtNum(v, d)} ${unit}`;
  const delay = motor.ejectionDelay >= PLUGGED_DELAY ? t('motor.plugged') : `${fmtNum(motor.ejectionDelay, 1)} s`;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-lg rounded-xl bg-slate-900 p-4 ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {motor.manufacturer && (
              <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-400/90">
                {motor.manufacturer}
              </div>
            )}
            <h3 className="truncate text-xl font-bold text-slate-100">{motor.designation}</h3>
          </div>
          <button
            onClick={onClose}
            aria-label={t('banner.close')}
            className="shrink-0 rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
          >
            ✕
          </button>
        </div>

        {samples.length >= 2 ? (
          <ThrustChart samples={samples} avg={avg} burn={burn} />
        ) : (
          <p className="my-4 text-xs text-slate-400">{t('motorDlg.noCurve')}</p>
        )}

        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          <Stat label={t('prop.diameter')} value={g(motor.diameter * 1000, 'mm', 0)} />
          <Stat label={t('prop.length')} value={g(motor.length * 1000, 'mm')} />
          <Stat label={t('motorDlg.totalWeight')} value={g(motor.masses[0]! * 1000, 'g')} />
          <Stat label={t('sims.delay')} value={delay} />
          <Stat label={t('motorDlg.avgThrust')} value={g(avg, 'N')} />
          <Stat label={t('motorDlg.maxThrust')} value={g(max, 'N')} />
          <Stat label={t('motorDlg.initialThrust')} value={g(init, 'N')} />
          <Stat label={t('motorDlg.totalImpulse')} value={g(impulse, 'N·s')} />
          <Stat label={t('motorDlg.burnTime')} value={g(burn, 's', 2)} />
          {motor.curveSrc && <Stat label={t('motorDlg.curve')} value={motor.curveSrc} />}
        </dl>
      </div>
    </div>
  );
}
