import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hasCurve, importCustomMotorFromEng, deleteCustomMotor, type CatalogMotor } from '../../services/motorDb';
import { fetchMotorSpec } from '../../services/thrustcurve';
import { MAX_IDX, fitIdx, parseDelays } from '../../services/motorPicker';
import { PLUGGED_DELAY, type MotorSpec } from '../../engine/openRocketEngine';
import { useUnits } from '../../prefs/useUnits';
import { useFocusTrap } from '../common/useFocusTrap';
import { CatalogLoading, CatalogError } from '../common/CatalogLoading';
import { MotorDetail } from './MotorDetail';
import { keyOf } from './motorKey';
import { useCatalog } from './useCatalog';
import { ClassChips, DiameterRange, ManufacturerMenu, useMotorFilter } from './MotorFilterBar';

// Selected manufacturers persist across sessions (the user's usual set).
const MFRS_KEY = 'astrarrocketjs:motorPicker:mfrs';
const loadMfrs = (): Set<string> => {
  try {
    const r = localStorage.getItem(MFRS_KEY);
    return new Set(r ? (JSON.parse(r) as string[]) : []);
  } catch {
    return new Set();
  }
};
const saveMfrs = (s: Set<string>) => {
  try {
    localStorage.setItem(MFRS_KEY, JSON.stringify([...s]));
  } catch {
    /* storage off */
  }
};
// The diameter range [lowIdx, highIdx] is remembered across sessions.
const DIA_KEY = 'astrarrocketjs:motorPicker:dia';
const loadDia = (): [number, number] | null => {
  try {
    const v = JSON.parse(localStorage.getItem(DIA_KEY) ?? 'null');
    return Array.isArray(v) && v.length === 2 ? [v[0], v[1]] : null;
  } catch {
    return null;
  }
};
const saveDia = (d: [number, number]) => {
  try {
    localStorage.setItem(DIA_KEY, JSON.stringify(d));
  } catch {
    /* storage off */
  }
};

/** The delay a motor with no delay data starts at (a common mid-range charge). */
const DEFAULT_DELAY = 3;

/**
 * The catalog row a seated motor came from, for pre-selecting it.
 *
 * A MotorSpec carries no `code`, so a spec built from the bundled catalog says
 * "AeroTech F67" for both the F67W and the F67C, which are one common name
 * in one bore. Match on the common name OR the full code (a spec resolved from
 * thrustcurve.org carries the full designation), then narrow same-name pairs
 * by bore and by the curve source the spec was built from. Two motors sharing
 * all of manufacturer, name, bore and curve label remain indistinguishable
 * from the spec alone, and the first catalog match wins.
 */
function findSeated(catalog: CatalogMotor[], cur: MotorSpec): CatalogMotor | undefined {
  const named = catalog.filter(
    (m) => m.manufacturer === cur.manufacturer && (m.designation === cur.designation || m.code === cur.designation),
  );
  if (named.length <= 1) return named[0];
  const mm = Math.round(cur.diameter * 1000);
  const byBore = named.filter((m) => m.diameter === mm);
  const pool = byBore.length ? byBore : named;
  return (cur.curveSrc && pool.find((m) => m.curves?.some((c) => c.src === cur.curveSrc))) || pool[0];
}

/**
 * Modal motor picker. Filters the catalog by engine code (text), manufacturer(s),
 * impulse class, and (by default) whether the motor fits the mount; imports a
 * custom .eng; resolves the chosen motor's thrust curve via `onSelect`.
 *
 * Mounted only while open (`{open && <MotorDialog />}`), so every piece of
 * state here starts fresh per opening and nothing has to be reset on close.
 * The previous "reseed on open" effects left the last motor's ejection delay
 * on the next pick after a reopen.
 */
