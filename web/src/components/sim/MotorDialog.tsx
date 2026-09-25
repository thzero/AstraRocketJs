import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hasCurve, importCustomMotorFromEng, deleteCustomMotor, type CatalogMotor } from '../../services/motorDb';
import { fetchMotorSpec } from '../../services/thrustcurve';
import { MAX_IDX, parseDelays, type MountFit } from '../../services/motorPicker';
import { PLUGGED_DELAY, type MotorSpec } from '../../engine/openRocketEngine';
import { useUnits } from '../../prefs/useUnits';
import { Dialog } from '../common/Dialog';
import { CatalogLoading, CatalogError } from '../common/CatalogLoading';
import { MotorDetail } from './MotorDetail';
import { keyOf } from './motorKey';
import { useCatalog } from './useCatalog';
import {
  ClassChips,
  DiameterRange,
  FitsMount,
  ImpulseRange,
  ManufacturerMenu,
  PluggedFilter,
  useMotorFilter,
} from './MotorFilterBar';

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
/**
 * The diameter range [lowIdx, highIdx], remembered across sessions.
 *
 * A NEW key, because whatever is under the old one was very likely never chosen
 * by anyone: the picker used to seed the ceiling from the mount on first open
 * and then save it as though it were a preference, so a range picked for an
 * 18 mm mount followed the user to every other mount they ever loaded. The
 * mount's cap belongs to the fit checkbox now, and starting this over costs at
 * most one drag of a slider.
 */
const DIA_KEY = 'astrarrocketjs:motorPicker:dia2';
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
 * impulse class, total impulse, diameter, whether the motor comes plugged, and
 * (by default) whether it fits the mount; imports a custom .eng; resolves the
 * chosen motor's thrust curve via `onSelect`.
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
  mount,
  current,
}: {
  onClose: () => void;
  onSelect: (m: MotorSpec) => void;
  onError: (msg: string | null) => void;
  /**
   * The mount being loaded: its bore and the length it has room for, in mm. What
   * the "fits the mount" filter measures against. Null when the geometry cannot
   * be read, and the filter is then not offered rather than guessing at it.
   */
  mount?: MountFit | null;
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
  /**
   * The remembered diameter range is now a plain PREFERENCE.
   *
   * It used to default its top stop to whatever fitted this mount, and from then
   * on that read as the user's own setting: pick for a 29 mm mount once, and the
   * stored range followed you to a 54 mm mount and hid every motor that mount
   * exists to fly. Capping by the mount belongs to the fit checkbox, which is
   * per-mount, visible, and can be turned off.
   */
  const [filterInit] = useState(() => ({
    mfrs: loadMfrs(),
    dia: loadDia() ?? ([0, MAX_IDX] as [number, number]),
    mount: mount && mount.bore > 0 ? mount : null,
  }));
  const {
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
    setFits,
    mount: fitMount,
    classes,
    manufacturers,
    matches,
  } = useMotorFilter(catalog, filterInit);

  // Persist the manufacturer selection and diameter range across sessions.
  useEffect(() => {
    saveMfrs(mfrs);
  }, [mfrs]);
  // `diaSaved`, not the displayed range: while the fit box is ticked the slider
  // is showing the MOUNT's ceiling, and saving that would write a machine's
  // choice into the user's preference, which is the bug this whole control
  // replaced.
  useEffect(() => {
    saveDia(diaSaved);
  }, [diaSaved]);

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

  // What the dialog acts on is the highlight the user can SEE. `selected` is
  // kept across filter changes so clearing a filter brings the highlight back,
  // but while the filter hides that row there is no visible highlight, and a
  // Select button applying a motor that is not on screen (the seated C6 while
  // the list shows A8s) was the surprise the picker used to hand out. Derived,
  // not cleared, so nothing has to be reset when the filter changes back.
  const selectedKey = selected ? keyOf(selected) : null;
  const shown = selected && matches.some((m) => keyOf(m) === selectedKey) ? selected : null;

  return (
    <Dialog
      id="motorPicker"
      title={t('motorDlg.title')}
      onClose={onClose}
      size="4xl"
      // List beside detail, each scrolling itself and reaching the panel's
      // edges: the body takes the height and does its own padding.
      layout="fill"
      // Fixed rather than the viewport's height: the list is the working surface
      // and it should not become a screen-tall column on a large monitor.
      height={720}
    >
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* LEFT: filters + list + count */}
        <div
          className={`flex min-h-0 flex-col md:w-[360px] md:shrink-0 md:border-r md:border-white/10 ${shown ? 'hidden md:flex' : 'flex'}`}
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

            {/* Impulse sits with the class chips it refines and above the
                diameter, which is a property of the mount rather than of how
                much motor this is. */}
            <ImpulseRange imp={imp} onChange={setImp} />
            <DiameterRange dia={dia} onChange={setDia} />
            {/* Both boxes on one row: two short labels, and stacked they pushed
                the list itself another line down a 360px column. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {fitMount && <FitsMount mount={fitMount} fits={fits} onChange={setFits} />}
              <PluggedFilter plugged={plugged} onChange={setPlugged} />
            </div>
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
              {matches.length === 0 && (
                <li className="px-3 py-8 text-center text-sm text-slate-500">
                  {t('motorDlg.noResults')}
                  {/* The likeliest reason for an empty list is the fit filter,
                      which is on by default whenever there is a mount to judge
                      against. Name it, rather than leaving a blank panel. */}
                  {fits && <div className="mt-1 text-xs text-slate-600">{t('motorDlg.fitsMountHint')}</div>}
                </li>
              )}
            </ul>
          )}

          <div className="border-t border-white/10 p-2 text-center text-[11px] uppercase tracking-wide text-slate-500">
            {loading ? '' : t('motor.count', { total: matches.length })}
          </div>
        </div>
        {/* end LEFT */}

        {/* RIGHT: detail + apply */}
        <div className={`min-h-0 min-w-0 flex-1 flex-col ${shown ? 'flex' : 'hidden md:flex'}`}>
          {shown ? (
            <>
              <MotorDetail
                motor={shown}
                onBack={() => setSelected(null)}
                curveIndex={curveIdx}
                onCurveChange={setCurveIdx}
              />
              <div className="flex shrink-0 items-center justify-between gap-2 border-t border-white/10 p-2">
                <DelayControl motor={shown} delay={delay} onDelay={setDelay} />
                <button
                  onClick={() => pick(shown, curveIdx)}
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
    </Dialog>
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
