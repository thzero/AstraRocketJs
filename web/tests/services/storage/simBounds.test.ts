import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS, SIM_BOUNDS } from '../../../src/services/storage/settings';

/**
 * The solver bounds, and the reason they are a shared constant.
 *
 * `maxTime / timeStep` is the RK4 iteration count, so both ends need a cap on
 * every surface that can set them. Uncapped, `1000000` asks for tens of millions
 * of steps with nothing to interrupt it. The global Settings row and the
 * per-simulation override read one shared bound, so the two cannot drift apart.
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
    // constant. A literal here would let them drift apart.
    for (const rel of ['components/layout/SettingsDialog.tsx', 'components/sim/SimEditor.tsx']) {
      const text = src(rel);
      expect(text, rel).toContain('SIM_BOUNDS');
      // The bounds as bare literals.
      expect(text, rel).not.toMatch(/max=\{10000\}/);
      expect(text, rel).not.toMatch(/max=\{10\}/);
    }
  });

  it('gives the per-simulation override the same ceiling as the global row', () => {
    // Read from the source rather than rendered, because the failure is a
    // missing prop: a render test that does not know to look for `max` passes
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
