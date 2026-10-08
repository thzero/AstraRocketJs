import { describe, it, expect } from 'vitest';
import { keyOf } from '../../../src/services/motors/motorKey';
// @ts-expect-error - a plain .mjs build script helper, no types
import { motorRowKey, collidingRowKeys } from '../../../scripts/lib/motorRowKey.mjs';
import type { CatalogMotor } from '../../../src/services/motors/motorDb';

/**
 * The catalog row key exists twice, and this holds the two equal.
 *
 * `keyOf` is the dashboard row key and the selection identity: two motors with
 * the same key select, check and highlight as one. The sync script has to
 * detect collisions BEFORE publishing, and it is a plain `.mjs` with no TS
 * loader, so it cannot import `keyOf`. Rather than let a hand-written copy
 * drift, the copy lives in one place and this test pins it to the original.
 *
 * There was a third copy: the publish workflow spelled the expression inline,
 * in a Summary step that printed a warning, never failed the job, and ran AFTER
 * the publish. The gate is `assertSane` now.
 */
const motor = (o: Partial<CatalogMotor>): CatalogMotor =>
  ({ manufacturer: 'Estes', designation: 'C6', diameter: 0.018, code: 'C6', ...o }) as CatalogMotor;

describe('the motor row key has one definition', () => {
  const cases: CatalogMotor[] = [
    motor({}),
    motor({ code: undefined }), // no code: the `?? ''` branch
    motor({ manufacturer: 'LOC/Precision', designation: '1/2A3' }), // the slash families
    motor({ diameter: 0.0295 }), // a diameter that is not a round number
    motor({ designation: 'H128W', code: 'H128' }),
    motor({ manufacturer: '', designation: '', diameter: 0, code: '' }), // degenerate
  ];

  it('agrees with the app for every shape the catalog carries', () => {
    for (const m of cases) {
      expect(motorRowKey(m), JSON.stringify(m)).toBe(keyOf(m));
    }
  });

  it('treats a missing code and an empty code as the same key, as the app does', () => {
    // Not a nicety: the `?? ''` is what makes this true, and if the two copies
    // disagreed about it they would disagree about every curve-less motor.
    expect(motorRowKey(motor({ code: undefined }))).toBe(motorRowKey(motor({ code: '' })));
    expect(keyOf(motor({ code: undefined }))).toBe(keyOf(motor({ code: '' })));
  });
});

describe('collidingRowKeys', () => {
  it('finds nothing in a clean catalog', () => {
    expect(collidingRowKeys([motor({ designation: 'A' }), motor({ designation: 'B' })])).toEqual([]);
  });

  it('names each colliding key once, however many motors share it', () => {
    const dupe = motor({ designation: 'X' });
    expect(collidingRowKeys([dupe, dupe, dupe, motor({ designation: 'Y' })])).toEqual([keyOf(dupe)]);
  });

  it('separates motors that differ only in code', () => {
    // The field that was added to `keyOf` because 14 real catalog pairs collide
    // on manufacturer, designation and diameter alone.
    expect(collidingRowKeys([motor({ code: 'C6-3' }), motor({ code: 'C6-5' })])).toEqual([]);
  });

  it('is what refuses a publish, so it must see a real collision', () => {
    const a = motor({ manufacturer: 'A', designation: 'X', diameter: 0.018, code: undefined });
    const b = motor({ manufacturer: 'A', designation: 'X', diameter: 0.018, code: '' });
    // Same key via the `?? ''` branch: exactly the pair a hand-written copy
    // without that branch would have let through.
    expect(collidingRowKeys([a, b])).toEqual([keyOf(a)]);
  });
});
