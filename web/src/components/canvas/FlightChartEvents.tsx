import { EVENT_LABEL } from '../../services/simReport';
import { EVENT_ROW_H, PAD_L, PAD_R } from './flightChartAxis';

/**
 * Owns the event-label strip above the panels: the pure row packing that
 * keeps labels from overlapping, the strip height rule, and the sticky SVG
 * that draws them. The clustering of near-coincident events is the shared
 * `clusterEventLabels` in services/simReport; this starts from its output.
 */

export interface EventLabel {
  x: number;
  type: string;
  row: number;
}

/**
 * Drop clusters outside the visible plot, then GREEDILY row-pack so labels
 * never overlap: each takes the lowest row whose last label has cleared.
 *
 * @param labelW pixel width of a label for an event type (translated text).
 */
export function packEventLabels(
  clusters: { x: number; type: string }[],
  w: number,
  labelW: (type: string) => number,
): EventLabel[] {
  const rowRight: number[] = [];
  return clusters
    .filter((g) => g.x >= PAD_L - 2 && g.x <= w - PAD_R + 2)
    .map((g) => {
      const half = labelW(g.type) / 2;
      let row = 0;
      while (row < rowRight.length && rowRight[row]! > g.x - half) row++;
      rowRight[row] = g.x + half;
      return { x: g.x, type: g.type, row };
    });
}

/** Strip height for a packed label set: rows plus a hair of padding, 0 when
 *  there is nothing to show (so the strip does not render at all). */
export function eventStripHeight(labels: EventLabel[]): number {
  const rows = labels.reduce((m, l) => Math.max(m, l.row + 1), 0);
  return rows ? rows * EVENT_ROW_H + 4 : 0;
}

/** The sticky strip itself; `t` translates the event type's label key. */
export function EventLabelStrip({
  labels,
  w,
  stripH,
  t,
}: {
  labels: EventLabel[];
  w: number;
  stripH: number;
  t: (key: string) => string;
}) {
  return (
    <svg
      viewBox={`0 0 ${w} ${stripH}`}
      width="100%"
      height={stripH}
      preserveAspectRatio="none"
      className="sticky top-0 z-10 block bg-slate-900"
    >
      {labels.map((l, i) => (
        <g key={i}>
          <line
            x1={l.x}
            y1={l.row * EVENT_ROW_H + EVENT_ROW_H - 2}
            x2={l.x}
            y2={stripH}
            className="stroke-amber-400/30"
            vectorEffect="non-scaling-stroke"
          />
          <text x={l.x} y={l.row * EVENT_ROW_H + 9} textAnchor="middle" className="fill-amber-400/90 text-[9px]">
            {t(EVENT_LABEL[l.type] ?? l.type)}
          </text>
        </g>
      ))}
    </svg>
  );
}
