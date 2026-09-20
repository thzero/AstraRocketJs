import { describe, it, expect } from 'vitest';
import { parseEng, totalImpulse } from './engParser';

const ENG = `; a comment
; another comment

TC10 24 70 3-5 0.010 0.025 Test Mfr
0 0
0.5 20
1.0 0
`;

describe('totalImpulse', () => {
  it('is 0 for fewer than two samples', () => {
    expect(totalImpulse([])).toBe(0);
    expect(totalImpulse([{ time: 0, thrust: 10 }])).toBe(0);
  });

  it('integrates a curve by the trapezoid rule', () => {
    // triangle peaking at 20 N over 1 s → area 10 Ns
    expect(
      totalImpulse([
        { time: 0, thrust: 0 },
        { time: 0.5, thrust: 20 },
        { time: 1.0, thrust: 0 },
      ]),
    ).toBeCloseTo(10, 6);
  });
});

describe('parseEng', () => {
  it('parses header + samples, converting kg→g', () => {
    const m = parseEng(ENG);
    expect(m.designation).toBe('TC10');
    expect(m.diameter).toBe(24);
    expect(m.length).toBe(70);
    expect(m.manufacturer).toBe('Test Mfr'); // multi-word manufacturer joined
    expect(m.propWeightG).toBeCloseTo(10, 6);
    expect(m.totalWeightG).toBeCloseTo(25, 6);
    expect(m.delays).toEqual([3, 5]);
    expect(m.samples).toHaveLength(3);
    expect(m.source).toBe('eng');
    expect(m.id).toBe('custom:Test Mfr:TC10');
  });

  // Windows Notepad writes a UTF-8 BOM by default, and a .eng shared by a motor
  // maker is exactly the kind of file that has been through it. Without the
  // strip, the BOM glues itself to the leading `;` so the comment no longer
  // matches startsWith(';'), the comment becomes the header, and the import
  // fails with a misleading "Malformed .eng header".
  it('parses a file that carries a UTF-8 BOM', () => {
    const m = parseEng('﻿' + ENG);
    expect(m.designation).toBe('TC10');
    expect(m.diameter).toBe(24);
    expect(m.samples).toHaveLength(3);
  });

  it('derives the NAR impulse class from total impulse (10 Ns → C)', () => {
    expect(parseEng(ENG).class).toBe('C');
  });

  it('strips comment and blank lines', () => {
    // leading comments/blank lines above are ignored; still parses fine
    expect(parseEng(ENG).samples[0]).toEqual({ time: 0, thrust: 0 });
  });

  it('stops reading data at the first non-numeric row (multi-motor file)', () => {
    const twoMotors = `TC10 24 70 3-5 0.010 0.025 Test
0 0
0.5 20
1.0 0
TD20 24 90 4-6 0.02 0.05 Test
0 0
0.5 40
1.0 0`;
    const m = parseEng(twoMotors);
    expect(m.designation).toBe('TC10');
    expect(m.samples).toHaveLength(3); // second motor's header + data not included
  });

  it('treats a non-numeric delay field (e.g. plugged "P") as no delays', () => {
    const plugged = `TP10 24 70 P 0.010 0.025 Test
0 0
0.5 20
1.0 0`;
    expect(parseEng(plugged).delays).toBeUndefined();
  });

  it('throws on too few lines', () => {
    expect(() => parseEng('; only a comment')).toThrow();
    expect(() => parseEng('')).toThrow();
  });

  it('throws on a header with fewer than 7 fields', () => {
    expect(() => parseEng('C6 18 70 0-3\n0 0\n1 0')).toThrow(/header/i);
  });

  it('throws on non-numeric dimensions', () => {
    expect(() => parseEng('C6 xx 70 0-3 0.01 0.02 Estes\n0 0\n1 0')).toThrow(/non-numeric/i);
  });

  it('throws when there are fewer than two thrust samples', () => {
    expect(() => parseEng('C6 18 70 0-3 0.01 0.02 Estes\n0 0')).toThrow(/thrust-curve/i);
  });
});

/**
 * Header values that are finite but physically impossible.
 *
 * `samplesToMotorSpec` rejects a non-positive diameter or length and a prop
 * mass above the total, but NOT a negative prop mass: `masses = total -
 * prop * (impulse / totalImpulse)` then makes the rocket GAIN mass as the
 * motor burns. Only `Number.isFinite` stood in the way.
 */
describe('a .eng header that is finite but impossible', () => {
  const eng = (prop: string, total = '1.0', dia = '54', len = '400') =>
    `M1500 ${dia} ${len} 0 ${prop} ${total} Maker\n0.05 1500\n1.0 1500\n1.2 0\n`;

  it('accepts a sane header', () => {
    expect(() => parseEng(eng('0.5'))).not.toThrow();
  });

  it('rejects negative propellant mass', () => {
    expect(() => parseEng(eng('-0.5'))).toThrow(/propellant/i);
  });

  it('rejects propellant heavier than the loaded motor', () => {
    expect(() => parseEng(eng('2.0', '1.0'))).toThrow(/propellant/i);
  });

  it('rejects a non-positive diameter or length', () => {
    expect(() => parseEng(eng('0.5', '1.0', '0'))).toThrow(/diameter|length/i);
    expect(() => parseEng(eng('0.5', '1.0', '54', '-10'))).toThrow(/diameter|length/i);
  });
});
