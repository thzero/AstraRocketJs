import { describe, expect, it } from 'vitest';
// @ts-expect-error - a plain .mjs build script helper, no types
import { applyStatedMass } from '../../../scripts/lib/statedMass.mjs';

/**
 * The stated mass sync-preset-digests carries onto a catalog row. A row whose
 * mass the engine gives no volume must come back as such, so the run can name
 * it, rather than as a row with nothing to apply.
 */
type Row = { type: string; mass?: number; materialDensity?: number };
const apply = (row: Row, mass: number | null, volume: number | null): string | null =>
  applyStatedMass(row, mass, () => volume);

describe('applyStatedMass', () => {
  it('spreads a structural part mass over its volume', () => {
    const row: Row = { type: 'bodytube', materialDensity: 680 };
    expect(apply(row, 0.01, 0.0001)).toBe('applied');
    expect(row.materialDensity).toBeCloseTo(100, 9);
    expect(row.mass).toBe(0.01);
  });

  it('reports a stated mass with no volume to spread it over', () => {
    const row: Row = { type: 'transition', materialDensity: 128, mass: 1 };
    expect(apply(row, 0.00425, null)).toBe('no-volume');
    expect(row.materialDensity).toBe(128);
    expect(row.mass).toBeUndefined();
  });

  it("takes a parachute's mass as is", () => {
    const row: Row = { type: 'parachute' };
    expect(apply(row, 0.02, null)).toBe('applied');
    expect(row.mass).toBe(0.02);
  });

  it("keeps a rail button's own mass and drops any other unstated one", () => {
    const button: Row = { type: 'railbutton', mass: 0.003 };
    expect(apply(button, null, null)).toBeNull();
    expect(button.mass).toBe(0.003);
    const streamer: Row = { type: 'streamer', mass: 0.003 };
    expect(apply(streamer, 0.003, 1)).toBeNull();
    expect(streamer.mass).toBeUndefined();
  });
});
