import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The two delay boxes that committed a value when they were CLEARED.
 *
 * `MotorDialog`'s custom ejection delay stored a 0-second charge and
 * `MotorRow`'s ignition delay stored a 0-second air-start, both from
 * `clampEntry(parseFloat(e.target.value), ...) ?? 0` firing on an empty field.
 * They were the last two data-entry boxes in the app not using `NumberInput`,
 * whose draft buffer exists for this.
 *
 * Source-level and node-env, like `simBounds.test.ts`: the defect is the SHAPE of
 * the input, and `delayEntry.test.tsx` covers the behavior it was replaced with.
 */
const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../src/${rel}`, import.meta.url)), 'utf8');

const DELAY_BOXES = ['components/sim/MotorDialog.tsx', 'components/sim/MotorRow.tsx'];

describe('the two delay boxes go through NumberInput', () => {
  it('uses the component rather than a raw input', () => {
    for (const rel of DELAY_BOXES) {
      expect(src(rel), rel).toContain('NumberInput');
      // The shape that committed the zero. `clampEntry(...) ?? 0` is still fine
      // for a display-only setting (CSV decimals, path stride); it is not fine
      // for a value the kernel flies.
      expect(src(rel), rel).not.toMatch(/parseFloat\(e\.target\.value\)/);
    }
  });

  it('treats a blank box as no change', () => {
    for (const rel of DELAY_BOXES) {
      expect(src(rel), rel).toMatch(/if \(v !== null\)/);
    }
  });
});
