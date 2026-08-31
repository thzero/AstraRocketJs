import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';
import { fmtNum } from '../../i18n/format';
import { dragTableCsv, downloadCsv } from '../../services/csvExport';
import { lerpAt } from '../../services/interpolate';
import type { DragSweep } from '../../engine/openRocketEngine';

/**
 * Drag analysis (RASAero-style "Aero Plots", mmrocket-style): three Mach-swept
 * charts off the static design — Cd vs Mach (power-off, + power-on when a nozzle
 * exit is set), a drag breakdown (by type friction/pressure/base, or by
 * component), and CP vs Mach (cm or % body length). A shared hover crosshair and
 * legend readout tie all three to one Mach. No flight needed — it's `dragSweep`.
 *
 * Colors use the dataviz skill's validated dark categorical order; every chart
 * ≥ 2 series carries a legend (identity is never color-alone).
 */
const CAT = ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767', '#d55181', '#d95926'];
const POWER_OFF = CAT[0]!;
const POWER_ON = CAT[7]!;

const PAD_L = 46, PAD_R = 14, PAD_T = 10, PAD_B = 20, CHART_H = 168;

interface Series { name: string; color: string; values: number[]; dash?: string; }

/** Engine aero-component keys arrive as "[Class.Instance]"; show the user's name
 *  when set, else the CamelCase class split into words (BodyTube → "Body Tube"). */
function niceName(raw: string): string {
  const m = raw.match(/^\[?([^.\]]+)\.([^.\]]+)\]?$/);
  const cls = m?.[1] ?? raw.replace(/[[\]]/g, '');
  const inst = m?.[2];
  const base = inst && inst !== cls ? inst : cls;
  return base.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}


export function DragAnalysis() {
  const { t } = useTranslation();
  const rocket = useWorkspaceStore((s) => s.rocket);
  const info = useWorkspaceStore((s) => s.info);
  const [machMax, setMachMax] = useState(3);
  const [mode, setMode] = useState<'type' | 'component'>('type');
  const [cpPct, setCpPct] = useState(false);
  const [hoverM, setHoverM] = useState<number | null>(null);

  const sweep = useMemo<DragSweep | null>(() => {
    if (!rocket) return null;
    try { return rocket.dragSweep({ machMin: 0.05, machMax, machStep: machMax > 3 ? 0.1 : 0.05 }); }
    catch { return null; }
  }, [rocket, machMax]);

  if (!sweep) return <div className="grid h-full place-items-center text-sm text-slate-500">{t('drag.unavailable')}</div>;

  const machs = sweep.machs;
  const machMin = machs[0] ?? 0.05;

  const cdSeries: Series[] = [{ name: t('drag.powerOff'), color: POWER_OFF, values: sweep.powerOff.total }];
  if (sweep.hasNozzle) cdSeries.push({ name: t('drag.powerOn'), color: POWER_ON, values: sweep.powerOn.total });

  const breakdown: Series[] = mode === 'type'
    ? [
        { name: t('drag.friction'), color: CAT[0]!, values: sweep.powerOff.friction },
        { name: t('drag.pressure'), color: CAT[1]!, values: sweep.powerOff.pressure },
        { name: t('drag.base'), color: CAT[2]!, values: sweep.powerOff.base },
      ]
    // Every (external) component individually. There are only 8 palette hues, so
    // components past the 8th repeat a hue but with a dash pattern, keeping each
    // line tellable (color alone is never the sole identifier).
    : sweep.components.map((c, i) => ({
        name: niceName(c.name),
        color: CAT[i % CAT.length]!,
        values: c.cd,
        dash: i >= CAT.length ? '5 3' : undefined,
      }));

  const bodyLen = info?.length ?? 0;
  const cpValues = cpPct && bodyLen > 0 ? sweep.cp.map((v) => (v / bodyLen) * 100) : sweep.cp.map((v) => v * 100);
  const cpSeries: Series[] = [{ name: t('flight.cp'), color: POWER_OFF, values: cpValues }];

  return (
    <div className="flex h-full flex-col rounded-xl bg-slate-900 ring-1 ring-white/10">
      <div className="flex flex-wrap items-center gap-2 px-3 pb-2 pt-3">
        <h2 className="mr-auto text-xs font-semibold uppercase tracking-wide text-slate-400">{t('drag.title')}</h2>
        <span className="text-[10px] text-slate-500">{t('drag.maxMach')}</span>
        <Seg options={[2, 3, 5] as const} value={machMax} onChange={setMachMax} fmt={(v) => `M${v}`} />
        <button
          onClick={() => downloadCsv('drag-table.csv', dragTableCsv(sweep))}
          title={t('drag.exportCsv')}
          className="rounded-md bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
        >
          ⬇ CSV
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        <ChartCard title={t('drag.cdVsMach')} machs={machs} machMin={machMin} machMax={machMax}
          series={cdSeries} unit="Cd" digits={3} hoverM={hoverM} setHoverM={setHoverM} />
        <ChartCard title={t('drag.breakdown')} machs={machs} machMin={machMin} machMax={machMax}
          series={breakdown} stacked={mode === 'type'} unit="Cd" digits={3} hoverM={hoverM} setHoverM={setHoverM}
          right={<Seg options={['type', 'component'] as const} value={mode} onChange={setMode}
            fmt={(v) => t(v === 'type' ? 'drag.byType' : 'drag.byComponent')} />} />
        <ChartCard title={t('drag.cpVsMach')} machs={machs} machMin={machMin} machMax={machMax}
          series={cpSeries} unit={cpPct ? '%' : 'cm'} digits={1} hoverM={hoverM} setHoverM={setHoverM}
          note={t('drag.supersonicNote')}
          right={<Seg options={[false, true] as const} value={cpPct} onChange={setCpPct}
            fmt={(v) => (v ? t('drag.pctBody') : 'cm')} disabled={bodyLen <= 0} />} />
      </div>
    </div>
  );
}

