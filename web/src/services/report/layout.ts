import type { ComponentNode } from '../../engine/openRocketEngine';
import { isPlanarFinSet } from '../../tree/tubefins';

/**
 * The PDF report's layout arithmetic and the two selectors the sections share,
 * kept free of jsPDF so every number here is reachable from a plain unit test.
 */

/** Exported for test: a malformed color silently becomes near-black otherwise. */
/** `#rrggbb` to an [r,g,b] triple for jsPDF. See `flightPathExport.hexToRgbInt`. */
export const hexToRgbTuple = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [17, 24, 39];
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * Exported for test: this decides WHICH fin templates get printed at all.
 *
 * `isPlanarFinSet`, not `endsWith('finset')` — a tube fin has no planform to
 * cut, and OpenRocket's FinSetPrintStrategy cannot reach one either
 * (`instanceof FinSet`, and TubeFinSet extends Tube). The broad match handed
 * finPlanformMm a tube and got back a fabricated 50 × 30 mm trapezoid, printed
 * 1:1 and labeled with the tube fin set's own name and count.
 */
export const finSetsOf = (stage: ComponentNode): ComponentNode[] => {
  const out: ComponentNode[] = [];
  const walk = (nodes: ComponentNode[]) => {
    for (const n of nodes) {
      if (isPlanarFinSet(String(n.type))) out.push(n);
      if (n.children) walk(n.children);
    }
  };
  walk(stage.children ?? []);
  return out;
};

/**
 * The mm box every section lays out inside. Split out of downloadReportPdf so
 * the arithmetic below it is reachable without driving jsPDF — none of it was,
 * and a drift here prints a 1:1 template at the wrong size, which looks entirely
 * plausible on paper and is only found after someone has cut to it.
 */
export interface PageFrame {
  /** Page margin (mm), all four sides. */
  margin: number;
  /** Drawable width between the margins (mm). */
  contentWidth: number;
  /** y past which a block must break to a new page (mm). */
  bottom: number;
}

export const PAGE_MARGIN_MM = 12;

export function pageFrame(pageWidthMm: number, pageHeightMm: number): PageFrame {
  const margin = PAGE_MARGIN_MM;
  return { margin, contentWidth: pageWidthMm - 2 * margin, bottom: pageHeightMm - margin };
}

/** The side view's band height (mm) — it is fit-to-page, not 1:1. */
export const SIDE_VIEW_BAND_MM = 34;

/**
 * Fit the rocket side view to the content width AND the band height, whichever
 * binds first. `Math.max(h, 1)` keeps a zero-height silhouette (a design that is
 * all zero radii) from yielding Infinity and a blank page.
 */
export function sideViewScale(svWidthMm: number, svHeightMm: number, frame: PageFrame): number {
  return Math.min(frame.contentWidth / svWidthMm, SIDE_VIEW_BAND_MM / Math.max(svHeightMm, 1));
}

/** Center the scaled side view across the content width; oy is its midline. */
export function sideViewOrigin(
  svWidthMm: number,
  svHeightMm: number,
  scale: number,
  y: number,
  frame: PageFrame,
): { ox: number; oy: number } {
  return {
    ox: frame.margin + (frame.contentWidth - svWidthMm * scale) / 2,
    oy: y + (svHeightMm * scale) / 2,
  };
}

/**
 * Does a 1:1 template fit the page? Templates are NEVER scaled down — a shrunk
 * cutting template is worse than none — so one that does not fit is replaced by
 * the `report.tooLarge` note telling the reader to pick a bigger paper or
 * landscape.
 */
export function templateFits(widthMm: number, heightMm: number, frame: PageFrame): boolean {
  return widthMm <= frame.contentWidth && heightMm <= frame.bottom - frame.margin;
}
