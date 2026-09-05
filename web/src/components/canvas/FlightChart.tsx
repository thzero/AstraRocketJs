import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FlightResult } from '../../engine/openRocketEngine';
import { fmtNum } from '../../i18n/format';
import { flightDataCsv, downloadCsv } from '../../services/csvExport';
import { lerpAt } from '../../services/interpolate';
import { EVENT_LABEL, EVENT_PRIORITY } from '../../services/simReport';

/**
 * Flight data as SMALL MULTIPLES (mmrocket-style): time on a shared x, and one
 * stacked single-series panel per measure — each with its OWN y-scale, because
 * measures of different magnitude are never dual-axed. A chip bar toggles which
 * panels show; a single hover drives a synchronized crosshair + value readout
 * across every visible panel. All eleven series already ride in on every sim run.
 */
type Key =
  | 'altitude'
  | 'velocity'
  | 'acceleration'
  | 'mach'
  | 'thrust'
  | 'drag'
  | 'mass'
  | 'stability'
  | 'cpLocation'
  | 'cgLocation'
  | 'aoa';

interface Meta {
  key: Key;
  label: string;
  unit: string;
  digits: number;
  /** Multiply the raw SI series into display units (kg→g, m→cm, rad→deg). */
  scale?: number;
  /** Level bands (CG/CP/mass/stability) get a tight y-domain + no area fill;
   *  flow series (altitude/velocity/…) get a zero baseline + filled area. */
  level?: boolean;
  /** Aero-derived (CP / stability): only meaningful while flying forward — after
   *  recovery deploys the rocket tumbles (AoA≈90°) and these collapse to junk, so
   *  the series is clipped to the boost→apogee window. */
  aero?: boolean;
}

const SERIES: Meta[] = [
  { key: 'altitude', label: 'flight.altitude', unit: 'm', digits: 0 },
  { key: 'velocity', label: 'flight.velocity', unit: 'm/s', digits: 0 },
  { key: 'acceleration', label: 'flight.acceleration', unit: 'm/s²', digits: 0 },
  { key: 'mach', label: 'flight.mach', unit: '', digits: 2 },
  { key: 'thrust', label: 'flight.thrust', unit: 'N', digits: 1 },
  { key: 'drag', label: 'flight.drag', unit: 'N', digits: 2 },
  { key: 'mass', label: 'flight.mass', unit: 'g', digits: 0, scale: 1000, level: true },
  { key: 'stability', label: 'flight.stability', unit: 'cal', digits: 2, level: true, aero: true },
  { key: 'cpLocation', label: 'flight.cp', unit: 'cm', digits: 1, scale: 100, level: true, aero: true },
  { key: 'cgLocation', label: 'flight.cg', unit: 'cm', digits: 1, scale: 100, level: true },
  { key: 'aoa', label: 'flight.aoa', unit: '°', digits: 1, scale: 180 / Math.PI },
];
const DEFAULT_ON: Key[] = ['altitude', 'velocity', 'acceleration'];

// Shared horizontal geometry so the crosshair lines up across panels; the
// scroll host's px-3 (12px) left inset is added back when mapping pointer x.
const PAD_L = 44;
const PAD_R = 12;
const HOST_INSET = 12;
const PANEL_H = 104;

type Pt = readonly [number, number];

