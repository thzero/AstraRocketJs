import { describe, it, expect } from 'vitest';
import { heat, hsv, niceName } from '../../../src/components/canvas/AeroAnalysis';

/**
 * The cell-shading port, which claimed to reproduce OpenRocket and had nothing
 * checking it.
 *
 * The `openrocket` style is a formula-for-formula port of
 * `java.awt.Color.getHSBColor` plus the desktop's absolute full-red-at-1.5 Cd
 * anchor. `aero-heat.spec.ts` can see that shading exists, but not that it
 * matches the thing the docblock says it matches - which is the entire claim.
 */

/** `rgb(r, g, b)` back to numbers, so the ramp can be reasoned about. */
const rgb = (css: string): [number, number, number] => {
  const m = css.match(/rgb\((\d+), (\d+), (\d+)\)/);
  if (!m) throw new Error(`not an rgb() string: ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};

describe('hsv matches java.awt.Color.getHSBColor', () => {
  /** The reference, transcribed from the Java rather than from our own code. */
  const javaHSBtoRGB = (h: number, s: number, v: number): [number, number, number] => {
    if (s === 0) {
      const g = Math.round(v * 255);
      return [g, g, g];
    }
    const hh = (h - Math.floor(h)) * 6;
    const f = hh - Math.floor(hh);
    const p = v * (1 - s);
    const q = v * (1 - s * f);
    const t = v * (1 - s * (1 - f));
    const to = (x: number) => Math.round(x * 255);
    switch (Math.floor(hh)) {
      case 0:
        return [to(v), to(t), to(p)];
      case 1:
        return [to(q), to(v), to(p)];
      case 2:
        return [to(p), to(v), to(t)];
      case 3:
        return [to(p), to(q), to(v)];
      case 4:
        return [to(t), to(p), to(v)];
      default:
        return [to(v), to(p), to(q)];
    }
  };

  it('agrees with the Java reference across the hue circle', () => {
    for (const h of [0, 0.08, 0.1667, 0.25, 0.3333, 0.5, 0.75, 0.99]) {
      for (const sat of [0.1, 0.5, 0.9, 1]) {
        const ours = rgb(hsv(h, sat, 1));
        const java = javaHSBtoRGB(h, sat, 1);
        for (let i = 0; i < 3; i++) expect(Math.abs(ours[i]! - java[i]!)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is a neutral gray at zero saturation', () => {
    const [r, g, b] = rgb(hsv(0.5, 0, 1));
    expect(r).toBe(g);
    expect(g).toBe(b);
  });
});

describe('the openrocket ramp', () => {
  it('runs green at zero to red at the 1.5 Cd anchor', () => {
    const low = rgb((heat(0.01, 10, 'openrocket') as { backgroundColor: string }).backgroundColor);
    const high = rgb((heat(1.5, 10, 'openrocket') as { backgroundColor: string }).backgroundColor);
    expect(low[1]).toBeGreaterThan(low[0]); // green dominates at the bottom
    expect(high[0]).toBeGreaterThan(high[1]); // red dominates at the anchor
  });

  it('is ABSOLUTE: the same value shades the same whatever the row maximum is', () => {
    const a = heat(0.75, 1, 'openrocket');
    const b = heat(0.75, 1000, 'openrocket');
    expect(a).toEqual(b);
  });

  it('saturates past the anchor rather than wrapping back to green', () => {
    const at = rgb((heat(1.5, 10, 'openrocket') as { backgroundColor: string }).backgroundColor);
    const past = rgb((heat(15, 10, 'openrocket') as { backgroundColor: string }).backgroundColor);
    expect(past[0]).toBeGreaterThanOrEqual(at[0] - 1);
    expect(past[1]).toBeLessThanOrEqual(at[1] + 1);
  });

  it('darkens the text, since the desktop ramp produces light cells', () => {
    expect((heat(1, 10, 'openrocket') as { color: string }).color).toBe('#000');
  });
});

describe('the sky ramp', () => {
  it('is RELATIVE: it scales against the row set own largest', () => {
    const half = heat(5, 10, 'sky') as { backgroundColor: string };
    const full = heat(10, 10, 'sky') as { backgroundColor: string };
    expect(half.backgroundColor).not.toBe(full.backgroundColor);
    // Same share of a different maximum shades identically.
    expect(heat(50, 100, 'sky')).toEqual(half);
  });

  it('stays short of opaque so the text keeps its own color', () => {
    const css = (heat(1000, 10, 'sky') as { backgroundColor: string }).backgroundColor;
    const alpha = Number(css.match(/,\s*([\d.]+)\)$/)![1]);
    expect(alpha).toBeLessThan(1);
  });

  it('has no shading without a positive maximum', () => {
    expect(heat(5, 0, 'sky')).toBeUndefined();
  });
});

describe('heat declines to shade a non-value', () => {
  it.each([0, -1, NaN, Infinity])('%p', (v) => {
    expect(heat(v, 10, 'sky')).toBeUndefined();
    expect(heat(v, 10, 'openrocket')).toBeUndefined();
  });
});

describe('niceName', () => {
  it('splits a CamelCase class into words', () => {
    expect(niceName('[BodyTube.BodyTube]')).toBe('Body Tube');
  });

  it('prefers the instance name when it differs', () => {
    expect(niceName('[BodyTube.Upper Airframe]')).toBe('Upper Airframe');
  });

  it('passes through a bare name', () => {
    expect(niceName('NoseCone')).toBe('Nose Cone');
  });
});
