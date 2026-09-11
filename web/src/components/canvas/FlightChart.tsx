import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FlightResult, FlightSeries } from '../../engine/openRocketEngine';
import { fmtNum } from '../../i18n/format';
import { flightDataCsv, downloadCsv } from '../../services/csvExport';
import { lerpAt } from '../../services/interpolate';
import { EVENT_LABEL, clusterEventLabels } from '../../services/simReport';

/**
 * Flight data as SMALL MULTIPLES (mmrocket-style): time on a shared x, and one
 * stacked single-series panel per measure — each with its OWN y-scale, because
 * measures of different magnitude are never dual-axed. A chip bar toggles which
 * panels show; a single hover drives a synchronized crosshair + value readout
 * across every visible panel. All eleven series already ride in on every sim run.
 * The x (time) axis zooms/pans (buttons, drag, ctrl/pinch-wheel); a sticky strip
 * up top row-packs the event labels so they never overlap.
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

// One colour per flight branch (stage): 0 = sustainer (sky, the original single
// line), then boosters. Matches the component-tree palette so a stage reads the
// same colour everywhere. Cycles if a design somehow has more branches.
const STAGE_COLORS = ['#38bdf8', '#fbbf24', '#34d399', '#a78bfa', '#fb7185', '#22d3ee'];

// A flight branch enriched for the chart: its own trajectory + events, a stable
// index and a colour. Single-stage flights collapse to one synthetic branch.
type Branch = {
  index: number;
  name: string;
  color: string;
  events: { type: string; time: number }[];
  series: FlightSeries;
};

// Shared horizontal geometry so the crosshair lines up across panels; the
// scroll host's px-3 (12px) left inset is added back when mapping pointer x.
const PAD_L = 44;
const PAD_R = 12;
const HOST_INSET = 12;
const PANEL_H = 208;
const EVENT_ROW_H = 12; // one row of the event-label strip

type Pt = readonly [number, number];

export function FlightChart({ result }: { result: FlightResult }) {
  const { t } = useTranslation();
  const [on, setOn] = useState<Key[]>(DEFAULT_ON);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);

  // Every flight branch as a coloured, selectable stage. `result.branches` is
  // only present once a staged rocket actually separates (branch 0 mirrors the
  // top-level series); otherwise we wrap the single top-level trajectory so the
  // rest of the component is branch-agnostic.
  const branches = useMemo<Branch[]>(() => {
    const bs = result.branches?.length
      ? result.branches
      : [{ name: '', events: result.events ?? [], series: result.series }];
    return bs.map((b, i) => ({
      index: i,
      name: b.name || `${t('flight.stage')} ${i + 1}`,
      color: STAGE_COLORS[i % STAGE_COLORS.length]!,
      events: b.events ?? [],
      series: b.series,
    }));
  }, [result, t]);
  const multistage = branches.length >= 2;

  // Which stages are overlaid (branch indices). A new flight shows them all;
  // the last selected stage can't be turned off (nothing to plot otherwise).
  const [onStages, setOnStages] = useState<number[]>(() => branches.map((b) => b.index));
  useEffect(() => setOnStages(branches.map((b) => b.index)), [result]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleStage = (i: number) =>
    setOnStages((cur) => (cur.includes(i) ? (cur.length > 1 ? cur.filter((x) => x !== i) : cur) : [...cur, i]));
  // Stable across hover re-renders so the panels don't recompute their paths on
  // every pointer move (the memo below keys on this reference).
  const selectedBranches = useMemo(() => branches.filter((b) => onStages.includes(b.index)), [branches, onStages]);

  // x-axis spans every branch, so a booster that lands after the sustainer still
  // fits (its own descent runs on the same launch clock).
  const allTimes = useMemo(() => branches.flatMap((b) => b.series.time ?? []), [branches]);
  const maxT = Math.max(result.summary.flightTime || 1, ...(allTimes.length ? allTimes : [1]), 1);

  // Visible time window (null = full flight). The x-axis zooms/pans within it.
  const [zoom, setZoom] = useState<{ t0: number; t1: number } | null>(null);
  const t0 = zoom ? zoom.t0 : 0;
  const t1 = zoom ? zoom.t1 : maxT;
  const zoomed = t1 - t0 < maxT - 1e-9;
  const iw = w - PAD_L - PAD_R;
  const X = (tt: number) => PAD_L + ((tt - t0) / (t1 - t0)) * iw;
  const invX = (px: number) => t0 + ((px - PAD_L) / iw) * (t1 - t0);

  // A new flight resets the view; keep it in sync when the flight time changes.
  useEffect(() => setZoom(null), [result]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setW(Math.max(280, entries[0]!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const clampWin = (a: number, b: number): { t0: number; t1: number } | null => {
    const minW = Math.max(maxT / 500, 0.05);
    const width = Math.min(Math.max(b - a, minW), maxT);
    if (width >= maxT - 1e-9) return null; // fully zoomed out → no window
    const lo = Math.min(Math.max(a, 0), maxT - width);
    return { t0: lo, t1: lo + width };
  };
  // Zoom by `factor` (<1 = in), keeping `anchorT` under the same screen x.
  const zoomAt = (factor: number, anchorT: number) => {
    const nw = (t1 - t0) * factor;
    const na0 = anchorT - (anchorT - t0) * factor;
    setZoom(clampWin(na0, na0 + nw));
  };
  const centerT = () => hoverT ?? (t0 + t1) / 2;

  // Ctrl/pinch-wheel zooms about the cursor (plain wheel still scrolls the
  // panel list). Native non-passive listener so we can preventDefault.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const px = e.clientX - el.getBoundingClientRect().left - HOST_INSET;
      zoomAt(e.deltaY > 0 ? 1.2 : 1 / 1.2, invX(px));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [t0, t1, maxT, iw]); // eslint-disable-line react-hooks/exhaustive-deps

  // Events of every shown stage (a spent booster carries its own apogee, deploy
  // and ground-hit). De-selecting a stage drops its markers too.
  const events = useMemo(
    () => selectedBranches.flatMap((b) => b.events).filter((e) => EVENT_LABEL[e.type] && e.time <= maxT),
    [selectedBranches, maxT],
  );

  // Boost→apogee window: aero series (CP / stability) are only meaningful until
  // the rocket stops flying forward (recovery deploy, else apogee).
  const clipT = useMemo(() => {
    const at = (type: string) => result.events?.find((e) => e.type === type)?.time;
    return (
      at('RECOVERY_DEVICE_DEPLOYMENT') ?? at('EJECTION_CHARGE') ?? at('APOGEE') ?? result.summary.timeToApogee ?? maxT
    );
  }, [result, maxT]);

  // Cluster near-coincident event labels (a recovery deployment always keeps its
  // own marker), drop any outside the visible window, then GREEDILY row-pack so
  // labels never overlap: each takes the lowest row whose last label has cleared.
  const eventLabels = useMemo(() => {
    const labelW = (type: string) => t(EVENT_LABEL[type] ?? type).length * 5.2 + 10;
    const rowRight: number[] = [];
    return clusterEventLabels(events, X)
      .filter((g) => g.x >= PAD_L - 2 && g.x <= w - PAD_R + 2)
      .map((g) => {
        const half = labelW(g.type) / 2;
        let row = 0;
        while (row < rowRight.length && rowRight[row]! > g.x - half) row++;
        rowRight[row] = g.x + half;
        return { x: g.x, type: g.type, row };
      });
  }, [events, w, t0, t1, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const eventRows = eventLabels.reduce((m, l) => Math.max(m, l.row + 1), 0);
  const stripH = eventRows ? eventRows * EVENT_ROW_H + 4 : 0;

  const toggle = (k: Key) => setOn((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  const activeMetas = SERIES.filter((m) => on.includes(m.key));

  // Pointer: drag pans (only when zoomed in); otherwise it drives the hover crosshair.
  const drag = useRef<{ x: number; t0: number; t1: number } | null>(null);
  const localX = (clientX: number) => {
    const host = hostRef.current;
    return host ? clientX - host.getBoundingClientRect().left - HOST_INSET : 0;
  };
  const onDown = (e: React.PointerEvent) => {
    if (!zoomed) return; // nothing to pan at full view — keep hover behaviour
    drag.current = { x: e.clientX, t0, t1 };
    hostRef.current?.setPointerCapture?.(e.pointerId);
    setHoverT(null);
  };
  const onMove = (e: React.PointerEvent) => {
    if (drag.current) {
      const span = drag.current.t1 - drag.current.t0;
      const dt = ((e.clientX - drag.current.x) / iw) * span;
      setZoom(clampWin(drag.current.t0 - dt, drag.current.t1 - dt));
      return;
    }
    setHoverT(Math.max(t0, Math.min(t1, invX(localX(e.clientX)))));
  };
  const endDrag = (e: React.PointerEvent) => {
    if (drag.current) {
      drag.current = null;
      hostRef.current?.releasePointerCapture?.(e.pointerId);
    }
  };

  const zBtn = 'rounded-md bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700 disabled:opacity-40';

  return (
    <div className="flex h-full flex-col rounded-xl bg-slate-900 ring-1 ring-white/10">
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('flight.title')}</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-slate-400">
            {t('flight.time')} {fmtNum(hoverT ?? maxT, hoverT != null ? 2 : 1)} s
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => zoomAt(1 / 0.6, centerT())} disabled={!zoomed} title={t('flight.zoomOut')} aria-label={t('flight.zoomOut')} className={zBtn}>
              −
            </button>
            <button onClick={() => zoomAt(0.6, centerT())} title={t('flight.zoomIn')} aria-label={t('flight.zoomIn')} className={zBtn}>
              +
            </button>
            <button onClick={() => setZoom(null)} disabled={!zoomed} title={t('flight.zoomReset')} aria-label={t('flight.zoomReset')} className={zBtn}>
              ⤢
            </button>
          </div>
          <button
            onClick={() => downloadCsv('flight-data.csv', flightDataCsv(result))}
            title={t('flight.exportCsv')}
            className="rounded-md bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
          >
            ⬇ CSV
          </button>
        </div>
      </div>
      {multistage && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2">
          <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {t('flight.stages')}
          </span>
          {branches.map((b) => {
            const active = onStages.includes(b.index);
            return (
              <button
                key={b.index}
                onClick={() => toggleStage(b.index)}
                aria-pressed={active}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${active ? 'bg-slate-700 text-slate-100 ring-white/20' : 'bg-slate-800 text-slate-400 ring-white/10'}`}
              >
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: b.color, opacity: active ? 1 : 0.4 }}
                />
                {b.name}
              </button>
            );
          })}
        </div>
      )}
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
        className={`min-h-0 flex-1 overflow-y-auto px-3 pb-3 ${zoomed ? 'cursor-grab' : ''}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => {
          if (!drag.current) setHoverT(null);
        }}
      >
        {activeMetas.length === 0 ? (
          <p className="grid h-full place-items-center text-sm text-slate-500">{t('flight.pickSeries')}</p>
        ) : (
          <>
            {stripH > 0 && (
              <svg
                viewBox={`0 0 ${w} ${stripH}`}
                width="100%"
                height={stripH}
                preserveAspectRatio="none"
                className="sticky top-0 z-10 block bg-slate-900"
              >
                {eventLabels.map((l, i) => (
                  <g key={i}>
                    <line x1={l.x} y1={l.row * EVENT_ROW_H + EVENT_ROW_H - 2} x2={l.x} y2={stripH} className="stroke-amber-400/30" vectorEffect="non-scaling-stroke" />
                    <text x={l.x} y={l.row * EVENT_ROW_H + 9} textAnchor="middle" className="fill-amber-400/90 text-[9px]">
                      {t(EVENT_LABEL[l.type] ?? l.type)}
                    </text>
                  </g>
                ))}
              </svg>
            )}
            {activeMetas.map((m) => (
              <Panel
                key={m.key}
                meta={m}
                branches={selectedBranches}
                w={w}
                X={X}
                hoverT={hoverT}
                clipT={clipT}
                events={events}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function Panel({
  meta,
  branches,
  w,
  X,
  hoverT,
  clipT,
  events,
}: {
  meta: Meta;
  branches: Branch[];
  w: number;
  X: (t: number) => number;
  hoverT: number | null;
  clipT: number;
  events: { type: string; time: number }[];
}) {
  const { t } = useTranslation();
  const padT = 8;
  const padB = 8;
  const ih = PANEL_H - padT - padB;
  const scale = meta.scale ?? 1;
  const clipId = `fc-clip-${meta.key}`;
  const single = branches.length === 1;

  // One line per selected stage; the y-domain spans them all so they share a
  // scale and read against each other. Keyed on the (stable) branch list so a
  // hover doesn't rebuild every stage's path.
  const { list, lo, hi } = useMemo(() => {
    let dMin = Infinity;
    let dMax = -Infinity;
    const out = branches.map((b) => {
      const time = b.series.time ?? [];
      const raw = (b.series[meta.key] ?? []) as (number | null)[];
      const p: Pt[] = [];
      const xa: number[] = [];
      const ya: number[] = [];
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
      return { color: b.color, name: b.name, pts: p, xs: xa, ys: ya, t0: xa[0], t1: xa[xa.length - 1] };
    });
    if (!(dMin < Infinity)) {
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
    return { list: out, lo: l, hi: h === l ? l + 1 : h };
  }, [branches, meta.key, meta.level, meta.aero, scale, clipT]);

  const Y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * ih;
  const mkLine = (pts: Pt[]) =>
    pts.length >= 2 ? pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ') : '';
  const baseY = Y(Math.max(lo, 0));
  const zeroInRange = lo < 0 && hi > 0;

  // Header: the hovered value of the primary (first / sustainer) stage, else the
  // peak-magnitude sample across every shown stage.
  const primary = list[0];
  const hvPrimary = primary && hoverT != null ? lerpAt(primary.xs, primary.ys, hoverT) : null;
  const peak = list.reduce((acc, s) => {
    let m = acc;
    for (const y of s.ys) if (Math.abs(y) > Math.abs(m)) m = y;
    return m;
  }, 0);
  const shown = hvPrimary ?? peak;
  // A stage only reports a hovered value while its own flight is under way — a
  // spent booster already on the ground must not show a flat clamped dot.
  const hoverVal = (s: (typeof list)[number]) =>
    hoverT != null && s.t0 != null && s.t1 != null && hoverT >= s.t0 && hoverT <= s.t1
      ? lerpAt(s.xs, s.ys, hoverT)
      : null;

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
          {/* Filled area only for a lone line (single stage) — coloured to match
              it; overlaid stages would muddy each other, so they're lines only. */}
          {single && (
            <linearGradient id={`fc-${meta.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={primary?.color ?? '#38bdf8'} stopOpacity="0.25" />
              <stop offset="100%" stopColor={primary?.color ?? '#38bdf8'} stopOpacity="0" />
            </linearGradient>
          )}
          {/* Clip everything time-mapped to the plot area, so zoomed-out-of-window
              points don't spill over the y-axis labels / panel edges. */}
          <clipPath id={clipId}>
            <rect x={PAD_L} y={0} width={Math.max(0, w - PAD_L - PAD_R)} height={PANEL_H} />
          </clipPath>
        </defs>
        {zeroInRange && <line x1={PAD_L} y1={Y(0)} x2={w - PAD_R} y2={Y(0)} className="stroke-white/15" />}
        <g clipPath={`url(#${clipId})`}>
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
          {single && !meta.level && primary && primary.pts.length >= 2 && (
            <path
              d={`M${X(primary.pts[0]![0]).toFixed(1)},${baseY.toFixed(1)} ${primary.pts.map((p) => `L${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')} L${X(primary.pts[primary.pts.length - 1]![0]).toFixed(1)},${baseY.toFixed(1)} Z`}
              fill={`url(#fc-${meta.key})`}
            />
          )}
          {list.map((s, i) => {
            const d = mkLine(s.pts);
            return d ? (
              <path key={i} d={d} fill="none" stroke={s.color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
            ) : null;
          })}
          {hoverT != null && (
            <g pointerEvents="none">
              <line
                x1={X(hoverT)}
                y1={padT}
                x2={X(hoverT)}
                y2={PANEL_H - padB}
                className="stroke-slate-300/40"
                vectorEffect="non-scaling-stroke"
              />
              {list.map((s, i) => {
                const hv = hoverVal(s);
                if (hv == null) return null;
                return (
                  <g key={i}>
                    <circle cx={X(hoverT)} cy={Y(hv)} r={3} fill={s.color} />
                    {!single && (
                      <text x={X(hoverT) + 5} y={Y(hv) - 3} className="text-[9px] tabular-nums" fill={s.color}>
                        {fmtNum(hv, meta.digits)}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          )}
        </g>
        <text x={PAD_L - 4} y={padT + 7} textAnchor="end" className="fill-slate-500 text-[9px] tabular-nums">
          {fmtNum(hi, meta.digits)}
        </text>
        <text x={PAD_L - 4} y={PANEL_H - padB} textAnchor="end" className="fill-slate-500 text-[9px] tabular-nums">
          {fmtNum(lo, meta.digits)}
        </text>
      </svg>
    </div>
  );
}
