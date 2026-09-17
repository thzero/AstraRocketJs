import { describe, it, expect } from 'vitest';
import {
  PAGE_MARGIN_MM,
  SIDE_VIEW_BAND_MM,
  finSetsOf,
  hexToRgb,
  pageFrame,
  sideViewOrigin,
  sideViewScale,
  templateFits,
} from './reportPdf';
import type { ComponentNode } from '../engine/openRocketEngine';

/**
 * The PDF report's layout arithmetic.
 *
 * `downloadReportPdf` builds a MILLIMETER document and draws fin, nose-cone and
 * transition outlines into it at 1:1, so a reader can print the page and cut to
 * it. Every helper in that file was a closure over `doc` and a mutable `y`,
 * which is why all 203 executable lines and all 38 functions ran at zero — and
 * the failure they can produce is the quiet kind: a PDF that opens fine, looks
 * right, and is the wrong size, found only after someone has cut to it.
 *
 * The page numbers below are the paper standards (ISO 216 A4 = 210 × 297 mm;
 * ANSI A "Letter" = 8.5 × 11 in = 215.9 × 279.4 mm), not values read back out
 * of the code.
 */

const A4_PORTRAIT = pageFrame(210, 297);
const A4_LANDSCAPE = pageFrame(297, 210);
const LETTER_PORTRAIT = pageFrame(215.9, 279.4);

describe('pageFrame', () => {
  it('insets the page by the margin on all four sides', () => {
    expect(PAGE_MARGIN_MM).toBe(12);
    expect(A4_PORTRAIT).toEqual({ margin: 12, contentWidth: 186, bottom: 285 }); // 210−24, 297−12
  });

  it('measures Letter and landscape from their own dimensions', () => {
    expect(LETTER_PORTRAIT.contentWidth).toBeCloseTo(191.9, 9); // 215.9 − 24
    expect(LETTER_PORTRAIT.bottom).toBeCloseTo(267.4, 9); // 279.4 − 12
    expect(A4_LANDSCAPE).toEqual({ margin: 12, contentWidth: 273, bottom: 198 });
  });
});

describe('templateFits — a template prints 1:1 or not at all', () => {
  it('accepts one that exactly fills the drawable area', () => {
    // 186 mm across, and 273 mm down: `bottom` (285) less the top margin the
    // block starts at.
    expect(templateFits(186, 273, A4_PORTRAIT)).toBe(true);
  });

  it('refuses one a hair too wide or too tall rather than shrinking it', () => {
    // Shrinking would be the worst outcome available: a template that prints,
    // measures wrong, and says nothing. The caller draws `report.tooLarge`.
    expect(templateFits(186.1, 273, A4_PORTRAIT)).toBe(false);
    expect(templateFits(186, 273.1, A4_PORTRAIT)).toBe(false);
  });

  it('trades width for height when the reader picks landscape', () => {
    // A 250 mm root chord — an ordinary mid-power fin — is wider than A4
    // portrait's 186 mm but well inside landscape's 273 mm.
    expect(templateFits(250, 60, A4_PORTRAIT)).toBe(false);
    expect(templateFits(250, 60, A4_LANDSCAPE)).toBe(true);
    // ...and landscape gives up the height for it: 186 mm, not 273 mm.
    expect(templateFits(60, 250, A4_PORTRAIT)).toBe(true);
    expect(templateFits(60, 250, A4_LANDSCAPE)).toBe(false);
  });
});

describe('sideViewScale — the side view is fit-to-page, NOT 1:1', () => {
  it('fills the content width for a long, slender rocket', () => {
    // 1 m long, 100 mm across: the width binds at 186/1000, because the 34 mm
    // band would have allowed 0.34.
    const scale = sideViewScale(1000, 100, A4_PORTRAIT);
    expect(scale).toBeCloseTo(0.186, 9);
    expect(1000 * scale).toBeCloseTo(A4_PORTRAIT.contentWidth, 9);
  });

  it('lets the band bind for a short, fat one', () => {
    // 300 mm long, 100 mm across: the width would allow 0.62, the band only 0.34.
    expect(sideViewScale(300, 100, A4_PORTRAIT)).toBeCloseTo(SIDE_VIEW_BAND_MM / 100, 9);
  });

  it('never divides by a zero height', () => {
    // A design whose every radius is zero has no silhouette at all; unclamped
    // this is Infinity, and the whole section draws off the page.
    expect(sideViewScale(186, 0, A4_PORTRAIT)).toBe(1);
  });
});

