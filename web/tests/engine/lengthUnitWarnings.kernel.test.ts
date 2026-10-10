import { describe, expect, it, vi } from 'vitest';
import { KERNEL_TEST_TIMEOUT_MS } from '../testing/kernelTimeout';
import { loadEngine } from '../testing/kernelGeometry';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * The kernel decides an airframe diameter step by comparing the two diameters
 * as text in its display length unit (BarrowmanStabilityCalculator), as desktop
 * does in the unit its user has chosen. So the unit the app sets decides the
 * warning: a 0.1 mm step on a 4 in airframe reads "10.2 cm" on both sides, and
 * "4.000 in" against "4.004 in".
 */
describe('the airframe-step warning follows the length unit', () => {
  const design = {
    components: [
      {
        type: 'stage',
        id: 'st',
        children: [
          { type: 'nosecone', id: 'n', shape: 'ogive', length: 0.3, aftRadius: 0.0508, thickness: 0.002 },
          // 0.05 mm wider in radius: a 0.1 mm diameter step.
          { type: 'bodytube', id: 'b', length: 0.8, outerRadius: 0.05085, thickness: 0.001 },
        ],
      },
    ],
  };

  const stepWarned = (engine: {
    reset: () => void;
    buildRocket: (s: string) => number;
    getStaticInfo: (h: number) => string;
  }) => {
    engine.reset();
    const info = JSON.parse(engine.getStaticInfo(engine.buildRocket(JSON.stringify(design)))) as {
      warningTexts: string[];
    };
    return info.warningTexts.some((w) => /discontinuity/i.test(w));
  };

  it('warns in inches and not in centimeters', async () => {
    const engine = await loadEngine();
    engine.setLengthUnit('cm');
    expect(stepWarned(engine)).toBe(false);
    engine.setLengthUnit('in');
    expect(stepWarned(engine)).toBe(true);
    engine.setLengthUnit('cm');
  });

  it('keeps the unit for a symbol it does not know', async () => {
    const engine = await loadEngine();
    engine.setLengthUnit('in');
    engine.setLengthUnit('furlong');
    expect(stepWarned(engine)).toBe(true);
    engine.setLengthUnit('cm');
  });
});
