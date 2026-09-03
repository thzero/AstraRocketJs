import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  loadCatalog, filterMotors, allClasses, allManufacturers, hasCurve,
  importCustomMotorFromEng, deleteCustomMotor, type CatalogMotor,
} from '../../services/motorDb';
import { fetchMotorSpec } from '../../services/thrustcurve';
import { STD_DIAMS, MAX_IDX, fitIdx, parseDelays } from '../../services/motorPicker';
import { PLUGGED_DELAY, type MotorSpec } from '../../engine/openRocketEngine';
import { fmtNum } from '../../i18n/format';
import { MotorDetail } from './MotorDetail';
import { RangeSlider } from './RangeSlider';

// Selected manufacturers persist across sessions (the user's usual set).
const MFRS_KEY = 'astrarrocketjs:motorPicker:mfrs';
const loadMfrs = (): Set<string> => {
  try { const r = localStorage.getItem(MFRS_KEY); return new Set(r ? (JSON.parse(r) as string[]) : []); } catch { return new Set(); }
};
const saveMfrs = (s: Set<string>) => { try { localStorage.setItem(MFRS_KEY, JSON.stringify([...s])); } catch { /* storage off */ } };
// The diameter range [lowIdx, highIdx] is remembered across sessions.
const DIA_KEY = 'astrarrocketjs:motorPicker:dia';
const loadDia = (): [number, number] | null => {
  try {
    const v = JSON.parse(localStorage.getItem(DIA_KEY) ?? 'null');
    return Array.isArray(v) && v.length === 2 ? [v[0], v[1]] : null;
  } catch { return null; }
};
const saveDia = (d: [number, number]) => { try { localStorage.setItem(DIA_KEY, JSON.stringify(d)); } catch { /* storage off */ } };

/**
 * Modal motor picker. Filters the catalogue by engine code (text), manufacturer(s),
 * impulse class, and (by default) whether the motor fits the mount; imports a
 * custom .eng; resolves the chosen motor's thrust curve via `onSelect`.
 */
