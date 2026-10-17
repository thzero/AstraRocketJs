import { describe, expect, it } from 'vitest';
// @ts-expect-error - a plain .mjs build script helper, no types
import { applyStatedMass, statedMassTally } from '../../../scripts/lib/statedMass.mjs';

/**
 * The stated mass sync-preset-digests carries onto a catalog row. A row whose
 * mass the engine gives no volume must come back as such, so the run can refuse
 * the catalog, rather than as a row with nothing to apply.
 */
type Row = { type: string; mass?: number; materialDensity?: number };
const apply = (row: Row, mass: number | null, volume: number | null, desktopHasVolume = true): string | null =>
  applyStatedMass(row, mass, () => volume, desktopHasVolume);

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

  it('gives a rail button the density of its own mass and keeps the override it flies with', () => {
    // makeRailButton: the preset's MASS (the button alone) over the button's
    // volume. The row's `mass` is the button, screw and nut, from its file.
    const button: Row = { type: 'railbutton', mass: 0.002865, materialDensity: 1420 };
    expect(apply(button, 0.000445, 4.6e-7)).toBe('applied');
    expect(button.materialDensity).toBeCloseTo(0.000445 / 4.6e-7, 9);
    expect(button.mass).toBe(0.002865);
  });

  it('applies no mass the desktop gives no volume either, and does not refuse it', () => {
    const row: Row = { type: 'transition', materialDensity: 128, mass: 1 };
    expect(apply(row, 0.00425, null, false)).toBe('degenerate');
    expect(row.materialDensity).toBe(128);
    expect(row.mass).toBeUndefined();
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

/**
 * The run's decision over a whole catalog: one row whose stated mass has no
 * volume to spread over refuses the write and names that row, and a catalog
 * without one is written.
 */
describe('statedMassTally', () => {
  type Part = Row & { mfr: string; partNo: string };
  const tally = (rows: [Part, number | null, number | null, boolean?][]) => {
    const t = statedMassTally();
    for (const [row, mass, volume, desktop] of rows) t.apply(row, mass, () => volume, desktop ?? true);
    return t as { massed: number; degenerate: string[]; refusal: () => string | null };
  };

  it('refuses a catalog with a stated mass the engine gives no volume, naming the part', () => {
    const t = tally([
      [{ type: 'bodytube', mfr: 'Estes', partNo: 'BT-20' }, 0.01, 0.0001],
      [{ type: 'nosecone', mfr: 'SEMROC Astronautics', partNo: ' BC-08542 [R] ' }, 0.00425, 0],
    ]);
    expect(t.massed).toBe(1);
    const refusal = t.refusal();
    expect(refusal).toMatch(/^refusing to write: /);
    expect(refusal).toContain('nosecone SEMROC Astronautics BC-08542 [R] (4.25 g)');
    expect(refusal).not.toContain('BT-20');
  });

  it('writes a catalog whose only no-volume part has none on the desktop either, and lists it', () => {
    const t = tally([
      [{ type: 'bodytube', mfr: 'Estes', partNo: 'BT-20' }, 0.01, 0.0001],
      [{ type: 'transition', mfr: 'SEMROC Astronautics', partNo: 'BC-08542 [R]' }, 0.00425, null, false],
    ]);
    expect(t.refusal()).toBeNull();
    expect(t.degenerate).toEqual(['transition SEMROC Astronautics BC-08542 [R] (4.25 g)']);
  });

  it('writes a catalog whose stated masses all have a volume', () => {
    const t = tally([
      [{ type: 'bodytube', mfr: 'Estes', partNo: 'BT-20' }, 0.01, 0.0001],
      [{ type: 'parachute', mfr: 'Estes', partNo: 'P-12' }, 0.02, null],
      [{ type: 'streamer', mfr: 'Estes', partNo: 'S-1' }, 0.003, null],
    ]);
    expect(t.massed).toBe(2);
    expect(t.refusal()).toBeNull();
  });
});
