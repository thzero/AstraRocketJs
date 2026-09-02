import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loadCatalog, filterMotors, allClasses, allManufacturers, hasCurve, type CatalogMotor } from '../../services/motorDb';
import { STD_DIAMS, MAX_IDX } from '../../services/motorPicker';
import { combineCurves, impulseClass, type Sample } from '../../services/motorCombine';
import { fmtNum } from '../../i18n/format';
import { MotorDetail, Stat } from './MotorDetail';
import { RangeSlider } from './RangeSlider';

/** Stable identity for a motor across filter/sort changes (mfr + name + bore). */
const keyOf = (m: CatalogMotor) => `${m.manufacturer}|${m.designation}|${m.diameter}`;
const avgOf = (m: CatalogMotor) => m.avgThrust ?? (m.burn > 0 ? m.impulse / m.burn : 0);
const num = (v: number | undefined, d: number) => (v != null && Number.isFinite(v) ? fmtNum(v, d) : '—');

const G = 9.80665;
/** Specific impulse (s) — total impulse per unit propellant weight; NaN if unknown. */
const ispOf = (m: CatalogMotor) => (m.propWeightG ? m.impulse / ((m.propWeightG / 1000) * G) : NaN);
/** Propellant mass fraction (%) — prop weight over loaded weight; NaN if unknown. */
const massFracOf = (m: CatalogMotor) => (m.propWeightG && m.mass ? (m.propWeightG / m.mass) * 100 : NaN);
/** Sortable numeric that sinks unknowns to the bottom on ascending sort. */
const sortNum = (v: number) => (Number.isFinite(v) ? v : -1);

// Compare-overlay series colors — dataviz categorical dark slots 1–6, in the
// fixed CVD-safe order (validated; the legend + direct labels are the required
// secondary encoding for the floor-band adjacent pair). A 7th+ motor greys out.
const SERIES = ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767'];
const seriesColor = (i: number) => SERIES[i] ?? '#94a3b8';

interface Col {
  id: string;
  label: string;   // i18n suffix under `dash.*`
  align: 'left' | 'center' | 'right';
  always?: boolean;
  cell: (m: CatalogMotor) => string;
  sortVal?: (m: CatalogMotor) => number | string; // omit → not sortable
}

// Every column the grid can show. `always` = the anchor (Motor), never hidden.
const COLUMNS: Col[] = [
  { id: 'designation', label: 'colMotor', align: 'left', always: true, cell: (m) => m.designation, sortVal: (m) => m.designation },
  { id: 'manufacturer', label: 'colMfr', align: 'left', cell: (m) => m.manufacturer, sortVal: (m) => m.manufacturer },
  { id: 'class', label: 'colClass', align: 'center', cell: (m) => m.class, sortVal: (m) => m.class },
  { id: 'diameter', label: 'colDia', align: 'right', cell: (m) => String(m.diameter), sortVal: (m) => m.diameter },
  { id: 'impulse', label: 'colImpulse', align: 'right', cell: (m) => fmtNum(m.impulse, m.impulse < 10 ? 1 : 0), sortVal: (m) => m.impulse },
  { id: 'avg', label: 'colAvg', align: 'right', cell: (m) => num(avgOf(m), 0), sortVal: (m) => avgOf(m) },
  { id: 'peak', label: 'colPeak', align: 'right', cell: (m) => num(m.maxThrust, 0), sortVal: (m) => m.maxThrust ?? 0 },
  { id: 'burn', label: 'colBurn', align: 'right', cell: (m) => fmtNum(m.burn, 1), sortVal: (m) => m.burn },
  { id: 'length', label: 'colLength', align: 'right', cell: (m) => num(m.length, 0), sortVal: (m) => m.length ?? 0 },
  { id: 'mass', label: 'colMass', align: 'right', cell: (m) => num(m.mass, 0), sortVal: (m) => m.mass ?? 0 },
  { id: 'prop', label: 'colProp', align: 'right', cell: (m) => num(m.propWeightG, 0), sortVal: (m) => m.propWeightG ?? 0 },
  { id: 'delays', label: 'colDelays', align: 'center', cell: (m) => m.delays ?? '—' },
  { id: 'type', label: 'colType', align: 'center', cell: (m) => m.type ?? '—', sortVal: (m) => m.type ?? '' },
  { id: 'code', label: 'colCode', align: 'left', cell: (m) => m.code || m.designation, sortVal: (m) => m.code || m.designation },
  { id: 'isp', label: 'colIsp', align: 'right', cell: (m) => num(ispOf(m), 0), sortVal: (m) => sortNum(ispOf(m)) },
  { id: 'massFrac', label: 'colMassFrac', align: 'right', cell: (m) => (Number.isFinite(massFracOf(m)) ? `${fmtNum(massFracOf(m), 0)}%` : '—'), sortVal: (m) => sortNum(massFracOf(m)) },
  { id: 'sparky', label: 'colSparky', align: 'center', cell: (m) => (m.sparky ? '⚡' : '—'), sortVal: (m) => (m.sparky ? 1 : 0) },
  { id: 'curves', label: 'colCurves', align: 'right', cell: (m) => String(m.curves?.length ?? 0), sortVal: (m) => m.curves?.length ?? 0 },
];
const DEFAULT_COLS = ['designation', 'manufacturer', 'class', 'diameter', 'impulse', 'avg', 'burn'];
const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;

