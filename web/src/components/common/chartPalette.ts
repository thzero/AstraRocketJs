/**
 * The categorical chart colors: the dataviz skill's validated dark slots in
 * their fixed CVD-safe order. Every chart that colors series by identity draws
 * from this list, so the same slot reads the same color across panes. A chart
 * still needs a legend or direct labels; identity is never color alone.
 */
export const CATEGORICAL: readonly string[] = [
  '#3987e5',
  '#199e70',
  '#c98500',
  '#008300',
  '#9085e9',
  '#e66767',
  '#d55181',
  '#d95926',
];

/** The color for a series past the palette's usable slots. */
const OVERFLOW = '#94a3b8';

/** How many slots the per-motor series use; a 7th motor grays out. */
const MOTOR_SLOTS = 6;

/**
 * The per-motor series color the compare overlay and the cluster chart share,
 * so a motor keeps its color between the two tools.
 */
export const seriesColor = (i: number): string => (i < MOTOR_SLOTS ? (CATEGORICAL[i] ?? OVERFLOW) : OVERFLOW);