describe('sideViewOrigin', () => {
  it('centers the scaled drawing across the content width', () => {
    // 100 mm at 1:1 inside 186 mm leaves 43 mm each side.
    expect(sideViewOrigin(100, 20, 1, 50, A4_PORTRAIT).ox).toBeCloseTo(55, 9); // 12 + 43
  });

  it('puts the axis on the block midline, because the body is drawn about ±radius', () => {
    // fillScaled draws with sy = −scale about oy, so oy has to sit half the
    // block down from the top or the rocket hangs off it.
    expect(sideViewOrigin(100, 20, 1, 50, A4_PORTRAIT).oy).toBeCloseTo(60, 9); // 50 + 20/2
  });

  it('starts at the margin when the drawing fills the width', () => {
    expect(sideViewOrigin(186, 10, 1, 12, A4_PORTRAIT).ox).toBeCloseTo(A4_PORTRAIT.margin, 9);
  });
});

describe('hexToRgb — the template stroke and fill', () => {
  it('reads six-digit hex, with or without the hash, in either case', () => {
    expect(hexToRgb('#ff8800')).toEqual([255, 136, 0]);
    expect(hexToRgb('ff8800')).toEqual([255, 136, 0]);
    expect(hexToRgb('  #FF8800  ')).toEqual([255, 136, 0]);
  });

  it('falls back to near-black rather than NaN for anything else', () => {
    // NaN would reach jsPDF's setDrawColor and land an invalid color operator
    // in the content stream — a file that opens in some readers and not others.
    for (const bad of ['', 'nonsense', '#12345', '#1234567', 'rgb(1,2,3)']) {
      expect(hexToRgb(bad), `hexToRgb(${JSON.stringify(bad)})`).toEqual([17, 24, 39]);
    }
  });

  it('does NOT take the three-digit shorthand', () => {
    // `#f80` is valid CSS and is silently drawn near-black here. Pinned so the
    // next reader knows it is the regex, not a color-space surprise.
    expect(hexToRgb('#f80')).toEqual([17, 24, 39]);
  });
});

describe('finSetsOf — which fin templates get printed at all', () => {
  const node = (o: object) => o as unknown as ComponentNode;
  const stage = node({
    type: 'stage',
    children: [
      node({ type: 'nosecone', id: 'n' }),
      node({
        type: 'bodytube',
        id: 'b',
        children: [
          node({ type: 'trapezoidfinset', id: 'f1' }),
          // A fin set on a pod is still a fin set somebody has to cut.
          node({ type: 'podset', id: 'p', children: [node({ type: 'freeformfinset', id: 'f2' })] }),
        ],
      }),
    ],
  });

  it('finds fin sets at any depth, in tree order, and nothing else', () => {
    expect(finSetsOf(stage).map((n) => n.id)).toEqual(['f1', 'f2']);
  });

  it('returns nothing for a stage with no children', () => {
    expect(finSetsOf(node({ type: 'stage' }))).toEqual([]);
  });
});

describe('finSetsOf — tube fins have no template', () => {
  const node = (o: object) => o as unknown as ComponentNode;

  it('skips a tube fin set while keeping the flat ones beside it', () => {
    // `<tubefinset>` ends in "finset", so the old element-name match handed it
    // to finPlanformMm, which fell through to its trapezoid branch and invented
    // a 50 x 30 mm swept fin out of the rootChord/height defaults — printed 1:1
    // and labeled with the tube fin set's own name and count. OpenRocket
    // cannot make that mistake: TubeFinSet extends Tube, so it never reaches
    // PrintableFinSet (AbstractPrintable<FinSet>).
    const stage = node({
      type: 'stage',
      children: [
        node({
          type: 'bodytube',
          id: 'b',
          children: [
            node({ type: 'trapezoidfinset', id: 'flat' }),
            node({ type: 'tubefinset', id: 'tubes', finCount: 6, length: 0.08, outerRadius: 0.012 }),
          ],
        }),
      ],
    });
    expect(finSetsOf(stage).map((n) => n.id)).toEqual(['flat']);
  });

  it('emits no templates at all for a rocket finned only with tubes', () => {
    const stage = node({
      type: 'stage',
      children: [node({ type: 'bodytube', id: 'b', children: [node({ type: 'tubefinset', id: 'tubes' })] })],
    });
    expect(finSetsOf(stage)).toEqual([]);
  });
});
