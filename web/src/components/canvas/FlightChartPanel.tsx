import { useCallback, useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtNum } from '../../i18n/format';
import { useUnits } from '../../prefs/useUnits';
import { lerpAt } from '../../services/interpolate';
import { PAD_L, PAD_R, PANEL_H } from './flightChartAxis';
import type { Branch, Meta } from './flightChartTraces';
import { PanelHover } from './FlightChartHover';

/**
 * Owns one small-multiple panel of the flight chart: the sample extraction
 * and y-domain for a series across the shown stages, the path strings, the
 * header value, and the SVG with its axis labels, event ticks, area fill and
 * lines. The hover readout inside it is FlightChartHover.
 */

type Pt = readonly [number, number];

export function FlightChartPanel({
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
  const u = useUnits();
  const padT = 8;
  const padB = 8;
  const ih = PANEL_H - padT - padB;
  // A quantity-backed series scales and labels itself from the preference; the
  // rest keep their fixed unit. `factor`, not `toUi`, because this scales a
  // whole series — none of these carry a temperature-style offset.
  const scale = meta.quantity ? u.factor(meta.quantity) : (meta.scale ?? 1);
  const unit = meta.quantity ? u.sym(meta.quantity) : meta.unit;
  // Namespaced ids. These were document-global (`fc-clip-altitude`), so two
  // charts in one document - a comparison view, or the mobile and desktop
  // copies during a breakpoint transition - made `url(#fc-clip-altitude)`
  // resolve to whichever rendered first, clipping one chart's panels to the
  // other's width. TreeSchematic already uses useId() for exactly this hazard.
  const uid = useId();
  const clipId = `${uid}-clip-${meta.key}`;
  const single = branches.length === 1;

  // One line per selected stage; the y-domain spans them all so they share a
  // scale and read against each other. Keyed on the (stable) branch list so a
  // hover doesn't rebuild every stage's path.
  const { list, lo, hi } = useMemo(() => {
    let dMin = Infinity;
    let dMax = -Infinity;
    // A plain loop: the domain scan writes dMin/dMax, and doing that from
    // inside a `.map` callback hid a side effect in what reads as a pure
    // transform.
    const out: { color: string; name: string; pts: Pt[]; xs: number[]; ys: number[]; t0?: number; t1?: number }[] = [];
    for (const b of branches) {
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
      out.push({ color: b.color, name: b.name, pts: p, xs: xa, ys: ya, t0: xa[0], t1: xa[xa.length - 1] });
    }
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

  // A fixed decimal count belongs to a fixed unit: "0 dp" is right for meters
  // of altitude and wrong for kilometers. For a quantity-backed series the
  // count comes from the span actually on screen instead.
  const digits = meta.quantity
    ? (() => {
        const span = Math.abs(hi - lo);
        return span >= 100 ? 0 : span >= 10 ? 1 : span >= 1 ? 2 : 3;
      })()
    : meta.digits;

  const Y = useCallback((v: number) => padT + (1 - (v - lo) / (hi - lo)) * ih, [lo, hi, ih]);
  const mkLine = useCallback(
    (pts: Pt[]) =>
      pts.length >= 2 ? pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ') : '',
    [X, Y],
  );

  /**
   * The path strings and the peak scan — the expensive half.
   *
   * The memo above deliberately caches the sample EXTRACTION, but `mkLine` (a
   * toFixed pair and a string per sample) and this reduce over every `ys` sat
   * outside it, in the render body. `hoverT` is state here and a prop of this
   * component, so every pixel of hover rebuilt all of it for all three default
   * panels — at the six-figure sample counts `maxFlightTime`'s own docblock
   * describes, that is a six-figure-segment string per panel per pointer move.
   */
  const { paths, areaPath, peak } = useMemo(() => {
    const first = list[0];
    return {
      paths: list.map((sr) => mkLine(sr.pts)),
      areaPath:
        first && first.pts.length >= 2
          ? `M${X(first.pts[0]![0]).toFixed(1)},${Y(Math.max(lo, 0)).toFixed(1)} ` +
            first.pts.map((p) => `L${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ') +
            ` L${X(first.pts[first.pts.length - 1]![0]).toFixed(1)},${Y(Math.max(lo, 0)).toFixed(1)} Z`
          : '',
      peak: list.reduce((acc, sr) => {
        let m = acc;
        for (const y of sr.ys) if (Math.abs(y) > Math.abs(m)) m = y;
        return m;
      }, 0),
    };
  }, [list, mkLine, X, Y, lo]);

  const zeroInRange = lo < 0 && hi > 0;

  // Header: the hovered value of the primary (first / sustainer) stage, else the
  // peak-magnitude sample across every shown stage.
  const primary = list[0];
  const hvPrimary = primary && hoverT != null ? lerpAt(primary.xs, primary.ys, hoverT) : null;
  const shown = hvPrimary ?? peak;

  return (
    <div className="mb-2 rounded-lg bg-slate-800/40 ring-1 ring-white/10">
      <div className="flex items-baseline justify-between px-2 pt-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{t(meta.label)}</span>
        <span className="text-xs font-semibold tabular-nums text-slate-100">
          {fmtNum(shown, digits)}
          {unit && <span className="ml-0.5 text-[10px] text-slate-500">{unit}</span>}
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${PANEL_H}`} width="100%" height={PANEL_H} preserveAspectRatio="none" className="block">
        <defs>
          {/* Filled area only for a lone line (single stage) — colored to match
              it; overlaid stages would muddy each other, so they're lines only. */}
          {single && (
            <linearGradient id={`${uid}-${meta.key}`} x1="0" y1="0" x2="0" y2="1">
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
          {single && !meta.level && areaPath && <path d={areaPath} fill={`url(#${uid}-${meta.key})`} />}
          {list.map((s, i) =>
            paths[i] ? (
              <path
                key={i}
                d={paths[i]}
                fill="none"
                stroke={s.color}
                strokeWidth={1.75}
                vectorEffect="non-scaling-stroke"
              />
            ) : null,
          )}
          {hoverT != null && (
            <PanelHover
              hoverT={hoverT}
              list={list}
              X={X}
              Y={Y}
              top={padT}
              bottom={PANEL_H - padB}
              single={single}
              digits={digits}
            />
          )}
        </g>
        <text x={PAD_L - 4} y={padT + 7} textAnchor="end" className="fill-slate-500 text-[9px] tabular-nums">
          {fmtNum(hi, digits)}
        </text>
        <text x={PAD_L - 4} y={PANEL_H - padB} textAnchor="end" className="fill-slate-500 text-[9px] tabular-nums">
          {fmtNum(lo, digits)}
        </text>
      </svg>
    </div>
  );
}
