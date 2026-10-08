import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The two delay boxes must not commit a value when they are cleared.
 *
 * `MotorDialog`'s custom ejection delay and `MotorRow`'s ignition delay go
 * through `NumberInput`, whose draft buffer exists for this. With
 * `clampEntry(parseFloat(e.target.value), ...) ?? 0` on a raw input, an empty
 * field would store a 0-second charge or a 0-second air-start.
 *
 * Source-level and node-env, like `simBounds.test.ts`: the defect is the shape of
 * the input, and `delayEntry.test.tsx` covers the behavior.
 */
const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../src/${rel}`, import.meta.url)), 'utf8');

const DELAY_BOXES = ['components/sim/MotorDialog.tsx', 'components/sim/MotorRow.tsx'];

describe('the two delay boxes go through NumberInput', () => {
  it('uses the component rather than a raw input', () => {
    for (const rel of DELAY_BOXES) {
      expect(src(rel), rel).toContain('NumberInput');
      // The shape that commits the zero. `clampEntry(...) ?? 0` is fine
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
