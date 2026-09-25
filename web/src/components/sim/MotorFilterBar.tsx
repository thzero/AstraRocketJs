import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { filterMotors, allClasses, allManufacturers, type CatalogMotor } from '../../services/motorDb';
import { STD_DIAMS, MAX_IDX, fitIdx, type MountFit } from '../../services/motorPicker';
import { useUnits } from '../../prefs/useUnits';
import { RangeSlider } from './RangeSlider';

/**
 * The filter controls the motor picker and the motor dashboard share: the same
 * manufacturer dropdown, class chips, impulse bounds, diameter range and
 * plugged box, over the same filter state. Each dialog lays them out differently (the picker
 * stacks them, the dashboard puts them on one row), so this is a set of pieces
 * rather than one bar. They were two verbatim copies, and the dashboard's
 * diameter readout had drifted to raw millimeters while the picker's followed
 * the user's unit.
 *
 * One piece is NOT shared: fitting the mount only means something where there is
 * a mount, which is the picker. The dashboard is a reference browser with no
 * rocket in mind.
 */

export interface MotorFilterInit {
  /** Manufacturers to start checked (the picker remembers the user's set). */
  mfrs?: Set<string>;
  /** Diameter range as [low, high] slider indices. */
  dia?: [number, number];
  /**
   * The mount being loaded, when there is one. Only the picker has it; the
   * dashboard browses the catalog with no rocket in mind, so it has nothing to
   * fit and never shows the checkbox.
   */
  mount?: MountFit | null;
}

/** Total impulse bounds in N·s, either end open. */
export type ImpulseRange = [min: number | null, max: number | null];

/** Filter state over a catalog and the rows that survive it. */
export function useMotorFilter(catalog: CatalogMotor[], init: MotorFilterInit = {}) {
  const [text, setText] = useState('');
  const [cls, setCls] = useState<string | null>(null);
  const [mfrs, setMfrs] = useState<Set<string>>(() => init.mfrs ?? new Set());
  const [imp, setImp] = useState<ImpulseRange>([null, null]);
  const [plugged, setPlugged] = useState(false);
  const mount = init.mount ?? null;
  /** The slider stop the mount can take, and the ceiling the box pulls down to. */
  const mountIdx = mount ? fitIdx(mount.bore) : MAX_IDX;
  // On by default wherever there IS a mount: the picker was already hiding
  // motors too fat for the bore, by quietly defaulting the diameter slider's
  // top stop, which left the user with a narrowed list and nothing on screen
  // saying why. A checkbox does the same job and admits to it.
  const [fits, setFits] = useState(mount !== null);
  /**
   * The ceiling the USER last asked for, which the mount's cap never overwrites.
   *
   * Two states rather than one, because the slider is showing two different
   * things at different times: what the mount allows while the box is ticked,
   * and what the user chose while it is not. Holding only the displayed value
   * meant the mount's cap got saved as though it were a preference, and the
   * range picked for an 18 mm mount then followed the user to every other mount
   * they ever opened.
   */
  const [freeHigh, setFreeHigh] = useState(() => (init.dia ?? [0, MAX_IDX])[1]);
  const [dia, setDiaRaw] = useState<[number, number]>(() => {
    const d = init.dia ?? [0, MAX_IDX];
    // The box starts ticked where there is a mount, so the slider starts capped.
    return mount ? [Math.min(d[0], mountIdx), Math.min(d[1], mountIdx)] : d;
  });

  /**
   * Ticking pulls the diameter ceiling down to what the mount takes; clearing it
   * gives back whatever ceiling the user had. The restriction is then a thing
   * you can SEE, which is the whole point of the box.
   *
   * It never WIDENS a narrower choice: someone who asked for 13 mm and up did
   * not ask for 18 mm just by ticking a box.
   */
  const setFitsAndCeiling = (on: boolean) => {
    setFits(on);
    if (!mount) return;
    setDiaRaw(([low]) => [on ? Math.min(low, mountIdx) : low, on ? Math.min(freeHigh, mountIdx) : freeHigh]);
  };

  /**
   * A drag is always the user speaking, so it is always what gets remembered -
   * and dragging the ceiling ABOVE what the mount takes clears the box, because
   * asking to see 38 mm motors in a 24 mm mount is asking to see past the mount.
   * Leaving the box ticked there would leave a control that moved and changed
   * nothing.
   */
  const setDia = (next: [number, number]) => {
    setDiaRaw(next);
    setFreeHigh(next[1]);
    if (fits && mount && next[1] > mountIdx) setFits(false);
  };

  const classes = useMemo(() => allClasses(catalog), [catalog]);
  const manufacturers = useMemo(() => allManufacturers(catalog), [catalog]);
  const fit = fits && mount ? mount : undefined;
  const [lowIdx, highIdx] = dia;
  /** What to remember: the user's own ceiling, never the mount's cap. */
  const diaSaved = useMemo(() => [lowIdx, freeHigh] as [number, number], [lowIdx, freeHigh]);
  const [impMin, impMax] = imp;
  const matches = useMemo(
    () =>
      filterMotors(catalog, {
        text,
        classes: cls ? new Set([cls]) : new Set(),
        manufacturers: mfrs,
        // The extreme stops mean "open end" (no floor / no ceiling).
        minDiameter: lowIdx > 0 ? STD_DIAMS[lowIdx] : undefined,
        maxDiameter: highIdx < MAX_IDX ? STD_DIAMS[highIdx] : undefined,
        minImpulse: impMin ?? undefined,
        maxImpulse: impMax ?? undefined,
        fit,
        plugged,
      }),
    [catalog, text, cls, mfrs, lowIdx, highIdx, impMin, impMax, fit, plugged],
  );
  return {
    text,
    setText,
    cls,
    setCls,
    mfrs,
    setMfrs,
    dia,
    setDia,
    diaSaved,
    imp,
    setImp,
    plugged,
    setPlugged,
    fits,
    setFits: setFitsAndCeiling,
    mount,
    classes,
    manufacturers,
    matches,
  };
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${active ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300'}`}
    >
      {label}
    </button>
  );
}

