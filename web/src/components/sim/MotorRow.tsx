import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MotorSpec } from '../../engine/openRocketEngine';
import { MotorDialog } from './MotorDialog';
import { fmtNum } from '../../i18n/format';

/**
 * The active simulation's motor: a summary card + a "Change…" button that opens
 * the motor selection dialog (search by code / manufacturer / class).
 */
export function MotorRow({ motor, onChange, onError }: {
  motor: MotorSpec; onChange: (m: MotorSpec) => void; onError: (msg: string | null) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">{t('sims.motor')}</div>
          <div className="truncate text-lg font-semibold text-sky-400">{motor.designation}</div>
          <div className="text-xs text-slate-500">
            {fmtNum(motor.diameter * 1000, 0)} mm · {fmtNum(motor.length * 1000, 0)} mm · {fmtNum(motor.masses[0] * 1000, 1)} g
          </div>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
        >
          {t('sims.changeMotor')}
        </button>
      </div>
      <MotorDialog open={open} onClose={() => setOpen(false)} onSelect={onChange} onError={onError} />
    </section>
  );
}