function Seg<T extends string | number | boolean>({ options, value, onChange, fmt, disabled }: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  fmt: (v: T) => string;
  disabled?: boolean;
}) {
  return (
    <div className={`inline-flex overflow-hidden rounded-md ring-1 ring-white/10 ${disabled ? 'pointer-events-none opacity-40' : ''}`}>
      {options.map((o) => (
        <button key={String(o)} onClick={() => onChange(o)}
          className={`px-2 py-0.5 text-[11px] font-medium ${value === o ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300'}`}>
          {fmt(o)}
        </button>
      ))}
    </div>
  );
}

function ChartCard({ title, note, right, machs, machMin, machMax, series, stacked, unit, digits, hoverM, setHoverM }: {
  title: string;
  note?: string;
  right?: React.ReactNode;
  machs: number[];
  machMin: number;
  machMax: number;
  series: Series[];
  stacked?: boolean;
  unit: string;
  digits: number;
  hoverM: number | null;
  setHoverM: (m: number | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(520);
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setW(Math.max(240, e[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const iw = w - PAD_L - PAD_R, ih = CHART_H - PAD_T - PAD_B;
  const span = machMax - machMin || 1;
  const X = (m: number) => PAD_L + ((m - machMin) / span) * iw;

  let yMin = 0, yMax = 0;
  if (stacked) {
    for (let i = 0; i < machs.length; i++) {
      let s = 0;
      for (const se of series) s += Math.max(0, se.values[i] ?? 0);
      if (s > yMax) yMax = s;
    }
  } else {
    yMin = Infinity; yMax = -Infinity;
    for (const se of series) for (const v of se.values) if (Number.isFinite(v)) { if (v > yMax) yMax = v; if (v < yMin) yMin = v; }
    if (!Number.isFinite(yMax)) { yMax = 1; yMin = 0; }
    yMin = Math.min(0, yMin);
  }
  if (yMax === yMin) yMax = yMin + 1;
  yMax += (yMax - yMin) * 0.08;
  const Y = (v: number) => PAD_T + (1 - (v - yMin) / (yMax - yMin)) * ih;

  const finite = (m: number, v: number) => Number.isFinite(m) && Number.isFinite(v);
  const linePath = (vals: number[]) =>
    machs.map((m, i) => (finite(m, vals[i] ?? NaN) ? `${i ? 'L' : 'M'}${X(m).toFixed(1)},${Y(vals[i]!).toFixed(1)}` : '')).join(' ');

  // Stacked areas: cumulative bottom→top, each band drawn as a filled polygon
  // with a thin surface stroke along its top edge (the dataviz 2px-gap rule).
  const bands: { fill: string; d: string }[] = [];
  if (stacked) {
    const cum = new Array<number>(machs.length).fill(0);
    for (const se of series) {
      const lower = cum.slice();
      for (let i = 0; i < machs.length; i++) cum[i] = (cum[i] ?? 0) + Math.max(0, se.values[i] ?? 0);
      const top = machs.map((m, i) => `${X(m).toFixed(1)},${Y(cum[i]!).toFixed(1)}`).join(' L');
      const bot = machs.map((m, i) => `${X(m).toFixed(1)},${Y(lower[i]!).toFixed(1)}`).reverse().join(' L');
      bands.push({ fill: se.color, d: `M${top} L${bot} Z` });
    }
  }

  const xTicks = useMemo(() => {
    const ticks = [machMin];
    for (let m = Math.ceil(machMin); m <= machMax; m++) ticks.push(m);
    return ticks;
  }, [machMin, machMax]);

  const onMove = (e: React.PointerEvent) => {
    const host = hostRef.current;
    if (!host) return;
    const x = e.clientX - host.getBoundingClientRect().left;
    setHoverM(Math.max(machMin, Math.min(machMax, machMin + ((x - PAD_L) / iw) * span)));
  };

  return (
    <div className="rounded-lg bg-slate-800/40 ring-1 ring-white/10">
      <div className="flex items-center gap-2 px-2 pt-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{title}</span>
        {right && <span className="ml-auto">{right}</span>}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-2 pb-1 pt-1">
        {series.map((se, li) => {
          const val = hoverM != null ? lerpAt(machs, se.values, hoverM) : null;
          return (
            <span key={li} className="inline-flex items-center gap-1 text-[10px] text-slate-300">
              {se.dash
                ? (
                  <svg width="12" height="4" className="shrink-0" aria-hidden>
                    <line x1="0" y1="2" x2="12" y2="2" stroke={se.color} strokeWidth="2" strokeDasharray={se.dash} />
                  </svg>
                )
                : <span className="inline-block h-2 w-2 rounded-sm" style={{ background: se.color }} />}
              {se.name}
              {val != null && <span className="tabular-nums text-slate-400">· {fmtNum(val, digits)}{unit && ` ${unit}`}</span>}
            </span>
          );
        })}
      </div>
      <div ref={hostRef} onPointerMove={onMove} onPointerLeave={() => setHoverM(null)}>
        <svg viewBox={`0 0 ${w} ${CHART_H}`} width="100%" height={CHART_H} className="block">
          {[0, 1, 2].map((i) => {
            const yv = yMin + (yMax - yMin) * (i / 2);
            const gy = Y(yv);
            return (
              <g key={i}>
                <line x1={PAD_L} y1={gy} x2={w - PAD_R} y2={gy} className="stroke-white/10" />
                <text x={PAD_L - 4} y={gy + 3} textAnchor="end" className="fill-slate-500 text-[9px] tabular-nums">{fmtNum(yv, digits)}</text>
              </g>
            );
          })}
          {stacked
            ? bands.map((b, i) => (
                <path key={i} d={b.d} fill={b.fill} fillOpacity={0.85} stroke="#0f172a" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              ))
            : series.map((se, i) => (
                <path key={i} d={linePath(se.values)} fill="none" stroke={se.color} strokeWidth={1.75}
                  strokeDasharray={se.dash} vectorEffect="non-scaling-stroke" />
              ))}
          {xTicks.map((m, i) => (
            <text key={i} x={X(m)} y={CHART_H - 5} textAnchor="middle" className="fill-slate-500 text-[9px] tabular-nums">
              {i === 0 ? `M ${fmtNum(m, 1)}` : fmtNum(m, 0)}
            </text>
          ))}
          {hoverM != null && (
            <line x1={X(hoverM)} y1={PAD_T} x2={X(hoverM)} y2={CHART_H - PAD_B} className="stroke-slate-300/40" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
      </div>
      {note && <p className="px-2 pb-1.5 text-[9px] text-slate-500">{note}</p>}
    </div>
  );
}
