import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS, SIM_BOUNDS } from '../../../src/services/storage/settings';

/**
 * The solver bounds, and the reason they are a shared constant.
 *
 * `maxTime / timeStep` IS the RK4 iteration count. The global Settings row
 * capped both ends and the per-simulation override capped neither, so one of
 * the two surfaces that can set the value let `1000000` through, which asks for
 * tens of millions of steps with nothing to interrupt it. Two copies of a bound
 * is the bug; this pins that there is now one.
 */
describe('SIM_BOUNDS', () => {
  const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../src/${rel}`, import.meta.url)), 'utf8');

  it('brackets every default it governs', () => {
    const s = DEFAULT_SETTINGS.simulation;
    for (const k of ['timeStep', 'maxTime', 'maxAngleStep'] as const) {
      expect(s[k], k).toBeGreaterThanOrEqual(SIM_BOUNDS[k].min);
      expect(s[k], k).toBeLessThanOrEqual(SIM_BOUNDS[k].max);
    }
  });

  it('keeps the iteration count finite at the worst legal combination', () => {
    // The whole point of capping both ends: the product has to stay somewhere a
    // browser can actually finish.
    expect(SIM_BOUNDS.maxTime.max / SIM_BOUNDS.timeStep.min).toBeLessThanOrEqual(10_000_000);
  });

  it('is the only place either surface spells the bound', () => {
    // Both the global row and the per-simulation override must read the shared
    // constant. A literal here is how they drifted apart in the first place.
    for (const rel of ['components/layout/SettingsDialog.tsx', 'components/sim/SimEditor.tsx']) {
      const text = src(rel);
      expect(text, rel).toContain('SIM_BOUNDS');
      // The three values the override used to be missing, as bare literals.
      expect(text, rel).not.toMatch(/max=\{10000\}/);
      expect(text, rel).not.toMatch(/max=\{10\}/);
    }
  });

  it('gives the per-simulation override the same ceiling as the global row', () => {
    // Read from the source rather than rendered, because the failure was a
    // MISSING prop: a render test that does not know to look for `max` passes
    // either way. Both rows must carry a max for all three fields.
    const editor = src('components/sim/SimEditor.tsx');
    expect((editor.match(/max=\{SIM_BOUNDS\./g) ?? []).length).toBeGreaterThanOrEqual(2);
    // The angle one goes through the FieldUnit rather than an inline conversion,
    // the same way the global row resolves it: the bound still comes from
    // SIM_BOUNDS, in whatever angle unit the user is working in.
    expect(editor).toMatch(/max=\{angle\.toUi\(SIM_BOUNDS\.maxAngleStep\.max\)\}/);
    expect(editor, 'the inline * 180 / Math.PI is what the unit scope replaced').not.toContain('* 180) / Math.PI');
  });
});
