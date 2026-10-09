import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NumberInput } from '../common/NumberInput';

/**
 * The small controls on the AeroAnalysis header: the flight-condition number
 * boxes and the segmented toggles (pane, Max Mach, CP unit). Presentation
 * only; the values they edit live in the pane.
 */

/**
 * One flight-condition input. A number box rather than a slider: these are
 * values you know and type (a 4-degree angle of attack, a 20 rad/s roll), not
 * ones you scrub for, and the Worst button writes an exact figure into one.
 */
export function Num({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
}) {
  // Committed on blur or Enter, not per keystroke.
  //
  // These inputs drive `rocket.aeroSweep()`, roughly 40 to 60 samples each with
  // a full per-component force analysis. It runs deferred from an effect with
  // a busy state, but it is still a synchronous kernel call on the main
  // thread: committing per keystroke would run a complete sweep for every
  // digit typed, and the panel stalls on a multi-stage design. The draft
  // (NumberInput's `commitOnBlur`) keeps the box responsive while you type.
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[10px] text-ink-faint">{label}</span>
      <NumberInput
        commitOnBlur
        value={value}
        min={min}
        max={max}
        step={step}
        ariaLabel={label}
        // An emptied box commits nothing: the box falls back to what it had.
        onChange={(v) => v !== null && onChange(v)}
        className="w-16 rounded-md bg-raised px-1.5 py-0.5 text-right text-[11px] tabular-nums text-ink-strong ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
      />
      <span className="text-[10px] text-ink-faint">{unit}</span>
    </label>
  );
}

/**
 * The Worst button beside the wind direction: writes the angle where the rocket
 * is least stable into the box.
 *
 * The kernel call is wrapped like its neighbors (the sweep and
 * componentMasses): one that throws (a build without the method, or a
 * degenerate design) would otherwise throw out of a React event handler and
 * take the whole pane down. A failure leaves the wind direction as it is and
 * says so beside the button, so a press always has a visible outcome.
 */
export function WorstButton({
  worst,
  onWorst,
}: {
  /** Computes the worst wind direction (deg); null while there is no rocket. */
  worst: (() => number) | null;
  onWorst: (deg: number) => void;
}) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  return (
    <>
      <button
        onClick={() => {
          if (!worst) return;
          try {
            onWorst(worst());
            setFailed(false);
          } catch (e) {
            console.error('worstThetaDeg failed', e);
            setFailed(true);
          }
        }}
        title={t('aero.worstNote')}
        className="rounded-md bg-raised px-2 py-0.5 text-[11px] font-medium text-ink ring-1 ring-line/10 hover:bg-elevated"
      >
        {t('aero.worst')}
      </button>
      <span role="status" className="text-[10px] text-warn-400">
        {failed ? t('aero.worstFailed') : ''}
      </span>
    </>
  );
}
