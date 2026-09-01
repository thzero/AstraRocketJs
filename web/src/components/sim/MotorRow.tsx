import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PLUGGED_DELAY, type MotorSpec } from '../../engine/openRocketEngine';
import { MotorDialog } from './MotorDialog';
import { MotorSpecDialog } from './MotorSpecDialog';
import { fmtNum } from '../../i18n/format';

/**
 * A motor-mount summary card: the seated motor (designation, dims, delay, curve)
 * + a "Change…" button opening the picker, and a 📈 thrust-curve popup. `title`
 * names the mount on multi-mount rockets; `motor` is null for an empty mount.
 */
export function MotorRow({ motor, onChange, onError, mountDiameter, title }: {
  motor: MotorSpec | null;
  onChange: (m: MotorSpec) => void;
  onError: (msg: string | null) => void;
  /** Motor-mount bore (mm) — enables the picker's "only motors that fit" filter. */
  mountDiameter?: number | null;
  /** Card heading (e.g. "Motor - Center mount"); defaults to just "Motor". */
  title?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [curveOpen, setCurveOpen] = useState(false);
  return (
    <section className="rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">{title ?? t('sims.motor')}</div>
          {motor ? (
            <>
              <div className="truncate text-lg font-semibold text-sky-400">{motor.designation}</div>
              <div className="text-xs text-slate-500">
                {fmtNum(motor.diameter * 1000, 0)} mm · {fmtNum(motor.length * 1000, 0)} mm · {fmtNum(motor.masses[0] * 1000, 1)} g
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                {t('sims.delay')} {motor.ejectionDelay >= PLUGGED_DELAY ? t('motor.plugged') : `${fmtNum(motor.ejectionDelay, 1)} s`}
                {motor.curveSrc ? <span className="text-slate-400"> · {motor.curveSrc}</span> : null}
              </div>
            </>
          ) : (
            <div className="mt-0.5 text-sm text-slate-500">{t('sims.noMotor')}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {motor && (
            <button
              onClick={() => setCurveOpen(true)} title={t('sims.viewCurve')} aria-label={t('sims.viewCurve')}
              className="rounded-lg bg-slate-800 px-2 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
            >
              📈
            </button>
          )}
          <button
            onClick={() => setOpen(true)}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
          >
            {t('sims.changeMotor')}
          </button>
        </div>
      </div>
      <MotorDialog open={open} onClose={() => setOpen(false)} onSelect={onChange} onError={onError} mountDiameter={mountDiameter} current={motor} />
      {motor && <MotorSpecDialog motor={motor} open={curveOpen} onClose={() => setCurveOpen(false)} />}
    </section>
  );
}
