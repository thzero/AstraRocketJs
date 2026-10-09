// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mathEquals } from '../../../src/services/motors/mathEquals';
import { parseRse } from '../../../src/services/motors/rseParser';
import { rowsDigest } from '../../../src/services/files/ork/embeddedMotors';

/**
 * MathUtil.equals, which desktop's finalizeThrustCurve compares with: relative
 * to `b`, with a half-epsilon test near zero.
 */
describe('mathEquals', () => {
  it('is relative to b away from zero', () => {
    expect(mathEquals(100, 100 + 5e-7)).toBe(true); // 5e-9 relative
    expect(mathEquals(1, 1 + 5e-6)).toBe(false); // 5e-6 relative
  });

  it('tests against half an epsilon near zero', () => {
    expect(mathEquals(4e-9, 0)).toBe(true);
    expect(mathEquals(6e-9, 0)).toBe(false);
  });
});

describe('the curve finalizers compare as the desktop does', () => {
  it('keeps two .rse samples 5 microseconds apart, as the desktop loader does', () => {
    const xml = `<engine-database><engine-list>
      <engine mfg="T" code="A1" dia="18" len="70" initWt="20" propWt="10">
        <data>
          <eng-data t="0" f="0"/>
          <eng-data t="1.0" f="5"/>
          <eng-data t="1.000005" f="5"/>
          <eng-data t="2.0" f="0"/>
        </data>
      </engine></engine-list></engine-database>`;
    expect(parseRse(xml)[0]!.samples.map((s) => s.time)).toEqual([0, 1, 1.000005, 2]);
  });

  it('drops a repeat within MathUtil.equals of a late sample before hashing', () => {
    const row = (t: number, f: number) => ({ t, f, m: 0.01, cg: 0.05 });
    const withRepeat = [row(0, 0), row(100, 5), row(100 + 5e-7, 5), row(101, 0)];
    const without = [row(0, 0), row(100, 5), row(101, 0)];
    expect(rowsDigest(withRepeat)).toBe(rowsDigest(without));
  });
});