/** "All" plus one chip per impulse class present in the catalog. */
export function ClassChips({
  classes,
  cls,
  onChange,
}: {
  classes: string[];
  cls: string | null;
  onChange: (cls: string | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Chip label={t('motor.all')} active={cls === null} onClick={() => onChange(null)} />
      {classes.map((c) => (
        <Chip key={c} label={c} active={cls === c} onClick={() => onChange(cls === c ? null : c)} />
      ))}
    </>
  );
}

/** The manufacturer multi-select: a summary naming the current set, checkboxes below. */
export function ManufacturerMenu({
  manufacturers,
  mfrs,
  onChange,
  align = 'left',
  className = '',
}: {
  manufacturers: string[];
  mfrs: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Which edge the dropdown hangs from. */
  align?: 'left' | 'right';
  className?: string;
}) {
  const { t } = useTranslation();
  const toggle = (m: string) => {
    const n = new Set(mfrs);
    if (n.has(m)) n.delete(m);
    else n.add(m);
    onChange(n);
  };
  return (
    <details className={`relative ${className}`}>
      <summary className="cursor-pointer list-none rounded-lg bg-slate-950 px-3 py-1.5 text-sm text-slate-100 ring-1 ring-white/10">
        {mfrs.size === 0
          ? t('motorDlg.allManufacturers')
          : mfrs.size === 1
            ? [...mfrs][0]
            : t('motorDlg.mfrCount', { n: mfrs.size })}
      </summary>
      <div
        className={`absolute top-full z-20 mt-1 max-h-64 w-64 overflow-y-auto rounded-lg bg-slate-950 p-1 shadow-xl ring-1 ring-white/10 ${
          align === 'left' ? 'left-0' : 'right-0'
        }`}
      >
        <button
          onClick={() => onChange(new Set())}
          className="w-full rounded px-2 py-1 text-left text-xs font-medium text-sky-400 hover:bg-slate-800"
        >
          {t('motorDlg.allManufacturers')}
        </button>
        {manufacturers.map((m) => (
          <label
            key={m}
            className="flex items-center gap-2 rounded px-2 py-1 text-sm text-slate-200 hover:bg-slate-800"
          >
            <input type="checkbox" checked={mfrs.has(m)} className="accent-sky-500" onChange={() => toggle(m)} />
            {m}
          </label>
        ))}
      </div>
    </details>
  );
}

/** The diameter range slider with its readout in the user's motor-dimension unit. */
export function DiameterRange({ dia, onChange }: { dia: [number, number]; onChange: (dia: [number, number]) => void }) {
  const { t } = useTranslation();
  const u = useUnits();
  const [lowIdx, highIdx] = dia;
  // The stops are the standard motor sizes, held in mm because that is what
  // the catalog and the fit query speak; only the readout moves to the user's
  // unit.
  const stop = (i: number) => u.fmt('motorDimensions', STD_DIAMS[i]! / 1000);
  return (
    <div className="flex items-center gap-3 text-xs text-slate-300">
      <span className="shrink-0 text-slate-500">{t('motorDlg.diameter')}</span>
      <RangeSlider
        count={STD_DIAMS.length}
        low={lowIdx}
        high={highIdx}
        onChange={(lo, hi) => onChange([lo, hi])}
        label={t('motorDlg.diameter')}
        stops={STD_DIAMS.map((_, i) => `${stop(i)} ${u.sym('motorDimensions')}`)}
      />
      <span className="w-20 shrink-0 text-right tabular-nums text-slate-400">
        {lowIdx > 0 ? stop(lowIdx) : t('motorDlg.any')}–{highIdx < MAX_IDX ? stop(highIdx) : t('motorDlg.any')}{' '}
        {u.sym('motorDimensions')}
      </span>
    </div>
  );
}

/**
 * The total-impulse bounds, typed in the user's impulse unit.
 *
 * Numbers rather than a slider over the class boundaries, because that slider
 * would only be the class chips again: a class is a doubling bucket, so H is
 * everything from 160 to 320 N·s, and the question worth asking here is "at
 * least 400", which comes out of a design and lands between letters.
 */
export function ImpulseRange({ imp, onChange }: { imp: ImpulseRange; onChange: (imp: ImpulseRange) => void }) {
  const { t } = useTranslation();
  const u = useUnits();
  const field =
    'w-16 rounded-md bg-slate-950 px-2 py-1 text-right text-xs tabular-nums text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500';
  // Held in N·s like the catalog; only what is typed and shown moves to the
  // user's unit, the same split the diameter stops use.
  const bound = (text: string): number | null => {
    const n = Number(text);
    return text.trim() === '' || !Number.isFinite(n) ? null : u.fromUi('impulse', n);
  };
  const shown = (si: number | null) => (si == null ? '' : String(Number(u.toUi('impulse', si).toFixed(3))));
  return (
    <div className="flex items-center gap-2 text-xs text-slate-300">
      <span className="shrink-0 text-slate-500">{t('motorDlg.totalImpulse')}</span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        value={shown(imp[0])}
        onChange={(e) => onChange([bound(e.target.value), imp[1]])}
        placeholder={t('motorDlg.min')}
        aria-label={`${t('motorDlg.totalImpulse')} ${t('motorDlg.min')}`}
        className={field}
      />
      <span aria-hidden="true">–</span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        value={shown(imp[1])}
        onChange={(e) => onChange([imp[0], bound(e.target.value)])}
        placeholder={t('motorDlg.max')}
        aria-label={`${t('motorDlg.totalImpulse')} ${t('motorDlg.max')}`}
        className={field}
      />
      <span className="shrink-0 text-slate-500">{u.sym('impulse')}</span>
    </div>
  );
}

/** A checkbox filter: the look the fit and plugged boxes share. */
function FilterCheck({
  label,
  hint,
  on,
  onChange,
}: {
  label: string;
  hint: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-300" title={hint}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="accent-sky-500" />
      {label}
    </label>
  );
}

/**
 * Motors the manufacturer lists as available PLUGGED, with no ejection charge.
 *
 * What the spec says, not what is possible: the delay control offers a plugged
 * choice on every motor, because any motor can be flown that way for staging or
 * for electronically triggered recovery. This finds the ones BUILT without a
 * charge, which is most reloads and every hybrid.
 */
export function PluggedFilter({ plugged, onChange }: { plugged: boolean; onChange: (plugged: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <FilterCheck label={t('motorDlg.plugged')} hint={t('motorDlg.pluggedHint')} on={plugged} onChange={onChange} />
  );
}

/**
 * "Fits the mount": the bore and the length the rocket actually has room for.
 *
 * It names the bore, because a filter that silently removes two thirds of the
 * catalog should say what it measured against - and because the number is the
 * one thing the user cannot see from inside this dialog.
 */
export function FitsMount({
  mount,
  fits,
  onChange,
}: {
  mount: MountFit;
  fits: boolean;
  onChange: (fits: boolean) => void;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  return (
    <FilterCheck
      label={t('motorDlg.fitsMount', {
        bore: `${u.fmt('motorDimensions', mount.bore / 1000)} ${u.sym('motorDimensions')}`,
      })}
      hint={t('motorDlg.fitsMountHint')}
      on={fits}
      onChange={onChange}
    />
  );
}
