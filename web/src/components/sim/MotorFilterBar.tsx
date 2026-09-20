import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { filterMotors, allClasses, allManufacturers, type CatalogMotor } from '../../services/motorDb';
import { STD_DIAMS, MAX_IDX } from '../../services/motorPicker';
import { useUnits } from '../../prefs/useUnits';
import { RangeSlider } from './RangeSlider';

/**
 * The filter controls the motor picker and the motor dashboard share: the same
 * manufacturer dropdown, class chips and diameter range, over the same filter
 * state. Each dialog lays them out differently (the picker stacks them, the
 * dashboard puts them on one row), so this is a set of pieces rather than one
 * bar. They were two verbatim copies, and the dashboard's diameter readout had
 * drifted to raw millimeters while the picker's followed the user's unit.
 */

export interface MotorFilterInit {
  /** Manufacturers to start checked (the picker remembers the user's set). */
  mfrs?: Set<string>;
  /** Diameter range as [low, high] slider indices. */
  dia?: [number, number];
}

/** Filter state over a catalog and the rows that survive it. */
export function useMotorFilter(catalog: CatalogMotor[], init: MotorFilterInit = {}) {
  const [text, setText] = useState('');
  const [cls, setCls] = useState<string | null>(null);
  const [mfrs, setMfrs] = useState<Set<string>>(() => init.mfrs ?? new Set());
  const [dia, setDia] = useState<[number, number]>(() => init.dia ?? [0, MAX_IDX]);
  const classes = useMemo(() => allClasses(catalog), [catalog]);
  const manufacturers = useMemo(() => allManufacturers(catalog), [catalog]);
  const [lowIdx, highIdx] = dia;
  const matches = useMemo(
    () =>
      filterMotors(catalog, {
        text,
        classes: cls ? new Set([cls]) : new Set(),
        manufacturers: mfrs,
        // The extreme stops mean "open end" (no floor / no ceiling).
        minDiameter: lowIdx > 0 ? STD_DIAMS[lowIdx] : undefined,
        maxDiameter: highIdx < MAX_IDX ? STD_DIAMS[highIdx] : undefined,
      }),
    [catalog, text, cls, mfrs, lowIdx, highIdx],
  );
  return { text, setText, cls, setCls, mfrs, setMfrs, dia, setDia, classes, manufacturers, matches };
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
      />
      <span className="w-20 shrink-0 text-right tabular-nums text-slate-400">
        {lowIdx > 0 ? stop(lowIdx) : t('motorDlg.any')}–{highIdx < MAX_IDX ? stop(highIdx) : t('motorDlg.any')}{' '}
        {u.sym('motorDimensions')}
      </span>
    </div>
  );
}
