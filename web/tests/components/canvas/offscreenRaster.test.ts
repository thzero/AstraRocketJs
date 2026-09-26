import { describe, it, expect } from 'vitest';
import { clampExportSize, flipRows } from '../../../src/components/canvas/offscreenRaster';

/**
 * The pure half of the offscreen 3D export. The WebGL half cannot run under
 * vitest, so these are the numbers that CAN be pinned: the size the render
 * target is asked for, and the row order of the readback.
 */

describe('clampExportSize', () => {
  it('derives the height from the aspect and keeps a request under the limit as is', () => {
    expect(clampExportSize(1920, 2, 8192)).toEqual({ width: 1920, height: 960 });
  });

  it('rounds to whole pixels and never goes under 1', () => {
    expect(clampExportSize(1000, 3, 8192)).toEqual({ width: 1000, height: 333 });
    expect(clampExportSize(1, 1000, 8192)).toEqual({ width: 1, height: 1 });
  });

  it('scales both edges down together when the width exceeds the texture limit', () => {
    // An 8K request on a 4096 GPU: the width lands on the limit and the height
    // shrinks by the same factor, so the aspect survives.
    const s = clampExportSize(7680, 16 / 9, 4096);
    expect(s.width).toBe(4096);
    expect(s.height).toBe(Math.floor(4320 / (7680 / 4096)));
    expect(s.width / s.height).toBeCloseTo(16 / 9, 2);
  });

  it('clamps on the height when a tall aspect makes that the long edge', () => {
    const s = clampExportSize(1000, 0.1, 4096);
    expect(s.height).toBe(4096);
    expect(s.width).toBe(Math.floor(1000 / (10000 / 4096)));
  });

  it('treats a missing or nonsense limit as no limit', () => {
    expect(clampExportSize(7680, 2, 0)).toEqual({ width: 7680, height: 3840 });
    expect(clampExportSize(7680, 2, NaN)).toEqual({ width: 7680, height: 3840 });
  });

  it('survives a nonsense aspect', () => {
    expect(clampExportSize(100, 0, 8192)).toEqual({ width: 100, height: 100 });
    expect(clampExportSize(100, NaN, 8192)).toEqual({ width: 100, height: 100 });
  });
});

describe('flipRows', () => {
  it('reverses the row order and leaves each row intact', () => {
    // 2x3 RGBA: row r has every byte equal to r, so the order is legible.
    const w = 2;
    const h = 3;
    const src = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) src.fill(y, y * w * 4, (y + 1) * w * 4);
    const out = flipRows(src, w, h);
    expect(out).toBeInstanceOf(Uint8ClampedArray);
    expect(Array.from(out.subarray(0, w * 4))).toEqual(new Array(w * 4).fill(2));
    expect(Array.from(out.subarray(w * 4, 2 * w * 4))).toEqual(new Array(w * 4).fill(1));
    expect(Array.from(out.subarray(2 * w * 4))).toEqual(new Array(w * 4).fill(0));
  });

  it('passes alpha through untouched', () => {
    const src = new Uint8Array([10, 20, 30, 128]);
    expect(Array.from(flipRows(src, 1, 1))).toEqual([10, 20, 30, 128]);
  });

  it('does not mutate its input', () => {
    const src = new Uint8Array([1, 1, 1, 1, 2, 2, 2, 2]);
    const copy = Array.from(src);
    flipRows(src, 1, 2);
    expect(Array.from(src)).toEqual(copy);
  });

  it('rejects a buffer whose length does not match the size', () => {
    expect(() => flipRows(new Uint8Array(7), 1, 2)).toThrow(RangeError);
  });
});
