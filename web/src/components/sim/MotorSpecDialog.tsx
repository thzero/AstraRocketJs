import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtNum } from '../../i18n/format';
import { useUnits } from '../../prefs/useUnits';
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
  const u = useUnits();

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
  // MotorSpec is SI; `q` converts to the user's unit and appends its symbol.
  const q = (quantity: Parameters<typeof u.fmt>[0], si: number | null, d?: number) =>
    si == null || !Number.isFinite(si) ? '—' : `${u.fmt(quantity, si, d)} ${u.sym(quantity)}`;
  const delay = motor.ejectionDelay >= PLUGGED_DELAY ? t('motor.plugged') : `${fmtNum(motor.ejectionDelay, 1)} s`;

  return (
    <div
      className="dialog-overlay fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="dialog-panel w-full max-w-lg rounded-xl bg-slate-900 p-4 ring-1 ring-white/10"
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
      </div>
    </div>
  );
}
