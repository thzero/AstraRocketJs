import { token } from './colorTokens';

/**
 * The categorical chart colors: validated dark-theme slots in their fixed
 * CVD-safe order. Every chart that colors series by identity draws
 * from this list, so the same slot reads the same color across panes. A chart
 * still needs a legend or direct labels; identity is never color alone.
 */
export const CATEGORICAL: readonly string[] = [
  token('chart-1'),
  token('chart-2'),
  token('chart-3'),
  token('chart-4'),
  token('chart-5'),
  token('chart-6'),
  token('chart-7'),
  token('chart-8'),
];

/** The color for a series past the palette's usable slots. */
const OVERFLOW = token('ink-muted');

/** How many slots the per-motor series use; a 7th motor grays out. */
const MOTOR_SLOTS = 6;

/**
 * The per-motor series color the compare overlay and the cluster chart share,
 * so a motor keeps its color between the two tools.
 */
export const seriesColor = (i: number): string => (i < MOTOR_SLOTS ? (CATEGORICAL[i] ?? OVERFLOW) : OVERFLOW);
