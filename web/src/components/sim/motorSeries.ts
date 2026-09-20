/**
 * The per-motor series colors the compare overlay and the cluster chart share,
 * so a motor keeps its color between the two tools.
 */

// Compare-overlay series colors — dataviz categorical dark slots 1–6, in the
// fixed CVD-safe order (validated; the legend + direct labels are the required
// secondary encoding for the floor-band adjacent pair). A 7th+ motor grays out.
const SERIES = ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767'];
export const seriesColor = (i: number) => SERIES[i] ?? '#94a3b8';