export function MotorDialog({
  onClose,
  onSelect,
  onError,
  mountDiameter,
  current,
}: {
  onClose: () => void;
  onSelect: (m: MotorSpec) => void;
  onError: (msg: string | null) => void;
  /** Motor-mount bore (mm), enables the "only motors that fit" filter. */
  mountDiameter?: number | null;
  /** The motor already seated on this mount, pre-selected when the dialog opens. */
  current?: MotorSpec | null;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const [delay, setDelay] = useState(DEFAULT_DELAY);
  // The highlighted (but not yet applied) motor. Applying happens via the
  // Select button, so a click just previews the choice. Identified by keyOf,
  // so the highlight survives a filter change that reorders the list.
  const [selected, setSelected] = useState<CatalogMotor | null>(null);
  // Which of the motor's thrust curves to use (some motors have several).
  const [curveIdx, setCurveIdx] = useState(0);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const panelRef = useFocusTrap<HTMLDivElement>(true, { onEscape: onClose });
  // Generation of the pick in flight. fetchMotorSpec can take seconds over the
  // network; a result that lands after the user canceled (this dialog is
  // unmounted on close) used to be applied to the mount anyway.
  const pickGen = useRef(0);
  useEffect(
    () => () => {
      pickGen.current++;
    },
    [],
  );

  // Opening from a card with a motor already on it pre-selects that motor,
  // highlighted in the list with its curve and delay restored, so "Change..."
  // resumes from the current choice instead of a blank detail pane. Done when
  // the catalog lands: the one moment the list exists and nothing has been
  // clicked yet, so no later click has to know about it.
  const { catalog, setCatalog, loading, error, retry } = useCatalog({
    onLoaded: (c) => {
      const m = current && findSeated(c, current);
      if (!m) return;
      setSelected(m);
      setDelay(current.ejectionDelay);
      const ci = m.curves?.findIndex((cv) => cv.src === current.curveSrc) ?? -1;
      setCurveIdx(ci >= 0 ? ci : 0);
    },
  });
  // First use defaults the diameter ceiling to the mount's fitting size.
  const [filterInit] = useState(() => ({
    mfrs: loadMfrs(),
    dia:
      loadDia() ??
      ([0, mountDiameter != null && mountDiameter > 0 ? fitIdx(mountDiameter) : MAX_IDX] as [number, number]),
  }));
  const { text, setText, cls, setCls, mfrs, setMfrs, dia, setDia, classes, manufacturers, matches } = useMotorFilter(
    catalog,
    filterInit,
  );

  // Persist the manufacturer selection and diameter range across sessions.
  useEffect(() => {
    saveMfrs(mfrs);
  }, [mfrs]);
  useEffect(() => {
    saveDia(dia);
  }, [dia]);

  // Clicking a DIFFERENT motor starts from its own defaults: the best (first)
  // curve, and a mid value of its own delay charges, or plugged for a
  // plugged-only motor. In the handler, not an effect keyed on the selection,
  // so the seeded values above are never stomped and never leak forward.
  const choose = (m: CatalogMotor) => {
    setSelected(m);
    setCurveIdx(0);
    const { delays, plugged } = parseDelays(m.delays);
    if (delays.length) setDelay(delays[Math.floor(delays.length / 2)]!);
    else if (plugged) setDelay(PLUGGED_DELAY);
    else setDelay(DEFAULT_DELAY);
  };

  const pick = async (m: CatalogMotor, curveIndex = 0) => {
    const gen = ++pickGen.current;
    setLoadingKey(keyOf(m));
    onError(null);
    try {
      const spec = await fetchMotorSpec(m, delay, curveIndex);
      // Canceled, or superseded by another pick, while the fetch was out.
      if (gen !== pickGen.current) return;
      onSelect(spec);
      onClose();
    } catch (e) {
      if (gen !== pickGen.current) return;
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      if (gen === pickGen.current) setLoadingKey(null);
    }
  };

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    onError(null);
    try {
      setCatalog(await importCustomMotorFromEng(await file.text()));
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const onDelete = async (m: CatalogMotor) => {
    if (!m.id) return;
    onError(null);
    try {
      setCatalog(await deleteCustomMotor(m.id));
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const selectedKey = selected ? keyOf(selected) : null;

  return (
    <div
      className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="motor-dialog-title"
        className="dialog-panel flex h-[720px] max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-white/10 p-3">
          <h2 id="motor-dialog-title" className="text-sm font-semibold text-slate-200">
            {t('motorDlg.title')}
          </h2>
          <button
            onClick={onClose}
            aria-label={t('banner.close')}
            className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* LEFT: filters + list + count */}
          <div
            className={`flex min-h-0 flex-col md:w-[360px] md:shrink-0 md:border-r md:border-white/10 ${selected ? 'hidden md:flex' : 'flex'}`}
          >
            <div className="space-y-2 p-3">
              <div className="flex gap-2">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  autoFocus
                  placeholder={t('motorDlg.searchCode')}
                  className="min-w-0 flex-1 rounded-lg bg-slate-950 px-3 py-2 text-sm text-slate-100 ring-1 ring-white/10 placeholder:text-slate-500 focus:outline-none focus:ring-sky-500"
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  className="shrink-0 rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700"
                >
                  {t('motor.importEng')}
                </button>
                <input ref={fileRef} type="file" accept=".eng,.ENG" className="hidden" onChange={onImport} />
              </div>

              <div className="flex gap-2">
                <ManufacturerMenu
                  manufacturers={manufacturers}
                  mfrs={mfrs}
                  onChange={setMfrs}
                  className="min-w-0 flex-1"
                />
              </div>

              <div className="flex flex-wrap gap-1">
                <ClassChips classes={classes} cls={cls} onChange={setCls} />
              </div>

              <DiameterRange dia={dia} onChange={setDia} />
            </div>

            {error ? (
              <div className="grid min-h-0 flex-1 place-items-center p-6">
                <CatalogError message={`${t('catalog.failedMotors')} ${error}`} onRetry={retry} />
              </div>
            ) : loading ? (
              <div className="grid min-h-0 flex-1 place-items-center p-6">
                <CatalogLoading name="motors" label={t('motorDlg.loadingCatalog')} />
              </div>
            ) : (
              <ul className="min-h-0 flex-1 divide-y divide-white/5 overflow-y-auto">
                {matches.map((m) => {
                  const k = keyOf(m);
                  const isLoading = loadingKey === k;
                  return (
                    <li key={k} className="flex items-stretch">
                      <button
                        onClick={() => choose(m)}
                        onDoubleClick={() => pick(m)}
                        disabled={loadingKey !== null}
                        aria-pressed={selectedKey === k}
                        className={`flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2 text-left text-sm disabled:opacity-50 ${
                          selectedKey === k ? 'bg-sky-600/25 ring-1 ring-inset ring-sky-500/50' : 'hover:bg-slate-800'
                        }`}
                      >
                        <span className="min-w-0">
                          {m.custom && (
                            <span className="mr-1 text-amber-400" title={t('motor.importedTitle')}>
                              ★
                            </span>
                          )}
                          <span className="font-medium text-slate-100">{m.designation}</span>
                          <span className="ml-2 text-xs text-slate-500">{m.manufacturer}</span>
                          {!m.custom && !hasCurve(m) && (
                            <span
                              className="ml-2 rounded bg-slate-700 px-1 py-0.5 text-[9px] uppercase tracking-wide text-slate-400"
                              title={t('motorDlg.noBundledCurve')}
                            >
                              {t('dash.noCurve')}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-slate-400">
                          {isLoading
                            ? t('motorDlg.loading')
                            : `${u.fmt('impulse', m.impulse, m.impulse < 10 ? 1 : 0)} ${u.sym(
                                'impulse',
                              )} · ${u.fmt('motorDimensions', m.diameter / 1000, 0)} ${u.sym('motorDimensions')}`}
                        </span>
                      </button>
                      {m.custom && (
                        <button
                          onClick={() => onDelete(m)}
                          aria-label={t('motor.deleteTitle', { name: m.designation })}
                          className="shrink-0 px-3 text-red-400 hover:bg-slate-800"
                        >
                          ✕
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="border-t border-white/10 p-2 text-center text-[11px] uppercase tracking-wide text-slate-500">
              {loading ? '' : t('motor.count', { total: matches.length })}
            </div>
          </div>
          {/* end LEFT */}

          {/* RIGHT: detail + apply */}
          <div className={`min-h-0 min-w-0 flex-1 flex-col ${selected ? 'flex' : 'hidden md:flex'}`}>
            {selected ? (
              <>
                <MotorDetail
                  motor={selected}
                  onBack={() => setSelected(null)}
                  curveIndex={curveIdx}
                  onCurveChange={setCurveIdx}
                />
                <div className="flex shrink-0 items-center justify-between gap-2 border-t border-white/10 p-2">
                  <DelayControl motor={selected} delay={delay} onDelay={setDelay} />
                  <button
                    onClick={() => pick(selected, curveIdx)}
                    disabled={loadingKey !== null}
                    className="shrink-0 rounded-lg bg-sky-600 px-5 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                  >
                    {loadingKey !== null ? t('motorDlg.loading') : t('motorDlg.select')}
                  </button>
                </div>
              </>
            ) : (
              <div className="grid flex-1 place-items-center p-6 text-center text-sm text-slate-500">
                {t('motorDlg.pickHint')}
              </div>
            )}
          </div>
        </div>
        {/* end two-pane */}
      </div>
    </div>
  );
}

/** Delay picker for the selected motor: its own charges as quick chips (default
 *  a mid value), an optional Plugged chip, and a manual override. Plugged-only
 *  motors have no ejection charge, so nothing is shown. */
function DelayControl({ motor, delay, onDelay }: { motor: CatalogMotor; delay: number; onDelay: (d: number) => void }) {
  const { t } = useTranslation();
  const { delays, plugged } = parseDelays(motor.delays);
  if (plugged && delays.length === 0) return <span />; // plugged-only: already plugged, no choice to make
  const chip = (active: boolean) =>
    `rounded px-1.5 py-0.5 text-xs font-medium ${active ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-slate-400">
      <span className="text-slate-500">{t('sims.delay')}</span>
      {delays.map((d) => (
        <button key={d} onClick={() => onDelay(d)} aria-pressed={delay === d} className={chip(delay === d)}>
          {d}
        </button>
      ))}
      {/* Any motor can be flown plugged (no ejection charge), not just ones whose
          spec lists it: useful for staging / alternate recovery triggers. */}
      <button
        onClick={() => onDelay(PLUGGED_DELAY)}
        aria-pressed={delay >= PLUGGED_DELAY}
        className={chip(delay >= PLUGGED_DELAY)}
      >
        {t('motor.plugged')}
      </button>
      <input
        type="number"
        min={0}
        step={0.5}
        value={delay >= PLUGGED_DELAY ? '' : delay}
        onChange={(e) => onDelay(Math.max(0, parseFloat(e.target.value) || 0))}
        placeholder={t('motorDlg.custom')}
        title={t('motorDlg.custom')}
        aria-label={t('sims.delay')}
        className="w-14 rounded bg-slate-950 px-1.5 py-0.5 text-right tabular-nums text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
      />
    </div>
  );
}