export function FlightChart({ result }: { result: FlightResult }) {
  const { t } = useTranslation();
  const [on, setOn] = useState<Key[]>(DEFAULT_ON);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setW(Math.max(280, entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const time = result.series.time ?? [];
  const maxT = Math.max(result.summary.flightTime || 1, ...(time.length ? time : [1]), 1);
  const iw = w - PAD_L - PAD_R;
  const X = (tt: number) => PAD_L + (tt / maxT) * iw;

  const events = useMemo(
    () => (result.events ?? []).filter((e) => EVENT_LABEL[e.type] && e.time <= maxT),
    [result, maxT],
  );

  // Boost→apogee window: aero series (CP / stability) are only meaningful until
  // the rocket stops flying forward (recovery deploy, else apogee).
  const clipT = useMemo(() => {
    const at = (type: string) => result.events?.find((e) => e.type === type)?.time;
    return (
      at('RECOVERY_DEVICE_DEPLOYMENT') ?? at('EJECTION_CHARGE') ?? at('APOGEE') ?? result.summary.timeToApogee ?? maxT
    );
  }, [result, maxT]);

  // Cluster near-coincident events (small rockets fire burnout→apogee→deploy in
  // ~a second), keep each cluster's most significant, and stagger labels. Drawn
  // only on the top panel; the dashed lines repeat in every panel.
  const eventLabels = useMemo(() => {
    const groups: { x: number; type: string }[] = [];
    for (const e of [...events].sort((a, b) => a.time - b.time)) {
      const x = X(e.time);
      const last = groups[groups.length - 1];
      if (last && x - last.x < 20) {
        if (EVENT_PRIORITY.indexOf(e.type) < EVENT_PRIORITY.indexOf(last.type)) last.type = e.type;
      } else groups.push({ x, type: e.type });
    }
    let lastGx = -Infinity;
    let grow = 0;
    return groups.map((g) => {
      grow = g.x - lastGx < 60 ? (grow === 0 ? 1 : 0) : 0;
      lastGx = g.x;
      return { x: g.x, type: g.type, ly: 8 + grow * 9 };
    });
  }, [events, w, maxT]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (k: Key) => setOn((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  const activeMetas = SERIES.filter((m) => on.includes(m.key));

  const onMove = (e: React.PointerEvent) => {
    const host = hostRef.current;
    if (!host) return;
    const x = e.clientX - host.getBoundingClientRect().left - HOST_INSET;
    setHoverT(Math.max(0, Math.min(maxT, ((x - PAD_L) / iw) * maxT)));
  };

  return (
    <div className="flex h-full flex-col rounded-xl bg-slate-900 ring-1 ring-white/10">
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('flight.title')}</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-slate-400">
            {t('flight.time')} {fmtNum(hoverT ?? maxT, hoverT != null ? 2 : 1)} s
          </span>
          <button
            onClick={() => downloadCsv('flight-data.csv', flightDataCsv(result))}
            title={t('flight.exportCsv')}
            className="rounded-md bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
          >
            ⬇ CSV
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 px-3 py-2">
        {SERIES.map((m) => {
          const active = on.includes(m.key);
          return (
            <button
              key={m.key}
              onClick={() => toggle(m.key)}
              aria-pressed={active}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${active ? 'bg-sky-600 text-white ring-sky-500' : 'bg-slate-800 text-slate-300 ring-white/10'}`}
            >
              {t(m.label)}
            </button>
          );
        })}
      </div>
      <div
        ref={hostRef}
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
        onPointerMove={onMove}
        onPointerLeave={() => setHoverT(null)}
      >
        {activeMetas.length === 0 ? (
          <p className="grid h-full place-items-center text-sm text-slate-500">{t('flight.pickSeries')}</p>
        ) : (
          activeMetas.map((m, i) => (
            <Panel
              key={m.key}
              meta={m}
              result={result}
              w={w}
              X={X}
              hoverT={hoverT}
              clipT={clipT}
              events={events}
              labels={i === 0 ? eventLabels : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}

function Panel({
  meta,
  result,
  w,
  X,
  hoverT,
  clipT,
  events,
  labels,
}: {
  meta: Meta;
  result: FlightResult;
  w: number;
  X: (t: number) => number;
  hoverT: number | null;
  clipT: number;
  events: { type: string; time: number }[];
  labels?: { x: number; ly: number; type: string }[];
}) {
  const { t } = useTranslation();
  const padT = 8;
  const padB = 8;
  const ih = PANEL_H - padT - padB;
  const scale = meta.scale ?? 1;

  const { pts, xs, ys, lo, hi } = useMemo(() => {
    const time = result.series.time ?? [];
    const raw = (result.series[meta.key] ?? []) as (number | null)[];
    const p: Pt[] = [];
    const xa: number[] = [];
    const ya: number[] = [];
    let dMin = Infinity;
    let dMax = -Infinity;
    for (let i = 0; i < time.length; i++) {
      const ti = time[i];
      const v = raw[i];
      if (ti == null || v == null || !Number.isFinite(ti) || !Number.isFinite(v)) continue;
      if (meta.aero && ti > clipT) continue;
      const y = v * scale;
      p.push([ti, y] as const);
      xa.push(ti);
      ya.push(y);
      if (y < dMin) dMin = y;
      if (y > dMax) dMax = y;
    }
    if (!p.length) {
      dMin = 0;
      dMax = 1;
    }
    let l: number;
    let h: number;
    if (meta.level) {
      const r = dMax - dMin || Math.abs(dMax) || 1;
      l = dMin - r * 0.1;
      h = dMax + r * 0.1;
    } else {
      l = Math.min(0, dMin);
      h = dMax + (dMax - l || 1) * 0.08;
    }
    return { pts: p, xs: xa, ys: ya, lo: l, hi: h === l ? l + 1 : h };
  }, [result, meta.key, meta.level, meta.aero, scale, clipT]);

  const Y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * ih;
  const path = (cmd: (p: Pt, i: number) => string) => pts.map(cmd).join(' ');
  const line = pts.length >= 2 ? path((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`) : '';
  const baseY = Y(Math.max(lo, 0));
  const area =
    !meta.level && pts.length >= 2
      ? `M${X(pts[0]![0]).toFixed(1)},${baseY.toFixed(1)} ${path((p) => `L${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`)} L${X(pts[pts.length - 1]![0]).toFixed(1)},${baseY.toFixed(1)} Z`
      : '';

  const hv = hoverT != null ? lerpAt(xs, ys, hoverT) : null;
  // Header reads the hovered value, else the peak-magnitude value.
  const shown = hv ?? (pts.length ? pts.reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a))[1] : 0);
  const zeroInRange = lo < 0 && hi > 0;

  return (
    <div className="mb-2 rounded-lg bg-slate-800/40 ring-1 ring-white/10">
      <div className="flex items-baseline justify-between px-2 pt-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{t(meta.label)}</span>
        <span className="text-xs font-semibold tabular-nums text-slate-100">
          {fmtNum(shown, meta.digits)}
          {meta.unit && <span className="ml-0.5 text-[10px] text-slate-500">{meta.unit}</span>}
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${PANEL_H}`} width="100%" height={PANEL_H} preserveAspectRatio="none" className="block">
        <defs>
          <linearGradient id={`fc-${meta.key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
          </linearGradient>
        </defs>
        {zeroInRange && <line x1={PAD_L} y1={Y(0)} x2={w - PAD_R} y2={Y(0)} className="stroke-white/15" />}
        {events.map((e, i) => (
          <line
            key={i}
            x1={X(e.time)}
            y1={padT}
            x2={X(e.time)}
            y2={PANEL_H - padB}
            className="stroke-amber-400/25"
            strokeDasharray="3 2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {labels?.map((l, i) => (
          <text key={i} x={l.x} y={l.ly} textAnchor="middle" className="fill-amber-400/80 text-[9px]">
            {t(EVENT_LABEL[l.type])}
          </text>
        ))}
        {area && <path d={area} fill={`url(#fc-${meta.key})`} />}
        {line && (
          <path d={line} className="fill-none stroke-sky-400" strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
        )}
        <text x={PAD_L - 4} y={padT + 7} textAnchor="end" className="fill-slate-500 text-[9px] tabular-nums">
          {fmtNum(hi, meta.digits)}
        </text>
        <text x={PAD_L - 4} y={PANEL_H - padB} textAnchor="end" className="fill-slate-500 text-[9px] tabular-nums">
          {fmtNum(lo, meta.digits)}
        </text>
        {hoverT != null && hv != null && (
          <g pointerEvents="none">
            <line
              x1={X(hoverT)}
              y1={padT}
              x2={X(hoverT)}
              y2={PANEL_H - padB}
              className="stroke-slate-300/40"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={X(hoverT)} cy={Y(hv)} r={3} className="fill-sky-300" />
          </g>
        )}
      </svg>
    </div>
  );
}
