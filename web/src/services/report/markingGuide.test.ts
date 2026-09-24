import { describe, it, expect } from 'vitest';
import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import {
  GUIDE_WIDTH_MM,
  PAPER_THICKNESS_M,
  TWO_PI,
  cutPoints,
  guideCircumferenceMm,
  markingGuides,
  mountAngles,
  radialOrigin,
  zeroTwoPi,
} from './markingGuide';

/**
 * The fin marking guide's numbers, which nothing else in the app can check.
 *
 * `FinMarkingGuide.java` is in OpenRocket's SWING module, and the extraction
 * under `engine-java/src/java` is sparse to `core/src/main/java` — so unlike
 * the fin planform, there is no committed Java here for a kernel test to
 * re-derive these from. This file is the substitute: each case states the
 * upstream rule it pins and, where the value is arithmetic rather than a rule,
 * works it out independently of the implementation.
 *
 * It matters because every failure mode here is invisible on paper. A strip cut
 * to the tube's circumference instead of the paper's is 0.6 mm short on a 38 mm
 * tube and looks perfect; a seam rule that drifts puts a fin line under the
 * tape, where it cannot be marked at all.
 */

const node = (o: object) => o as unknown as ComponentNode;
const tree = (...components: ComponentNode[]) => ({ name: 'T', components }) as unknown as RocketTree;
const deg = (d: number) => (d * Math.PI) / 180;

describe('guideCircumferenceMm', () => {
  it('wraps the PAPER, not the tube: one paper thickness further out', () => {
    // 38 mm tube: the strip has to be 2*pi*0.1 mm longer than the tube itself,
    // or its ends do not meet once it is wrapped.
    expect(guideCircumferenceMm(0.038)).toBeCloseTo(2 * Math.PI * 38.1, 9);
    expect(guideCircumferenceMm(0.038) - 2 * Math.PI * 38).toBeCloseTo(2 * Math.PI * 0.1, 9);
  });

  it('is a larger share of a small tube (why the correction exists at all)', () => {
    const err = (r: number) => (guideCircumferenceMm(r) - r * TWO_PI * 1000) / (r * TWO_PI * 1000);
    expect(err(0.013)).toBeGreaterThan(err(0.076));
    expect(err(0.013)).toBeCloseTo(PAPER_THICKNESS_M / 0.013, 9);
  });
});

