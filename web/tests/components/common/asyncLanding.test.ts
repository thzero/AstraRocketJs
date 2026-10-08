import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The surfaces whose async callbacks could land on the wrong rows, each checked
 * for the guard.
 *
 * Source-level, and node-env rather than jsdom for the same reason
 * `simBounds.test.ts` is: the failure is an absent guard, and a render test that
 * does not know to simulate a slow resolve passes either way. Each of these
 * awaits something the user can outlive (a file read, a browser permission
 * prompt, an IndexedDB round trip) and then calls an `onChange` that writes to
 * whatever rows are the current edit targets.
 *
 * `useLatest.test.tsx` covers the hook itself.
 */
const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../src/${rel}`, import.meta.url)), 'utf8');

const GUARDED = [
  'components/sim/LaunchPanel.tsx',
  'components/sim/WindProfileDialog.tsx',
  'components/sim/MotorDialog.tsx',
  'components/canvas/useExportTemplates.ts',
];

describe('the surfaces that resolve after an await carry a generation guard', () => {
  it('claims a generation in each one', () => {
    for (const rel of GUARDED) {
      expect(src(rel), rel).toContain('useLatest');
      expect(src(rel), rel).toMatch(/\.claim\(\)/);
    }
  });

  it('checks the claim, because one nobody tests is decoration', () => {
    for (const rel of GUARDED) {
      expect(src(rel), rel).toMatch(/if \(!mine\(\)\) return/);
    }
  });

  it('gives MotorDialog a separate pick guard, which is a separate attempt', () => {
    // An import and a motor pick must not cancel each other, so the dialog has
    // two tokens on purpose.
    const text = src('components/sim/MotorDialog.tsx');
    expect(text).toMatch(/const pickWrite = useLatest\(\)/);
    expect(text).toMatch(/const catalogWrite = useLatest\(\)/);
    expect(text).toContain('pickWrite.claim()');
  });
});