export function MotorDialog({ open, onClose, onSelect, onError, mountDiameter, current }: {
  open: boolean;
  onClose: () => void;
  onSelect: (m: MotorSpec) => void;
  onError: (msg: string | null) => void;
  /** Motor-mount bore (mm) — enables the "only motors that fit" filter. */
  mountDiameter?: number | null;
  /** The motor already seated on this mount — pre-selected when the dialog opens. */
  current?: MotorSpec | null;
}) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<CatalogMotor[]>([]);
  const [text, setText] = useState('');
  const [cls, setCls] = useState<string | null>(null);
  const [mfrs, setMfrs] = useState<Set<string>>(loadMfrs);
  // Diameter range as [low, high] slider indices. Remembered across sessions;
  // first use defaults the top to the mount's fitting size, the bottom to lowest.
  const [dia, setDia] = useState<[number, number]>(
    () => loadDia() ?? [0, mountDiameter != null && mountDiameter > 0 ? fitIdx(mountDiameter) : MAX_IDX],
  );
  const [delay, setDelay] = useState(3);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  // The highlighted (but not yet applied) row. Applying happens via the Select
  // button, so a click just previews the choice.
  const [selected, setSelected] = useState<{ m: CatalogMotor; rowId: string } | null>(null);
  // Which of the motor's thrust curves to use (some motors have several).
  const [curveIdx, setCurveIdx] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  // Pre-selecting the seated motor sets its own delay/curve; this tells the
  // "reset on selection change" effect below to leave those alone that once.
  const seedRef = useRef(false);
  // Seed at most once per opening (cleared when the dialog closes).
  const seededOpenRef = useRef(false);

  useEffect(() => {
    let live = true;
    loadCatalog().then((c) => { if (live) setCatalog(c); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const classes = useMemo(() => allClasses(catalog), [catalog]);
  const manufacturers = useMemo(() => allManufacturers(catalog), [catalog]);
  const [lowIdx, highIdx] = dia;
  const matches = useMemo(
    () => filterMotors(catalog, {
      text,
      classes: cls ? new Set([cls]) : new Set(),
      manufacturers: mfrs,
      // The extreme stops mean "open end" (no floor / no ceiling).
      minDiameter: lowIdx > 0 ? STD_DIAMS[lowIdx] : undefined,
      maxDiameter: highIdx < MAX_IDX ? STD_DIAMS[highIdx] : undefined,
    }),
    [catalog, text, cls, mfrs, lowIdx, highIdx],
  );
  const shown = matches;

  // Persist the manufacturer selection and diameter range across sessions.
  useEffect(() => { saveMfrs(mfrs); }, [mfrs]);
  useEffect(() => { saveDia(dia); }, [dia]);
  // A filter change rebuilds the list (and row ids), so drop any highlight.
  useEffect(() => { setSelected(null); }, [text, cls, mfrs, lowIdx, highIdx]);
  // Selecting a different motor resets the curve choice to the best (first).
  useEffect(() => {
    // A pre-seeded selection carries the seated motor's own delay/curve — don't
    // stomp them with the defaults on this first run.
    if (seedRef.current) { seedRef.current = false; return; }
    setCurveIdx(0);
    if (!selected) return;
    // Default the delay to one of the motor's own charges (a mid value), or
    // plugged for a plugged-only motor.
    const { delays, plugged } = parseDelays(selected.m.delays);
    if (delays.length) setDelay(delays[Math.floor(delays.length / 2)]!);
    else if (plugged) setDelay(PLUGGED_DELAY);
    // Intentionally keyed on rowId only: reset the curve/delay when a DIFFERENT
    // motor is picked, not on every `selected` identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.rowId]);

  // Opening from a card with a motor already on it pre-selects that motor —
  // highlighted in the list, its curve + delay restored — so "Change…" resumes
  // from the current choice instead of a blank detail pane.
  useEffect(() => {
    if (!open) { seededOpenRef.current = false; return; }
    if (seededOpenRef.current || catalog.length === 0) return;
    seededOpenRef.current = true;
    if (!current) return;
    const i = matches.findIndex((m) => m.manufacturer === current.manufacturer && m.designation === current.designation);
    const m = i >= 0 ? matches[i]! : catalog.find((mm) => mm.manufacturer === current.manufacturer && mm.designation === current.designation);
    if (!m) return;
    // Highlight the real row when it's in view; otherwise (filtered out) still
    // show it in the detail pane via a non-colliding id.
    const rowId = i >= 0 ? `${m.manufacturer}:${m.designation}:${i}` : `seed:${m.manufacturer}:${m.designation}`;
    seedRef.current = true;
    setSelected({ m, rowId });
    setDelay(current.ejectionDelay);
    const ci = m.curves?.findIndex((c) => c.src === current.curveSrc) ?? -1;
    setCurveIdx(ci >= 0 ? ci : 0);
  }, [open, catalog, matches, current]);

  if (!open) return null;

  const pick = async (m: CatalogMotor, rowId: string, curveIndex = 0) => {
    setLoadingId(rowId);
    onError(null);
    try {
      onSelect(await fetchMotorSpec(m, delay, curveIndex));
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingId(null);
    }
  };

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    onError(null);
    try { setCatalog(await importCustomMotorFromEng(await file.text())); }
    catch (err) { onError(err instanceof Error ? err.message : String(err)); }
  };

  const onDelete = async (m: CatalogMotor) => {
    if (!m.id) return;
    onError(null);
    try { setCatalog(await deleteCustomMotor(m.id)); }
    catch (err) { onError(err instanceof Error ? err.message : String(err)); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="flex h-[720px] max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 border-b border-white/10 p-3">
          <h2 className="text-sm font-semibold text-slate-200">{t('motorDlg.title')}</h2>
          <button onClick={onClose} aria-label={t('banner.close')} className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700">✕</button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* LEFT: filters + list + count */}
        <div className={`flex min-h-0 flex-col md:w-[360px] md:shrink-0 md:border-r md:border-white/10 ${selected ? 'hidden md:flex' : 'flex'}`}>
        <div className="space-y-2 p-3">
          <div className="flex gap-2">
            <input
              value={text} onChange={(e) => setText(e.target.value)} autoFocus
              placeholder={t('motorDlg.searchCode')}
              className="min-w-0 flex-1 rounded-lg bg-slate-950 px-3 py-2 text-sm text-slate-100 ring-1 ring-white/10 placeholder:text-slate-500 focus:outline-none focus:ring-sky-500"
            />
            <button onClick={() => fileRef.current?.click()} className="shrink-0 rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700">
              {t('motor.importEng')}
            </button>
            <input ref={fileRef} type="file" accept=".eng,.ENG" className="hidden" onChange={onImport} />
          </div>

          <div className="flex gap-2">
            <details className="relative min-w-0 flex-1">
              <summary className="cursor-pointer list-none rounded-lg bg-slate-950 px-3 py-2 text-sm text-slate-100 ring-1 ring-white/10">
                {mfrs.size === 0 ? t('motorDlg.allManufacturers') : mfrs.size === 1 ? [...mfrs][0] : t('motorDlg.mfrCount', { n: mfrs.size })}
              </summary>
              <div className="absolute left-0 top-full z-20 mt-1 max-h-64 w-64 overflow-y-auto rounded-lg bg-slate-950 p-1 shadow-xl ring-1 ring-white/10">
                <button
                  onClick={() => setMfrs(new Set())}
                  className="w-full rounded px-2 py-1 text-left text-xs font-medium text-sky-400 hover:bg-slate-800"
                >{t('motorDlg.allManufacturers')}</button>
                {manufacturers.map((m) => (
                  <label key={m} className="flex items-center gap-2 rounded px-2 py-1 text-sm text-slate-200 hover:bg-slate-800">
                    <input
                      type="checkbox" checked={mfrs.has(m)} className="accent-sky-500"
                      onChange={() => setMfrs((prev) => { const n = new Set(prev); if (n.has(m)) n.delete(m); else n.add(m); return n; })}
                    />
                    {m}
                  </label>
                ))}
              </div>
            </details>
          </div>

          <div className="flex flex-wrap gap-1">
            <Chip label={t('motor.all')} active={cls === null} onClick={() => setCls(null)} />
            {classes.map((c) => <Chip key={c} label={c} active={cls === c} onClick={() => setCls(cls === c ? null : c)} />)}
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-300">
            <span className="shrink-0 text-slate-500">{t('motorDlg.diameter')}</span>
            <RangeSlider count={STD_DIAMS.length} low={lowIdx} high={highIdx} onChange={(lo, hi) => setDia([lo, hi])} label={t('motorDlg.diameter')} />
            <span className="w-20 shrink-0 text-right tabular-nums text-slate-400">
              {lowIdx > 0 ? STD_DIAMS[lowIdx] : t('motorDlg.any')}–{highIdx < MAX_IDX ? STD_DIAMS[highIdx] : t('motorDlg.any')} mm
            </span>
          </div>
        </div>

        <ul className="min-h-0 flex-1 divide-y divide-white/5 overflow-y-auto">
          {shown.map((m, i) => {
            const rowId = `${m.manufacturer}:${m.designation}:${i}`;
            const loading = loadingId === rowId;
            return (
              <li key={rowId} className="flex items-stretch">
                <button
                  onClick={() => setSelected({ m, rowId })}
                  onDoubleClick={() => pick(m, rowId)}
                  disabled={loadingId !== null}
                  aria-pressed={selected?.rowId === rowId}
                  className={`flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2 text-left text-sm disabled:opacity-50 ${
                    selected?.rowId === rowId ? 'bg-sky-600/25 ring-1 ring-inset ring-sky-500/50' : 'hover:bg-slate-800'
                  }`}
                >
                  <span className="min-w-0">
                    {m.custom && <span className="mr-1 text-amber-400" title={t('motor.importedTitle')}>★</span>}
                    <span className="font-medium text-slate-100">{m.designation}</span>
                    <span className="ml-2 text-xs text-slate-500">{m.manufacturer}</span>
                    {!m.custom && !hasCurve(m) && <span className="ml-2 rounded bg-slate-700 px-1 py-0.5 text-[9px] uppercase tracking-wide text-slate-400" title={t('motorDlg.noBundledCurve')}>{t('dash.noCurve')}</span>}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-slate-400">
                    {loading ? t('motorDlg.loading') : `${fmtNum(m.impulse, m.impulse < 10 ? 1 : 0)} Ns · ${m.diameter} mm`}
                  </span>
                </button>
                {m.custom && (
                  <button onClick={() => onDelete(m)} aria-label={t('motor.deleteTitle', { name: m.designation })} className="shrink-0 px-3 text-red-400 hover:bg-slate-800">✕</button>
                )}
              </li>
            );
          })}
        </ul>

        <div className="border-t border-white/10 p-2 text-center text-[11px] uppercase tracking-wide text-slate-500">
          {t('motor.count', { total: matches.length })}{matches.length > shown.length ? t('motor.showing', { shown: shown.length }) : ''}
        </div>
        </div>{/* end LEFT */}

        {/* RIGHT: detail + apply */}
        <div className={`min-h-0 min-w-0 flex-1 flex-col ${selected ? 'flex' : 'hidden md:flex'}`}>
          {selected ? (
            <>
              <MotorDetail motor={selected.m} onBack={() => setSelected(null)} curveIndex={curveIdx} onCurveChange={setCurveIdx} />
              <div className="flex shrink-0 items-center justify-between gap-2 border-t border-white/10 p-2">
                <DelayControl motor={selected.m} delay={delay} onDelay={setDelay} />
                <button
                  onClick={() => pick(selected.m, selected.rowId, curveIdx)}
                  disabled={loadingId !== null}
                  className="shrink-0 rounded-lg bg-sky-600 px-5 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                >
                  {loadingId !== null ? t('motorDlg.loading') : t('motorDlg.select')}
                </button>
              </div>
            </>
          ) : (
            <div className="grid flex-1 place-items-center p-6 text-center text-sm text-slate-500">{t('motorDlg.pickHint')}</div>
          )}
        </div>
        </div>{/* end two-pane */}
      </div>
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`rounded-full px-2.5 py-1 text-xs font-medium ${active ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300'}`}>
      {label}
    </button>
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
      {delays.map((d) => <button key={d} onClick={() => onDelay(d)} className={chip(delay === d)}>{d}</button>)}
      {/* Any motor can be flown plugged (no ejection charge), not just ones whose
          spec lists it — useful for staging / alternate recovery triggers. */}
      <button onClick={() => onDelay(PLUGGED_DELAY)} className={chip(delay >= PLUGGED_DELAY)}>{t('motor.plugged')}</button>
      <input
        type="number" min={0} step={0.5}
        value={delay >= PLUGGED_DELAY ? '' : delay}
        onChange={(e) => onDelay(Math.max(0, parseFloat(e.target.value) || 0))}
        placeholder={t('motorDlg.custom')} title={t('motorDlg.custom')}
        className="w-14 rounded bg-slate-950 px-1.5 py-0.5 text-right tabular-nums text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
      />
    </div>
  );
}