describe('zeroTwoPi', () => {
  it('folds both directions into [0, 2pi)', () => {
    expect(zeroTwoPi(-Math.PI / 2)).toBeCloseTo(1.5 * Math.PI, 12);
    expect(zeroTwoPi(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(zeroTwoPi(0)).toBe(0);
  });

  it('folds exactly 2pi to 0, where upstream leaves it at 2pi', () => {
    // Upstream's `while (v > TWO_PI)` never fires on equality, which would put
    // a mark at the far end of the strip and open a phantom gap for the seam.
    expect(zeroTwoPi(TWO_PI)).toBe(0);
  });
});

describe('radialOrigin', () => {
  it('puts the seam half a turn from a lone mark', () => {
    expect(radialOrigin([0])).toBeCloseTo(Math.PI, 12);
    expect(radialOrigin([deg(30)])).toBeCloseTo(deg(210), 12);
  });

  it('splits the widest gap so no mark lands on the seam', () => {
    // Three fins at 0/120/240 leave three equal gaps; the first one found wins
    // and the seam sits in its middle. What matters is the mark NEAREST the
    // seam: it has to be half a gap away, which is as far as the design allows.
    const marks = [0, deg(120), deg(240)];
    const o = radialOrigin(marks);
    const away = marks.map((a) => {
      const d = zeroTwoPi(a - o);
      return Math.min(d, TWO_PI - d);
    });
    expect(Math.min(...away)).toBeCloseTo(deg(60), 9);
  });

  it('uses the wrap-around gap when the marks are bunched', () => {
    // Everything between 10 and 40 degrees: the real gap runs 40 -> 370, and a
    // rule that only looked at sorted neighbors would seam the strip inside the
    // cluster, on top of a fin.
    const marks = [deg(10), deg(20), deg(40)];
    expect(radialOrigin(marks)).toBeCloseTo(deg(205), 9);
  });

  it('is 0 with nothing to mark', () => {
    expect(radialOrigin([])).toBe(0);
  });
});

describe('mountAngles', () => {
  it('spaces a fin set evenly from its base rotation', () => {
    const fins = node({ type: 'trapezoidfinset', id: 'f', finCount: 4, rotation: deg(45) });
    expect(mountAngles(fins).map((a) => Math.round((a * 180) / Math.PI))).toEqual([45, 135, 225, 315]);
  });

  it('reads a fin count the design never set from the kernel default', () => {
    expect(mountAngles(node({ type: 'trapezoidfinset', id: 'f' })).length).toBe(3);
    expect(mountAngles(node({ type: 'tubefinset', id: 't' })).length).toBe(6);
  });

  it('gives a lug and a rail button one mark, at the angle the .ork writer saves', () => {
    // The 180-degree fallback is exportWriters.ts:278/291 and rocketPieces
    // ts:203, not a number chosen here.
    expect(mountAngles(node({ type: 'launchlug', id: 'l' }))).toEqual([Math.PI]);
    expect(mountAngles(node({ type: 'railbutton', id: 'r', angleOffset: deg(90) }))).toEqual([deg(90)]);
  });
});

describe('cutPoints', () => {
  it('leaves a strip that fits in one piece', () => {
    expect(cutPoints([10, 50], 120, 260)).toEqual([0, 120]);
  });

  it('cuts a 4 in tube into as few pieces as the page allows', () => {
    // 308.5 mm of wrap against an A4 portrait strip height: two pieces, not
    // three, and never a scaled-down one.
    const c = guideCircumferenceMm(0.049);
    const cuts = cutPoints([20, 120, 220], c, 264);
    expect(cuts).toHaveLength(3);
    expect(cuts[0]).toBe(0);
    expect(cuts[cuts.length - 1]).toBe(c);
    for (let i = 1; i < cuts.length; i++) expect(cuts[i]! - cuts[i - 1]!).toBeLessThanOrEqual(264);
  });

  it('puts the join in a gap rather than on a mark', () => {
    // An even split of 300 would cut at 150, which is exactly where a mark is.
    // The join is tape, so a mark on it cannot be transferred to the tube.
    const marks = [40, 150, 260];
    const cuts = cutPoints(marks, 300, 200);
    expect(cuts).toHaveLength(3);
    const join = cuts[1]!;
    for (const m of marks) expect(Math.abs(join - m)).toBeGreaterThan(20);
  });

  it('never lets a piece outgrow the page to find a gap', () => {
    // The only gaps are far from the even split; the window has to win.
    const marks = [5, 10, 15, 20, 290, 295];
    const cuts = cutPoints(marks, 300, 160);
    for (let i = 1; i < cuts.length; i++) expect(cuts[i]! - cuts[i - 1]!).toBeLessThanOrEqual(160);
    expect(cuts[cuts.length - 1]).toBe(300);
  });

  it('keeps the pieces in order and covers the whole wrap', () => {
    const cuts = cutPoints([100, 400, 700], 900, 250);
    expect(cuts).toHaveLength(5);
    for (let i = 1; i < cuts.length; i++) expect(cuts[i]!).toBeGreaterThan(cuts[i - 1]!);
    expect(cuts[cuts.length - 1]! - cuts[0]!).toBe(900);
  });
});

describe('markingGuides', () => {
  const finned = (children: object[], tubeProps: object = {}) =>
    tree(
      node({
        type: 'stage',
        id: 's',
        children: [
          node({
            type: 'bodytube',
            id: 'body',
            name: 'Body',
            outerRadius: 0.038,
            ...tubeProps,
            children: children.map(node),
          }),
        ],
      }),
    );

  it('consolidates every angular part on one tube onto one strip', () => {
    const { guides } = markingGuides(
      finned([
        { type: 'trapezoidfinset', id: 'f', name: 'Fins', finCount: 3 },
        { type: 'tubefinset', id: 'tf', name: 'Tubes', finCount: 6 },
        { type: 'launchlug', id: 'l', name: 'Lug', angleOffset: deg(60) },
        { type: 'railbutton', id: 'rb', name: 'Button', angleOffset: deg(60) },
      ]),
    );
    expect(guides).toHaveLength(1);
    expect(guides[0]!.marks).toHaveLength(3 + 6 + 1 + 1);
    expect(new Set(guides[0]!.marks.map((m) => m.name))).toEqual(new Set(['Fins', 'Tubes', 'Lug', 'Button']));
  });

  it('places marks along the wrap by angle from the seam, in order', () => {
    const { guides } = markingGuides(finned([{ type: 'trapezoidfinset', id: 'f', finCount: 4 }]));
    const g = guides[0]!;
    expect(g.circumferenceMm).toBeCloseTo(guideCircumferenceMm(0.038), 12);
    // Four fins, a quarter of the wrap apart, wherever the seam ended up.
    const gaps = g.marks.slice(1).map((m, i) => m.posMm - g.marks[i]!.posMm);
    for (const gap of gaps) expect(gap).toBeCloseTo(g.circumferenceMm / 4, 9);
    // And none of them on the seam itself.
    expect(g.marks[0]!.posMm).toBeGreaterThan(0);
    expect(g.marks[g.marks.length - 1]!.posMm).toBeLessThan(g.circumferenceMm);
  });

  it('marks a lug relative to the fins, which is the whole point of the guide', () => {
    // Fins at 0/120/240 and a lug at 60: the lug must land exactly halfway
    // between two fin marks on the strip.
    const { guides } = markingGuides(
      finned([
        { type: 'trapezoidfinset', id: 'f', name: 'Fins', finCount: 3 },
        { type: 'launchlug', id: 'l', name: 'Lug', angleOffset: deg(60) },
      ]),
    );
    const g = guides[0]!;
    const lug = g.marks.findIndex((m) => m.name === 'Lug');
    expect(lug).toBeGreaterThan(0);
    const before = g.marks[lug - 1]!.posMm;
    const after = g.marks[lug + 1]!.posMm;
    expect(g.marks[lug]!.posMm - before).toBeCloseTo(after - g.marks[lug]!.posMm, 9);
  });

  it('carries the cant and the root chord a canted fin is marked from', () => {
    const { guides } = markingGuides(
      finned([{ type: 'trapezoidfinset', id: 'f', finCount: 3, rootChord: 0.06, cant: deg(3) }]),
    );
    const m = guides[0]!.marks[0]!;
    expect(m.cant).toBeCloseTo(deg(3), 12);
    expect(m.rootChordMm).toBeCloseTo(60, 9);
  });

  it('measures a freeform fin root from its outline, not a rootChord key', () => {
    const { guides } = markingGuides(
      finned([
        {
          type: 'freeformfinset',
          id: 'f',
          finCount: 3,
          cant: deg(2),
          points: [
            [0, 0],
            [0.02, 0.05],
            [0.07, 0],
          ],
        },
      ]),
    );
    expect(guides[0]!.marks[0]!.rootChordMm).toBeCloseTo(70, 9);
  });

  it('leaves tube fins uncanted: a tube fin set has no cant to read', () => {
    const { guides } = markingGuides(finned([{ type: 'tubefinset', id: 'tf', finCount: 4, cant: deg(5) }]));
    for (const m of guides[0]!.marks) expect(m.cant).toBe(0);
  });

  it('gives a tube with only a lug no guide, and says so', () => {
    // Upstream's `hasFins`: this is a FIN marking guide, and a lone lug line
    // has no fin to be square to. Upstream then drops the lug silently.
    const { guides, omitted } = markingGuides(finned([{ type: 'launchlug', id: 'l', name: 'Lug' }]));
    expect(guides).toEqual([]);
    expect(omitted).toEqual([{ name: 'Lug', type: 'launchlug', reason: 'noFins' }]);
  });

  it('does not wrap a nose cone, and names what it could not mark', () => {
    // A nose cone's circumference changes along its length, so there is no one
    // wrap to cut. Upstream attributes such a fin to the PREVIOUS body tube and
    // marks it at that tube's circumference, which is a wrong guide, not none.
    const t = tree(
      node({
        type: 'stage',
        id: 's',
        children: [
          node({
            type: 'nosecone',
            id: 'nose',
            aftRadius: 0.038,
            children: [node({ type: 'launchlug', id: 'l', name: 'Nose lug' })],
          }),
          node({
            type: 'bodytube',
            id: 'body',
            outerRadius: 0.038,
            children: [node({ type: 'trapezoidfinset', id: 'f', finCount: 3 })],
          }),
        ],
      }),
    );
    const { guides, omitted } = markingGuides(t);
    expect(guides.map((g) => g.tubeId)).toEqual(['body']);
    expect(guides[0]!.marks).toHaveLength(3);
    expect(omitted).toEqual([{ name: 'Nose lug', type: 'launchlug', reason: 'noWrap' }]);
  });

  it('gives each finned tube its own strip at its own circumference', () => {
    const t = tree(
      node({
        type: 'stage',
        id: 's',
        children: [
          node({
            type: 'bodytube',
            id: 'upper',
            outerRadius: 0.038,
            children: [node({ type: 'trapezoidfinset', id: 'f1', finCount: 3 })],
          }),
          node({
            type: 'bodytube',
            id: 'lower',
            outerRadius: 0.05,
            children: [node({ type: 'tubefinset', id: 'f2', finCount: 6 })],
          }),
          node({ type: 'bodytube', id: 'bare', outerRadius: 0.038 }),
        ],
      }),
    );
    const { guides } = markingGuides(t);
    expect(guides.map((g) => g.tubeId)).toEqual(['upper', 'lower']);
    expect(guides[1]!.circumferenceMm).toBeCloseTo(guideCircumferenceMm(0.05), 12);
  });

  it('falls back to the kernel body-tube radius rather than collapsing the strip', () => {
    const { guides } = markingGuides(
      finned([{ type: 'trapezoidfinset', id: 'f', finCount: 3 }], { outerRadius: null }),
    );
    expect(guides[0]!.circumferenceMm).toBeCloseTo(guideCircumferenceMm(0.012), 12);
  });
});

describe('GUIDE_WIDTH_MM', () => {
  it('is upstream 3 inches, and two strips still fit a portrait page', () => {
    expect(GUIDE_WIDTH_MM).toBeCloseTo(76.2, 9);
    // A4 portrait content width, from layout.pageFrame: 210 - 2*12.
    expect(2 * GUIDE_WIDTH_MM + 10).toBeLessThanOrEqual(186);
  });
});
