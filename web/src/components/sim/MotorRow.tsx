import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NumberInput } from '../common/NumberInput';
import { PLUGGED_DELAY, type MotorSpec, type IgnitionEvent } from '../../engine/openRocketEngine';
import { MotorDialog } from './MotorDialog';
import type { MountFit } from '../../services/motors/motorPicker';
import { MotorSpecDialog } from './MotorSpecDialog';
import { fmtNum } from '../../i18n/format';
import { useUnits } from '../../prefs/useUnits';
import { motorName } from '../../services/motors/motorName';
import { IGNITION_EVENTS } from '../../services/design/componentFields';
import type { IgnitionScope } from '../../state/store';

/**
 * A motor-mount summary card: the seated motor (designation, dims, delay, curve)
 * + a "Change…" button opening the picker, and a 📈 thrust-curve popup. `title`
 * names the mount on multi-mount rockets; `motor` is null for an empty mount.
 */
export function MotorRow({
  motor,
  onChange,
  onError,
  mount,
  title,
  ignition,
  onIgnitionChange,
  ignitionEverywhere,
  onCommit,
  soloEdit,
  used,
}: {
  motor: MotorSpec | null;
  onChange: (m: MotorSpec) => void;
  onError: (msg: string | null) => void;
  /** The mount's bore and the length it has room for (mm), which drive the
   *  picker's "fits the mount" filter. */
  mount?: MountFit | null;
  /** Card heading (e.g. "Motor - Center mount"); defaults to just "Motor". */
  title?: string;
  /** When this mount's motor ignites (defaults to automatic). */
  ignition?: { event: IgnitionEvent; delay: number };
  onIgnitionChange?: (event: IgnitionEvent, delay: number, scope: IgnitionScope) => void;
  /** Every configuration's motor in this mount, and the mount itself, already ignite as this one does. */
  ignitionEverywhere?: boolean;
  /** Close the ignition edit's undo entry (event change: immediate; delay: on blur). */
  onCommit?: () => void;
  /**
   * A multi-row selection is being edited, and this card is not part of it.
   *
   * Not a warning about overwriting, which is what the amber marker means
   * elsewhere: a motor change only ever touches the active simulation, so the
   * card says which one it is about instead. Rows differing on motor is the
   * normal state of a comparison, not something to flag.
   */
  soloEdit?: boolean;
  /** The motors this mount carries in its other flight configurations. */
  used?: MotorSpec[];
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const [open, setOpen] = useState(false);
  const [curveOpen, setCurveOpen] = useState(false);
  // An unresolved .ork motor is seated as a curve-less placeholder: show its
  // name but flag it as not-found and hide the (empty) thrust-curve view.
  const hasCurve = !!motor?.masses?.length;
  // Names the card as a landmark ("Motor", or "Motor - Inner tube 2" when a
  // rocket has several mounts). Without it, a multi-mount design is a run of
  // unlabeled sections to a screen reader, each holding a "Change…" button with
  // nothing to say which tube it seats.
  const cardLabel = title ?? t('sims.motor');
  return (
    <section aria-label={cardLabel} className={'rounded-xl bg-surface p-3 ring-1 ring-line/10'}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 text-[10px] uppercase tracking-wide text-ink-muted">
            {cardLabel}
            {soloEdit && <span className="normal-case text-ink-faint">{t('sims.thisOneOnly')}</span>}
          </div>
          {motor ? (
            <>
              <div className="truncate text-lg font-semibold text-accent-400">{motorName(motor)}</div>
              <div className="text-xs text-ink-faint">
                {u.fmt('motorDimensions', motor.diameter)} × {u.fmt('motorDimensions', motor.length)}{' '}
                {u.sym('motorDimensions')}
                {hasCurve ? ` · ${u.fmtSym('mass', motor.masses[0]!)}` : ''}
              </div>
              {hasCurve ? (
                <div className="mt-0.5 text-xs text-ink-faint">
                  {t('sims.delay')}{' '}
                  {motor.ejectionDelay >= PLUGGED_DELAY
                    ? t('motor.plugged')
                    : `${fmtNum(motor.ejectionDelay, 1)} ${t('units.second')}`}
                  {motor.curveSrc ? <span className="text-ink-muted"> · {motor.curveSrc}</span> : null}
                </div>
              ) : (
                <div className="mt-0.5 text-xs text-warn-400">{t('sims.motorNotFound')}</div>
              )}
            </>
          ) : (
            <div className="mt-0.5 text-sm text-ink-faint">{t('sims.noMotor')}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {hasCurve && (
            <button
              onClick={() => setCurveOpen(true)}
              title={t('sims.viewCurve')}
              aria-label={t('sims.viewCurve')}
              className="rounded-lg bg-raised px-2 py-1.5 text-xs text-ink hover:bg-elevated"
            >
              📈
            </button>
          )}
          <button
            onClick={() => setOpen(true)}
            className="rounded-lg bg-raised px-3 py-1.5 text-xs font-medium text-ink hover:bg-elevated"
          >
            {t('sims.changeMotor')}
          </button>
        </div>
      </div>
      {motor && ignition && onIgnitionChange && (
        <IgnitionControl
          event={ignition.event}
          delay={ignition.delay}
          onChange={onIgnitionChange}
          everywhere={ignitionEverywhere ?? false}
          onCommit={onCommit}
        />
      )}
      {/* Mounted only while open, so each opening starts from fresh state:
          mounted permanently and returning null when closed, the picker would
          keep the previous motor's ejection delay across a reopen and fetch the
          catalog on app start. */}
      {open && (
        <MotorDialog
          onClose={() => setOpen(false)}
          onSelect={onChange}
          onError={onError}
          mount={mount}
          current={motor}
          used={used}
        />
      )}
      {curveOpen && hasCurve && motor && <MotorSpecDialog motor={motor} onClose={() => setCurveOpen(false)} />}
    </section>
  );
}

/** When this mount's motor ignites: the OpenRocket event set plus a delay (s)
 *  after that event. "Automatic" lights launch-stage motors at launch and upper
 *  stages on the stage-below's ejection; the others (+ delay) drive air-starts
 *  and electronically-lit sustainers.
 *
 *  The scope and the reset are desktop's (IgnitionSelectionDialog,
 *  MotorConfigurationPanel's Reset ignition). The scope starts on this
 *  configuration, as the dialog does for a mount with a motor in it, and holds
 *  for the edits that follow until it is switched back or the card is shown
 *  for another configuration. Reset is `MotorConfiguration.useDefaultIgnition`:
 *  Automatic with no delay, not the mount's own ignition. */
function IgnitionControl({
  event,
  delay,
  onChange,
  everywhere,
  onCommit,
}: {
  event: IgnitionEvent;
  delay: number;
  onChange: (event: IgnitionEvent, delay: number, scope: IgnitionScope) => void;
  everywhere: boolean;
  onCommit?: () => void;
}) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<IgnitionScope>('config');
  // One radio group per card: several mounts render side by side.
  const group = useId();
  const isReset = event === 'automatic' && delay === 0;
  return (
    <div className="mt-2 space-y-2 border-t border-line/5 pt-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ink-faint">{t('sims.ignition')}</span>
        <select
          value={event}
          aria-label={t('sims.ignition')}
          onChange={(e) => {
            onChange(e.target.value as IgnitionEvent, delay, scope);
            onCommit?.();
          }}
          className="min-w-0 flex-1 rounded-md bg-canvas px-2 py-1 text-xs text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
        >
          {IGNITION_EVENTS.map((ev) => (
            <option key={ev} value={ev}>
              {t(`ignition.${ev}`)}
            </option>
          ))}
        </select>
        {event !== 'never' && (
          <label className="flex shrink-0 items-center gap-1 text-ink-faint">
            +
            {/* `NumberInput` for the same reason the ejection delay in MotorDialog
                is one: a raw box with `?? 0` would commit a zero ignition delay the
                moment the field is cleared to retype, which on an air-start is the
                upper stage lighting at separation. The draft buffer holds the empty
                string instead, and a blank box means "no change". */}
            <NumberInput
              min={0}
              step={0.5}
              value={delay}
              ariaLabel={t('sims.ignitionDelay')}
              onChange={(v) => {
                if (v !== null) onChange(event, v, scope);
              }}
              onCommit={onCommit}
              className="w-14 rounded bg-canvas px-1.5 py-0.5 text-right tabular-nums text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
            />
            {t('units.second')}
          </label>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <legend className="sr-only">{t('sims.ignitionScope')}</legend>
          {(['config', 'all'] as const).map((s) => (
            <label key={s} className="flex items-center gap-1 text-ink-soft">
              <input
                type="radio"
                name={group}
                checked={scope === s}
                onChange={() => setScope(s)}
                className="accent-accent-500"
              />
              {t(s === 'all' ? 'sims.ignitionAll' : 'sims.ignitionThis')}
            </label>
          ))}
        </fieldset>
        <button
          type="button"
          disabled={isReset}
          title={t('sims.resetIgnitionHint')}
          onClick={() => {
            onChange('automatic', 0, 'config');
            onCommit?.();
          }}
          className="rounded-md bg-raised px-2 py-1 text-xs text-ink hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-raised"
        >
          {t('sims.resetIgnition')}
        </button>
      </div>
      {scope === 'all' && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 flex-1 text-[11px] leading-snug text-ink-faint">{t('sims.ignitionAllHint')}</p>
          {/* Desktop's OK applies the dialog's values whether or not they were
              edited; this is that, for an ignition already set here. */}
          <button
            type="button"
            disabled={everywhere}
            onClick={() => {
              onChange(event, delay, 'all');
              onCommit?.();
            }}
            className="rounded-md bg-raised px-2 py-1 text-xs text-ink hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-raised"
          >
            {t('sims.ignitionApplyAll')}
          </button>
        </div>
      )}
    </div>
  );
}
