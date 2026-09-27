import { describe, expect, it } from 'vitest';
import { FinImageError, finPointsCsv, finPointsFromImage, type Pixels } from '../../src/services/finImage';

/**
 * Tracing a fin out of an image, and writing the point table back out.
 *
 * The fixtures are drawn as ASCII so the shape under test is readable: `#` is
 * fin, `.` is background. One pixel is one millimeter, which is upstream's fixed
 * scale, so a 40-pixel-wide shape traces out as a 40 mm root.
 */

/** An RGBA image from rows of `#` (black) and `.` (white). */
const image = (rows: string[]): Pixels => {
  const height = rows.length;
  const width = rows[0]!.length;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const v = row[x] === '#' ? 0 : 255;
      const p = (y * width + x) * 4;
      data[p] = v;
      data[p + 1] = v;
      data[p + 2] = v;
      data[p + 3] = 255;
    }
  });
  return { width, height, data };
};

/** The same shape drawn big enough that the simplifier has something to chew. */
const scaled = (rows: string[], k: number): string[] =>
  rows.flatMap((row) => {
    const wide = [...row].flatMap((c) => Array<string>(k).fill(c)).join('');
    return Array<string>(k).fill(wide);
  });

const mm = (v: number) => Math.round(v * 1000);

describe('tracing a fin from an image', () => {
  // A right triangle: vertical leading edge, sloped trailing edge, root along
  // the bottom. `triangle1` is one pixel per millimeter; `triangle` is the same
  // shape at 4x, where its diagonal is a 4 mm staircase rather than a line.
  const triangle1 = [
    '#.........',
    '##........',
    '###.......',
    '####......',
    '#####.....',
    '######....',
    '#######...',
    '########..',
    '#########.',
    '##########',
  ];
  const triangle = scaled(triangle1, 4);

  it('collapses a straight traced edge to its two ends', () => {
    // A 40 x 24 mm rectangle: the trace is 128 pixels around it, and all four
    // edges are exactly straight, so only the corners survive.
    const points = finPointsFromImage(image(scaled(['##########', '##########', '##########', '##########'], 4)));
    expect(points.length).toBeLessThan(8);
  });

  it('collapses a staircase whose steps are inside the flatness tolerance', () => {
    // The same triangle at 1 px per mm: each step is 1 mm, which is within the
    // 0.8 mm the simplifier allows, so the diagonal becomes one segment.
    const points = finPointsFromImage(image(triangle1));
    expect(points.length).toBeLessThan(8);
  });

  it('keeps a staircase whose steps are coarser than the tolerance', () => {
    // At 4 px per mm the steps are 4 mm high and really are steps, not a line.
    // Upstream keeps them too: the tolerance is a fixed 0.8 mm, so how much of a
    // traced curve survives depends on how big the image is.
    expect(finPointsFromImage(image(triangle)).length).toBeGreaterThan(8);
  });

  it('puts the root on y = 0 and measures from the leading root corner', () => {
    const points = finPointsFromImage(image(triangle));
    expect(points[0]).toEqual([0, 0]);
    // Every point is inside the shape's own 40 x 40 mm box.
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(mm(x)).toBeLessThanOrEqual(40);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(mm(y)).toBeLessThanOrEqual(40);
    }
  });

  it('reaches the top of the shape and the far end of the root', () => {
    const points = finPointsFromImage(image(triangle));
    // The tip is at the top of the leading edge, and the trailing root corner is
    // a whole root chord aft.
    expect(mm(Math.max(...points.map((p) => p[1])))).toBeGreaterThanOrEqual(36);
    expect(mm(Math.max(...points.map((p) => p[0])))).toBeGreaterThanOrEqual(36);
  });

  it('measures x from the fin, not from the left of the image', () => {
    // The same triangle with 20 blank pixels of margin: the first point is still
    // the origin, because x is offset from the leading root corner.
    const inset = triangle.map((row) => '.'.repeat(20) + row);
    const points = finPointsFromImage(image(inset));
    expect(points[0]).toEqual([0, 0]);
    expect(mm(Math.max(...points.map((p) => p[0])))).toBeGreaterThanOrEqual(36);
  });

  it('reads a color image by its brightness, as the desktop does', () => {
    // A mid-blue fin on a pale background: luma 0.299R + 0.587G + 0.114B, cut at
    // 200, so this traces the same as black on white.
    const rows = scaled(['#...', '##..', '###.', '####'], 4);
    const gray = image(rows);
    const color = image(rows);
    for (let i = 0; i < color.data.length; i += 4) {
      const dark = color.data[i] === 0;
      color.data[i] = dark ? 20 : 240;
      color.data[i + 1] = dark ? 40 : 245;
      color.data[i + 2] = dark ? 160 : 250;
    }
    expect(finPointsFromImage(color)).toEqual(finPointsFromImage(gray));
  });

  it('refuses an image whose fin does not touch the bottom edge', () => {
    // No root to start the trace from, which is the one mistake the desktop's
    // own message calls out.
    const floating = [...scaled(['#.', '##'], 4), '........', '........'];
    expect(() => finPointsFromImage(image(floating))).toThrow(FinImageError);
    try {
      finPointsFromImage(image(floating));
    } catch (e) {
      expect((e as FinImageError).reason).toBe('notTouchingBottom');
    }
  });

  it('refuses a blank image', () => {
    expect(() => finPointsFromImage(image(['....', '....']))).toThrow(FinImageError);
  });

  it('refuses an empty image rather than reading past the end of it', () => {
    expect(() => finPointsFromImage({ width: 0, height: 0, data: new Uint8ClampedArray() })).toThrow(FinImageError);
  });

  it('terminates on a shape that fills the whole frame', () => {
    // A solid block has no outline to walk away from; the step limit is what
    // stops the wall follower circling forever.
    const points = finPointsFromImage(image(scaled(['####', '####', '####', '####'], 3)));
    expect(points.length).toBeGreaterThanOrEqual(3);
  });
});

describe('the exported point table', () => {
  const points: [number, number][] = [
    [0, 0],
    [0.02, 0.05],
    [0.06, 0],
  ];

  it('names the unit in the header and writes the points in it', () => {
    const csv = finPointsCsv(points, 'cm', (m) => m * 100);
    expect(csv.split('\r\n')[0]).toBe('X / cm, Y / cm, ');
    expect(csv.split('\r\n')[1]).toBe('0, 0, ');
    expect(csv.split('\r\n')[2]).toBe('2, 5, ');
  });

  it('keeps the desktop file shape: CRLF, and a trailing separator per line', () => {
    // Reproduced rather than tidied, so a script that already reads these files
    // keeps working. It does leave a third, empty column in a spreadsheet.
    const csv = finPointsCsv(points, 'mm', (m) => m * 1000);
    expect(csv.endsWith('\r\n')).toBe(true);
    for (const line of csv.split('\r\n').filter(Boolean)) expect(line.endsWith(', ')).toBe(true);
  });

  it('writes a header and nothing else for a fin with no points', () => {
    expect(finPointsCsv([], 'cm', (m) => m * 100)).toBe('X / cm, Y / cm, \r\n');
  });
});
