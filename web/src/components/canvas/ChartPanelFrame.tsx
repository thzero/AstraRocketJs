import { PanelExpandButton } from './PanelExpandButton';

/**
 * A flight chart panel's frame: the title and the reading in a header row, the
 * expand toggle beside the reading, and the plot as an SVG `w` by `height`
 * that describes itself to a screen reader with `summary`.
 */
export function ChartPanelFrame({
  title,
  reading,
  expanded,
  onToggleExpand,
  w,
  height,
  summary,
  children,
}: {
  title: string;
  reading: React.ReactNode;
  expanded: boolean;
  /** Absent hides the toggle. */
  onToggleExpand?: () => void;
  w: number;
  height: number;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2 rounded-lg bg-raised/40 ring-1 ring-line/10">
      <div className="flex items-baseline justify-between gap-2 px-2 pt-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{title}</span>
        <span className="flex items-baseline gap-2">
          {reading}
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
        {children}
      </svg>
    </div>
  );
}
