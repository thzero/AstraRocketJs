import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The import path uses the BATCH write, not a loop over single adds.
 *
 * Source-level, and node-env: `importCustomMotors` also refreshes the catalog over
 * the network, which a unit test has no business reaching, and the loop is the
 * defect. `lowFindings.test.ts` covers what the batch write itself does.
 */
const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../src/${rel}`, import.meta.url)), 'utf8');

describe('the custom-motor import is one write', () => {
  it('hands the whole list to addCustomMotors', () => {
    expect(src('services/motors/motorDb.ts')).toContain('addCustomMotors(motors)');
  });

  it('no longer loops a single add per motor', () => {
    // The quadratic shape: one read-modify-write per motor, each parsing and
    // re-serializing the entire stored array.
    expect(src('services/motors/motorDb.ts')).not.toMatch(/for \(const m of motors\) await/);
  });
});
