import { useCallback, useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtNum, ladderDigits } from '../../i18n/format';
import { useUnits } from '../../prefs/useUnits';
import { lerpAt } from '../../services/flight/interpolate';
import { PAD_L, PAD_R, PANEL_H } from './flightChartAxis';
import { traceScale, traceUnit, type Branch, type Meta } from './flightChartTraces';
import { PanelHover } from './FlightChartHover';
import { polylinePath } from '../common/svgPath';
import { PanelExpandButton } from './PanelExpandButton';
import { token } from '../common/colorTokens';
import { timeSeriesSummary } from './chartSummary';

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
  height = PANEL_H,
  expanded = false,
  onToggleExpand,
}: {
  meta: Meta;
  branches: Branch[];
  w: number;
  X: (t: number) => number;
  hoverT: number | null;
  clipT: number;
  events: { type: string; time: number }[];
  /** The panel's plot height; the pane's whole height when it is the expanded one. */
  height?: number;
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  const padT = 8;
  const padB = 8;
  const ih = height - padT - padB;
  // A quantity-backed series scales and labels itself from the preference; the
  // rest keep their fixed unit. `factor`, not `toUi`, because this scales a
  // whole series; none of these carry a temperature-style offset.
  const scale = traceScale(meta, u);
  const unit = traceUnit(meta, u);
  // Namespaced ids. With a fixed id, two charts in one document (a comparison
  // view, or the mobile and desktop copies during a breakpoint transition)
  // would make `url(#...)` resolve to whichever rendered first, clipping one
  // chart's panels to the other's width. TreeSchematic uses useId() for the
  // same hazard.
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
      const raw = b.series[meta.key] ?? [];
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
  const digits = meta.quantity ? ladderDigits(Math.abs(hi - lo)) : meta.digits;

  const Y = useCallback((v: number) => padT + (1 - (v - lo) / (hi - lo)) * ih, [lo, hi, ih]);
  const mkLine = useCallback(
    (pts: Pt[]) =>
      pts.length >= 2
        ? polylinePath(
            pts.map((p) => [X(p[0]), Y(p[1])]),
            'comma',
          )
        : '',
    [X, Y],
  );

  /**
   * The path strings and the peak scan: the expensive half.
   *
   * The memo above caches the sample extraction; this one caches `mkLine` (a
   * toFixed pair and a string per sample) and the reduce over every `ys`.
   * `hoverT` is a prop of this component, so in the render body all of it
   * would be rebuilt for every panel on every pointer move, and at the
   * six-figure sample counts `maxFlightTime`'s docblock describes that is a
   * six-figure-segment string per panel per move.
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

  // What a screen reader hears for this panel: its peak and when, or the span a
  // level series covers, per shown stage (see chartSummary).
  const summary = useMemo(
    () => timeSeriesSummary(t, t(meta.label), unit, digits, !!meta.level, list),
    [t, meta.label, meta.level, unit, digits, list],
  );

  // Header: the hovered value of the primary (first / sustainer) stage, else the
  // peak-magnitude sample across every shown stage.
  const primary = list[0];
  const hvPrimary = primary && hoverT != null ? lerpAt(primary.xs, primary.ys, hoverT) : null;
  const shown = hvPrimary ?? peak;

  return (
    <div className="mb-2 rounded-lg bg-raised/40 ring-1 ring-line/10">
      <div className="flex items-baseline justify-between px-2 pt-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{t(meta.label)}</span>
        <span className="flex items-baseline gap-2">
          <span className="text-xs font-semibold tabular-nums text-ink-strong">
            {fmtNum(shown, digits)}
            {unit && <span className="ml-0.5 text-[10px] text-ink-faint">{unit}</span>}
          </span>
          {onToggleExpand && <PanelExpandButton expanded={expanded} onClick={onToggleExpand} />}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${w} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        className="block"
        role="img"
        aria-label={summary}
      >
        <defs>
          {/* Filled area only for a lone line (single stage), colored to match
              it; overlaid stages would muddy each other, so they're lines only. */}
          {single && (
            <linearGradient id={`${uid}-${meta.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={primary?.color ?? token('series-1')} stopOpacity="0.25" />
              <stop offset="100%" stopColor={primary?.color ?? token('series-1')} stopOpacity="0" />
            </linearGradient>
          )}
          {/* Clip everything time-mapped to the plot area, so zoomed-out-of-window
              points don't spill over the y-axis labels / panel edges. */}
          <clipPath id={clipId}>
            <rect x={PAD_L} y={0} width={Math.max(0, w - PAD_L - PAD_R)} height={height} />
          </clipPath>
        </defs>
        {zeroInRange && <line x1={PAD_L} y1={Y(0)} x2={w - PAD_R} y2={Y(0)} className="stroke-line/15" />}
        <g clipPath={`url(#${clipId})`}>
          {events.map((e, i) => (
            <line
              key={i}
              x1={X(e.time)}
              y1={padT}
              x2={X(e.time)}
              y2={height - padB}
              className="stroke-warn-400/25"
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
              bottom={height - padB}
              single={single}
              digits={digits}
            />
          )}
        </g>
        <text x={PAD_L - 4} y={padT + 7} textAnchor="end" className="fill-ink-faint text-[9px] tabular-nums">
          {fmtNum(hi, digits)}
        </text>
        <text x={PAD_L - 4} y={height - padB} textAnchor="end" className="fill-ink-faint text-[9px] tabular-nums">
          {fmtNum(lo, digits)}
        </text>
      </svg>
    </div>
  );
}
