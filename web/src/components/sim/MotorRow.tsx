import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PLUGGED_DELAY, type MotorSpec, type IgnitionEvent } from '../../engine/openRocketEngine';
import { MotorDialog } from './MotorDialog';
import { MotorSpecDialog } from './MotorSpecDialog';
import { fmtNum } from '../../i18n/format';

// Only meaningful on an upper stage: the sustainer triggers fire off the stage
// below, and "never" (skip this motor) would just strand a single/bottom stage
// on the pad. The bottom/only stage is limited to automatic / launch.
const UPPER_STAGE_EVENTS: IgnitionEvent[] = ['ejectioncharge', 'burnout', 'never'];

/**
 * A motor-mount summary card: the seated motor (designation, dims, delay, curve)
 * + a "Change…" button opening the picker, and a 📈 thrust-curve popup. `title`
 * names the mount on multi-mount rockets; `motor` is null for an empty mount.
 */
export function MotorRow({ motor, onChange, onError, mountDiameter, title, ignition, onIgnitionChange, upperStage }: {
  motor: MotorSpec | null;
  onChange: (m: MotorSpec) => void;
  onError: (msg: string | null) => void;
  /** Motor-mount bore (mm) — enables the picker's "only motors that fit" filter. */
  mountDiameter?: number | null;
  /** Card heading (e.g. "Motor - Center mount"); defaults to just "Motor". */
  title?: string;
  /** When this mount's motor ignites (defaults to automatic). */
  ignition?: { event: IgnitionEvent; delay: number };
  onIgnitionChange?: (event: IgnitionEvent, delay: number) => void;
  /** This mount is on an upper stage — offer the sustainer triggers + "never". */
  upperStage?: boolean;
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
      {motor && ignition && onIgnitionChange && (
        <IgnitionControl event={ignition.event} delay={ignition.delay} onChange={onIgnitionChange} upperStage={upperStage} />
      )}
      <MotorDialog open={open} onClose={() => setOpen(false)} onSelect={onChange} onError={onError} mountDiameter={mountDiameter} current={motor} />
      {motor && <MotorSpecDialog motor={motor} open={curveOpen} onClose={() => setCurveOpen(false)} />}
    </section>
  );
}

/** When this mount's motor ignites: the OpenRocket event set plus a delay (s)
 *  after that event. "Automatic" lights launch-stage motors at launch and upper
 *  stages on the stage-below's ejection; the others (+ delay) drive air-starts
 *  and electronically-lit sustainers. */
function IgnitionControl({ event, delay, onChange, upperStage }: {
  event: IgnitionEvent; delay: number; onChange: (event: IgnitionEvent, delay: number) => void; upperStage?: boolean;
}) {
  const { t } = useTranslation();
  // Bottom/only stage: just automatic / launch. Upper stage adds the sustainer
  // triggers + "never". Never drop the current value, though — a stale one would
  // otherwise blank the dropdown.
  const events: IgnitionEvent[] = [
    'automatic', 'launch',
    ...UPPER_STAGE_EVENTS.filter((e) => upperStage || e === event),
  ];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-white/5 pt-2 text-xs">
      <span className="text-slate-500">{t('sims.ignition')}</span>
      <select
        value={event} aria-label={t('sims.ignition')}
        onChange={(e) => onChange(e.target.value as IgnitionEvent, delay)}
        className="min-w-0 flex-1 rounded-md bg-slate-950 px-2 py-1 text-xs text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
      >
        {events.map((ev) => <option key={ev} value={ev}>{t(`ignition.${ev}`)}</option>)}
      </select>
      {event !== 'never' && (
        <label className="flex shrink-0 items-center gap-1 text-slate-500">
          +
          <input
            type="number" min={0} step={0.5} value={delay}
            aria-label={t('sims.ignitionDelay')} title={t('sims.ignitionDelay')}
            onChange={(e) => onChange(event, Math.max(0, parseFloat(e.target.value) || 0))}
            className="w-14 rounded bg-slate-950 px-1.5 py-0.5 text-right tabular-nums text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
          />
          s
        </label>
      )}
    </div>
  );
}