// The chosen columns persist across sessions.
const COLS_KEY = 'astrarrocketjs:motorDash:cols';
const loadCols = (): string[] => {
  try { const r = JSON.parse(localStorage.getItem(COLS_KEY) ?? 'null'); return Array.isArray(r) && r.length ? r as string[] : DEFAULT_COLS; }
  catch { return DEFAULT_COLS; }
};
const saveCols = (ids: string[]) => { try { localStorage.setItem(COLS_KEY, JSON.stringify(ids)); } catch { /* storage off */ } };

type Mode = 'detail' | 'combine' | 'compare';

/**
 * Standalone motor reference — a sortable, column-configurable grid of every
 * bundled motor with a detail pane (thrust curve + specs) and arrow-key
 * stepping, plus two multi-select tools over the checked motors: COMBINE (sum
 * into one cluster curve) and COMPARE (overlay their curves + specs). Read-only
 * and offline — it inspects/compares, it doesn't seat a motor (that's the picker).
 */
export function MotorDashboard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<CatalogMotor[]>([]);
  const [text, setText] = useState('');
  const [cls, setCls] = useState<string | null>(null);
  const [mfrs, setMfrs] = useState<Set<string>>(new Set());
  const [dia, setDia] = useState<[number, number]>([0, MAX_IDX]);
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 } | null>(null);
  const [visCols, setVisCols] = useState<string[]>(loadCols);
  const [selected, setSelected] = useState<CatalogMotor | null>(null);
  const [curveIdx, setCurveIdx] = useState(0);
  const [checked, setChecked] = useState<Map<string, CatalogMotor>>(new Map());
  const [mode, setMode] = useState<Mode>('detail');
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    let live = true;
    loadCatalog().then((c) => { if (live) setCatalog(c); });
    return () => { live = false; };
  }, []);
  useEffect(() => { saveCols(visCols); }, [visCols]);

  const classes = useMemo(() => allClasses(catalog), [catalog]);
  const manufacturers = useMemo(() => allManufacturers(catalog), [catalog]);
  const [lowIdx, highIdx] = dia;
  const filtered = useMemo(() => filterMotors(catalog, {
    text,
    classes: cls ? new Set([cls]) : new Set(),
    manufacturers: mfrs,
    minDiameter: lowIdx > 0 ? STD_DIAMS[lowIdx] : undefined,
    maxDiameter: highIdx < MAX_IDX ? STD_DIAMS[highIdx] : undefined,
  }), [catalog, text, cls, mfrs, lowIdx, highIdx]);

  // Columns to render — in canonical COLUMNS order regardless of toggle order.
  const cols = useMemo(() => COLUMNS.filter((c) => c.always || visCols.includes(c.id)), [visCols]);

  const shown = useMemo(() => {
    const col = sort && COLUMNS.find((c) => c.id === sort.id);
    if (!col?.sortVal) return filtered;
    const val = col.sortVal;
    return [...filtered].sort((a, b) => {
      const va = val(a), vb = val(b);
      const c = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sort!.dir * c;
    });
  }, [filtered, sort]);

  useEffect(() => { setCurveIdx(0); }, [selected]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || !shown.length) return;
      e.preventDefault();
      const i = selected ? shown.findIndex((m) => keyOf(m) === keyOf(selected)) : -1;
      setSelected(shown[e.key === 'ArrowDown' ? Math.min(shown.length - 1, i + 1) : Math.max(0, i - 1)] ?? null);
      setMode('detail');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, shown, selected]);

  useEffect(() => {
    if (!selected) return;
    bodyRef.current?.querySelector(`[data-key="${CSS.escape(keyOf(selected))}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const checkedMotors = [...checked.values()];
  const combined = useMemo(
    () => combineCurves(checkedMotors.map((m) => (m.curves?.[0]?.samples ?? []) as Sample[])),
    [checked],
  );
  const effMode: Mode = (mode === 'combine' || mode === 'compare') && checked.size >= 2 ? mode : 'detail';

  if (!open) return null;

  const toggleCheck = (m: CatalogMotor) => setChecked((prev) => {
    const next = new Map(prev);
    const k = keyOf(m);
    if (next.has(k)) next.delete(k); else next.set(k, m);
    return next;
  });
  const toggleCol = (id: string) => setVisCols((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const clickHeader = (id: string) => setSort((s) => (s && s.id === id ? { id, dir: (s.dir * -1) as 1 | -1 } : { id, dir: 1 }));
  const g = (v: number, unit: string, d = 1) => (Number.isFinite(v) ? `${fmtNum(v, d)} ${unit}` : '—');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="flex h-[760px] max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 border-b border-white/10 p-3">
          <h2 className="text-sm font-semibold text-slate-200">{t('dash.title')}</h2>
          <div className="flex items-center gap-2">
            {checked.size > 0 && (
              <>
                <span className="text-xs text-slate-400">{t('dash.selectedN', { n: checked.size })}</span>
                <button onClick={() => { setChecked(new Map()); setMode('detail'); }} className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700">{t('dash.clear')}</button>
              </>
            )}
            <button onClick={onClose} aria-label={t('banner.close')} className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700">✕</button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* LEFT: filters + sortable grid. min-w-0 lets this flex child shrink
              below the table's intrinsic width so the grid scrolls internally
              instead of pushing the detail pane. Hidden while a full-width tool
              (compare/combine) is open. */}
          <div className={`${effMode === 'detail' ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-1 flex-col md:border-r md:border-white/10`}>
            <div className="flex flex-wrap items-center gap-2 p-3">
              <input
                value={text} onChange={(e) => setText(e.target.value)} autoFocus
                placeholder={t('motorDlg.searchCode')}
                className="min-w-[140px] flex-1 rounded-lg bg-slate-950 px-3 py-1.5 text-sm text-slate-100 ring-1 ring-white/10 placeholder:text-slate-500 focus:outline-none focus:ring-sky-500"
              />
              <details className="relative">
                <summary className="cursor-pointer list-none rounded-lg bg-slate-950 px-3 py-1.5 text-sm text-slate-100 ring-1 ring-white/10">
                  {mfrs.size === 0 ? t('motorDlg.allManufacturers') : mfrs.size === 1 ? [...mfrs][0] : t('motorDlg.mfrCount', { n: mfrs.size })}
                </summary>
                <div className="absolute right-0 top-full z-20 mt-1 max-h-64 w-64 overflow-y-auto rounded-lg bg-slate-950 p-1 shadow-xl ring-1 ring-white/10">
                  <button onClick={() => setMfrs(new Set())} className="w-full rounded px-2 py-1 text-left text-xs font-medium text-sky-400 hover:bg-slate-800">{t('motorDlg.allManufacturers')}</button>
                  {manufacturers.map((m) => (
                    <label key={m} className="flex items-center gap-2 rounded px-2 py-1 text-sm text-slate-200 hover:bg-slate-800">
                      <input type="checkbox" checked={mfrs.has(m)} className="accent-sky-500" onChange={() => setMfrs((p) => { const n = new Set(p); if (n.has(m)) n.delete(m); else n.add(m); return n; })} />
                      {m}
                    </label>
                  ))}
                </div>
              </details>
              {/* Column chooser (persisted) */}
              <details className="relative">
                <summary className="cursor-pointer list-none rounded-lg bg-slate-950 px-3 py-1.5 text-sm text-slate-100 ring-1 ring-white/10">{t('dash.columns')}</summary>
                <div className="absolute right-0 top-full z-20 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg bg-slate-950 p-1 shadow-xl ring-1 ring-white/10">
                  {COLUMNS.filter((c) => !c.always).map((c) => (
                    <label key={c.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm text-slate-200 hover:bg-slate-800">
                      <input type="checkbox" checked={visCols.includes(c.id)} className="accent-sky-500" onChange={() => toggleCol(c.id)} />
                      {t(`dash.${c.label}`)}
                    </label>
                  ))}
                </div>
              </details>
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <span className="shrink-0 text-slate-500">{t('motorDlg.diameter')}</span>
                <RangeSlider count={STD_DIAMS.length} low={lowIdx} high={highIdx} onChange={(lo, hi) => setDia([lo, hi])} label={t('motorDlg.diameter')} />
                <span className="w-16 shrink-0 text-right tabular-nums text-slate-400">
                  {lowIdx > 0 ? STD_DIAMS[lowIdx] : t('motorDlg.any')}–{highIdx < MAX_IDX ? STD_DIAMS[highIdx] : t('motorDlg.any')}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 px-3 pb-2">
              <Chip label={t('motor.all')} active={cls === null} onClick={() => setCls(null)} />
              {classes.map((c) => <Chip key={c} label={c} active={cls === c} onClick={() => setCls(cls === c ? null : c)} />)}
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="min-w-full border-collapse whitespace-nowrap text-sm">
                <thead className="sticky top-0 z-10 bg-slate-900 text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="w-8 px-2 py-1.5" />
                    {cols.map((c) => (
                      <th key={c.id} className={`px-2 py-1.5 font-semibold ${ALIGN[c.align]}`}>
                        {c.sortVal ? (
                          <button onClick={() => clickHeader(c.id)} className={`inline-flex items-center gap-0.5 hover:text-slate-300 ${sort?.id === c.id ? 'text-sky-400' : ''}`}>
                            {t(`dash.${c.label}`)}{sort?.id === c.id && <span aria-hidden>{sort.dir === 1 ? '▲' : '▼'}</span>}
                          </button>
                        ) : t(`dash.${c.label}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody ref={bodyRef}>
                  {shown.map((m) => {
                    const k = keyOf(m);
                    const isSel = !!selected && keyOf(selected) === k;
                    return (
                      <tr
                        key={k} data-key={k}
                        onClick={() => { setSelected(m); setMode('detail'); }}
                        className={`cursor-pointer border-t border-white/5 tabular-nums ${isSel ? 'bg-sky-600/25' : 'hover:bg-slate-800/60'}`}
                      >
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox" checked={checked.has(k)} disabled={!hasCurve(m)}
                            aria-label={t('dash.select', { name: m.designation })}
                            title={hasCurve(m) ? undefined : t('dash.noCurveTip')}
                            onClick={(e) => e.stopPropagation()} onChange={() => toggleCheck(m)}
                            className="accent-sky-500 disabled:opacity-30"
                          />
                        </td>
                        {cols.map((c) => (
                          <td key={c.id} className={`px-2 py-1.5 ${ALIGN[c.align]} ${c.always ? 'font-medium text-slate-100' : 'text-slate-300'}`}>
                            {c.always && m.custom && <span className="mr-1 text-amber-400">★</span>}{c.cell(m)}
                            {c.always && !hasCurve(m) && <span className="ml-1.5 rounded bg-slate-700 px-1 py-0.5 text-[9px] font-normal uppercase tracking-wide text-slate-400">{t('dash.noCurve')}</span>}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t border-white/10 p-2 text-center text-[11px] uppercase tracking-wide text-slate-500">{t('motor.count', { total: shown.length })}</div>
          </div>

          {/* RIGHT: detail rail (narrow) or a full-width tool (compare/combine). */}
          <div className={`min-h-0 overflow-y-auto ${effMode === 'detail' ? 'w-full md:w-[440px] md:shrink-0' : 'w-full flex-1'}`}>
            {effMode !== 'detail' && (
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-white/10 bg-slate-900 px-3 py-2">
                <button onClick={() => setMode('detail')} className="rounded-lg bg-slate-800 px-3 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700">← {t('dash.back')}</button>
                <ToolBtn active={effMode === 'compare'} disabled={checked.size < 2} onClick={() => setMode('compare')}>{t('dash.compareN', { n: checked.size })}</ToolBtn>
                <ToolBtn active={effMode === 'combine'} disabled={checked.size < 2} onClick={() => setMode('combine')}>{t('dash.combine', { n: checked.size })}</ToolBtn>
              </div>
            )}
            {effMode === 'compare' ? (
              <ComparePane motors={checkedMotors} cols={cols} />
            ) : effMode === 'combine' ? (
              <div className="mx-auto max-w-3xl px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-400/90">{t('dash.combined')}</div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs font-semibold text-emerald-300">{impulseClass(combined.totalImpulse)}</span>
                  <h3 className="text-2xl font-bold text-slate-100">{t('dash.cluster', { n: combined.motorCount })}</h3>
                </div>
                <div className="mt-0.5 text-sm text-slate-400">{checkedMotors.map((m) => m.designation).join(' + ')}</div>
                {combined.samples.length >= 2 && (
                  <CombineChart
                    combined={combined.samples}
                    series={checkedMotors.map((m, i) => ({ m, color: seriesColor(i), pts: (m.curves?.[0]?.samples ?? []) as Sample[] }))}
                  />
                )}
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                  <Stat label={t('dash.motors')} value={String(combined.motorCount)} />
                  <Stat label={t('motorDlg.totalImpulse')} value={g(combined.totalImpulse, 'N·s')} />
                  <Stat label={t('motorDlg.maxThrust')} value={g(combined.peakThrust, 'N')} />
                  <Stat label={t('motorDlg.avgThrust')} value={g(combined.avgThrust, 'N')} />
                  <Stat label={t('motorDlg.burnTime')} value={g(combined.burnTime, 's', 2)} />
                </dl>
                <p className="mt-2 text-[11px] leading-snug text-slate-500">{t('dash.combineNote')}</p>
              </div>
            ) : checked.size >= 2 ? (
              // A multi-selection is active: prompt with what the two tools do,
              // rather than a single motor's detail.
              <div className="p-6">
                <div className="mx-auto max-w-xs space-y-4 text-center">
                  <div className="text-xs uppercase tracking-wide text-slate-500">{t('dash.selectedN', { n: checked.size })}</div>
                  <div className="space-y-2 text-left">
                    <button onClick={() => setMode('compare')} className="w-full rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500">{t('dash.compareN', { n: checked.size })}</button>
                    <p className="text-xs leading-snug text-slate-500">{t('dash.compareDesc')}</p>
                    <button onClick={() => setMode('combine')} className="w-full rounded-lg bg-slate-700 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600">{t('dash.combine', { n: checked.size })}</button>
                    <p className="text-xs leading-snug text-slate-500">{t('dash.combineDesc')}</p>
                  </div>
                </div>
              </div>
            ) : selected ? (
              <MotorDetail motor={selected} curveIndex={curveIdx} onCurveChange={setCurveIdx} />
            ) : (
              <div className="grid h-full place-items-center p-6 text-center text-sm text-slate-500">{t('dash.hint')}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} className={`rounded-full px-2.5 py-1 text-xs font-medium ${active ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300'}`}>{label}</button>;
}

function ToolBtn({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick} disabled={disabled} aria-pressed={active}
      className={`w-24 rounded-lg px-3 py-1 text-center text-xs font-medium ring-1 ring-white/10 disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}
    >
      {children}
    </button>
  );
}

/** Cluster chart: the summed total as a filled orange envelope with each motor's
 *  own curve overlaid on top (categorical colors), so you see each contribution.
 *  Legend + direct labels are the secondary encoding for the palette floor band. */
function CombineChart({ combined, series }: { combined: Sample[]; series: { m: CatalogMotor; color: string; pts: Sample[] }[] }) {
  const { t } = useTranslation();
  const usable = series.filter((s) => s.pts.length >= 2);
  const W = 560, H = 220, PL = 40, PR = 12, PT = 12, PB = 24;
  const tMax = Math.max(1, combined[combined.length - 1]?.[0] ?? 0, ...usable.flatMap((s) => s.pts.map((p) => p[0])));
  const fMax = Math.max(1, ...combined.map((s) => s[1])) * 1.08; // the sum is the envelope (max)
  const X = (tt: number) => PL + (tt / tMax) * (W - PL - PR);
  const Y = (f: number) => H - PB - (f / fMax) * (H - PT - PB);
  const path = (pts: Sample[]) => pts.map((p, i) => `${i ? 'L' : 'M'} ${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join(' ');
  const area = `M ${X(0).toFixed(1)} ${Y(0).toFixed(1)} ${combined.map((p) => `L ${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join(' ')} L ${X(tMax).toFixed(1)} ${Y(0).toFixed(1)} Z`;
  const labelDirect = usable.length <= 4;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="mt-2 block max-w-2xl">
        <defs>
          <linearGradient id="combFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f97316" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#f97316" stopOpacity="0.03" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => {
          const gy = Y(fMax * f);
          return <g key={f}>
            <line x1={PL} y1={gy} x2={W - PR} y2={gy} className="stroke-white/10" />
            <text x={PL - 4} y={gy + 3} textAnchor="end" className="fill-slate-500 text-[9px] tabular-nums">{fmtNum(fMax * f, 0)}</text>
          </g>;
        })}
        {[0, tMax / 2, tMax].map((tt, i) => (
          <text key={i} x={X(tt)} y={H - 6} textAnchor="middle" className="fill-slate-500 text-[9px] tabular-nums">{fmtNum(tt, tt < 10 ? 1 : 0)}</text>
        ))}
        <path d={area} fill="url(#combFill)" />
        {usable.map((s) => {
          const peak = s.pts.reduce((a, b) => (b[1] > a[1] ? b : a));
          return (
            <g key={keyOf(s.m)}>
              <path d={path(s.pts)} fill="none" stroke={s.color} strokeWidth="1.5" />
              {labelDirect && <text x={X(peak[0])} y={Y(peak[1]) - 4} textAnchor="middle" className="text-[8px] font-semibold" fill={s.color}>{s.m.designation}</text>}
            </g>
          );
        })}
        {/* the summed total, drawn on top */}
        <path d={path(combined)} fill="none" stroke="#f97316" strokeWidth="2.5" />
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-300">
        <span className="inline-flex items-center gap-1">
          <svg width="12" height="4" aria-hidden><line x1="0" y1="2" x2="12" y2="2" stroke="#f97316" strokeWidth="2.5" /></svg>{t('dash.total')}
        </span>
        {usable.map((s) => (
          <span key={keyOf(s.m)} className="inline-flex items-center gap-1">
            <svg width="12" height="4" aria-hidden><line x1="0" y1="2" x2="12" y2="2" stroke={s.color} strokeWidth="2" /></svg>{s.m.designation}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Compare pane: overlaid thrust curves (legend + direct labels are the required
 *  secondary encoding) and a side-by-side spec table using the grid's chosen
 *  columns. */
function ComparePane({ motors, cols }: { motors: CatalogMotor[]; cols: Col[] }) {
  const { t } = useTranslation();
  // Assign a colour only to motors that actually have a curve (in order), so the
  // chart, legend and table dots agree — and a curveless motor gets none.
  const colorFor = new Map<string, string>();
  let ci = 0;
  for (const m of motors) {
    if ((m.curves?.[0]?.samples?.length ?? 0) >= 2) colorFor.set(keyOf(m), seriesColor(ci++));
  }
  const series = motors
    .filter((m) => colorFor.has(keyOf(m)))
    .map((m) => ({ m, color: colorFor.get(keyOf(m))!, pts: m.curves![0]!.samples as Sample[] }));
  // Identity is the motor name (+ colour dot); show every other chosen column.
  const specCols = cols.filter((c) => c.id !== 'designation');

  const W = 440, H = 190, PL = 36, PR = 12, PT = 12, PB = 24;
  const tMax = Math.max(1, ...series.flatMap((s) => s.pts.map((p) => p[0])));
  const fMax = Math.max(1, ...series.flatMap((s) => s.pts.map((p) => p[1]))) * 1.08;
  const X = (tt: number) => PL + (tt / tMax) * (W - PL - PR);
  const Y = (f: number) => H - PB - (f / fMax) * (H - PT - PB);
  const labelDirect = series.length <= 4;

  return (
    <div className="mx-auto max-w-5xl px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-400/90">{t('dash.compareTitle')}</div>
      <h3 className="mt-1 text-lg font-bold text-slate-100">{t('dash.compareN', { n: motors.length })}</h3>

      {series.length >= 1 ? (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="mt-2 block max-w-xl">
            {[0, 0.5, 1].map((f) => {
              const gy = Y(fMax * f);
              return <g key={f}>
                <line x1={PL} y1={gy} x2={W - PR} y2={gy} className="stroke-white/10" />
                <text x={PL - 4} y={gy + 3} textAnchor="end" className="fill-slate-500 text-[9px] tabular-nums">{fmtNum(fMax * f, 0)}</text>
              </g>;
            })}
            {[0, tMax / 2, tMax].map((tt, i) => (
              <text key={i} x={X(tt)} y={H - 6} textAnchor="middle" className="fill-slate-500 text-[9px] tabular-nums">{fmtNum(tt, tt < 10 ? 1 : 0)}</text>
            ))}
            {series.map((s) => {
              const d = s.pts.map((p, i) => `${i ? 'L' : 'M'} ${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join(' ');
              const peak = s.pts.reduce((a, b) => (b[1] > a[1] ? b : a));
              return (
                <g key={keyOf(s.m)}>
                  <path d={d} fill="none" stroke={s.color} strokeWidth="2" />
                  {labelDirect && (
                    <text x={X(peak[0])} y={Y(peak[1]) - 5} textAnchor="middle" className="text-[9px] font-semibold" fill={s.color}>{s.m.designation}</text>
                  )}
                </g>
              );
            })}
          </svg>
          {/* Legend — identity is never color-alone. */}
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-300">
            {series.map((s) => (
              <span key={keyOf(s.m)} className="inline-flex items-center gap-1">
                <svg width="12" height="4" aria-hidden><line x1="0" y1="2" x2="12" y2="2" stroke={s.color} strokeWidth="2" /></svg>
                {s.m.designation}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="my-4 rounded-lg bg-slate-800/50 p-3 text-xs text-slate-400">{t('motorDlg.noCurve')}</p>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse whitespace-nowrap text-xs tabular-nums">
          <thead className="text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-2 py-1 text-left font-semibold">{t('dash.colMotor')}</th>
              {specCols.map((c) => <th key={c.id} className={`px-2 py-1 font-semibold ${ALIGN[c.align]}`}>{t(`dash.${c.label}`)}</th>)}
            </tr>
          </thead>
          <tbody>
            {motors.map((m) => (
              <tr key={keyOf(m)} className="border-t border-white/5">
                <td className="px-2 py-1 font-medium text-slate-100">
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: colorFor.get(keyOf(m)) ?? '#475569' }} />
                  {m.designation}
                  {!colorFor.has(keyOf(m)) && <span className="ml-1 text-[10px] font-normal text-slate-500">({t('dash.noCurve')})</span>}
                </td>
                {specCols.map((c) => <td key={c.id} className={`px-2 py-1 text-slate-300 ${ALIGN[c.align]}`}>{c.cell(m)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
