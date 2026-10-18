import { describe, it, expect } from 'vitest';
import { offersPlugged, parseDelays } from '../../../src/services/motors/motorPicker';
import { parseEng, totalImpulse } from '../../../src/services/motors/engParser';
import { MAX_CURVE_SAMPLES } from '../../../src/services/motors/curveFinalize';

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
    const m = parseEng(ENG)[0]!;
    expect(m.designation).toBe('TC10');
    expect(m.diameter).toBe(24);
    expect(m.length).toBe(70);
    expect(m.manufacturer).toBe('Test Mfr'); // multi-word manufacturer joined
    expect(m.propWeightG).toBeCloseTo(10, 6);
    expect(m.totalWeightG).toBeCloseTo(25, 6);
    expect(m.delayList).toBe('3,5');
    expect(m.samples).toHaveLength(3);
    expect(m.source).toBe('eng');
    expect(m.id).toBe('custom:Test Mfr:TC10');
  });

  // Windows Notepad writes a UTF-8 BOM by default. Left on, it hides the
  // leading `;`, the comment line reads as the header, and the import fails
  // with a misleading "Malformed .eng header".
  it('parses a file that carries a UTF-8 BOM', () => {
    const m = parseEng('﻿' + ENG)[0]!;
    expect(m.designation).toBe('TC10');
    expect(m.diameter).toBe(24);
    expect(m.samples).toHaveLength(3);
  });

  it('derives the NAR impulse class from total impulse (10 Ns → C)', () => {
    expect(parseEng(ENG)[0]!.class).toBe('C');
  });

  it('strips comment and blank lines', () => {
    expect(parseEng(ENG)[0]!.samples[0]).toEqual({ time: 0, thrust: 0 });
  });

  it('returns every motor in a multi-motor file, each with its own curve', () => {
    // Upstream's RASPMotorLoader returns one motor per header block. The
    // second block follows a comment, as desktop's own files separate them,
    // and the third follows the second's data directly.
    const threeMotors = `; first
TC10-3 24 70 3-5 0.010 0.025 Test
0 0
0.5 20
1.0 0
; second
TD20 24 90 4-6 0.02 0.05 Other Maker
0 0
0.5 40
1.0 0
TE30 29 100 P 0.03 0.07 Test
0 0
1.0 30
2.0 0`;
    const ms = parseEng(threeMotors);
    expect(ms.map((m) => m.designation)).toEqual(['TC10', 'TD20', 'TE30']);
    expect(ms.map((m) => m.id)).toEqual(['custom:Test:TC10', 'custom:Other Maker:TD20', 'custom:Test:TE30']);
    expect(ms[0]!.samples).toEqual([
      { time: 0, thrust: 0 },
      { time: 0.5, thrust: 20 },
      { time: 1, thrust: 0 },
    ]);
    expect(ms[1]!.samples).toEqual([
      { time: 0, thrust: 0 },
      { time: 0.5, thrust: 40 },
      { time: 1, thrust: 0 },
    ]);
    expect(ms[2]!.samples).toEqual([
      { time: 0, thrust: 0 },
      { time: 1, thrust: 30 },
      { time: 2, thrust: 0 },
    ]);
    // Triangles: 20 N * 1 s / 2 = 10 Ns (C), 40 * 1 / 2 = 20 Ns (D), 30 * 2 / 2 = 30 Ns (E).
    expect(ms.map((m) => m.class)).toEqual(['C', 'D', 'E']);
    expect(ms.map((m) => m.diameter)).toEqual([24, 24, 29]);
    expect(ms.map((m) => m.delayList)).toEqual(['3,5', '4,6', 'P']);
    expect(ms[1]!.totalWeightG).toBeCloseTo(50, 9);
  });

  it('refuses the whole file when a later motor is malformed', () => {
    const bad = `TC10 24 70 3-5 0.010 0.025 Test
0 0
0.5 20
1.0 0
; second
TD20 24 90 4-6 0.02 0.05 Test
0 0`;
    expect(() => parseEng(bad)).toThrow(expect.objectContaining({ key: 'errors.motorFile.engNoCurve' }));
  });

  it('keeps a plugged "P" delay field, which is a motor with no ejection charge', () => {
    // The only form that can say plugged, and the one `customToRow` puts in the
    // row's delay column: dropped, the motor would reach the picker with no
    // delays at all and `offersPlugged` could not see it.
    const plugged = `TP10 24 70 P 0.010 0.025 Test
0 0
0.5 20
1.0 0`;
    expect(parseEng(plugged)[0]!.delayList).toBe('P');
  });

  it('drops a sentinel delay rather than flying it, or calling it plugged', () => {
    // RASP's own rule (`RASPMotorLoader`: "Many RASP files have 100 as an only
    // delay"): 99 and over is thrown away. Kept, it is a charge long after the
    // rocket is down; called plugged, it offers a no-ejection-charge motor the
    // file never claimed. RockSim's 1000 does mean plugged, which is why the
    // two formats do not share a rule.
    const sentinel = `TS10 24 70 0-1000 0.010 0.025 Test
0 0
0.5 20
1.0 0`;
    expect(parseEng(sentinel)[0]!.delayList).toBe('0');
  });

  it('reads RASP’s own word for a motor that lists none', () => {
    const none = `TN10 24 70 None 0.010 0.025 Test
0 0
0.5 20
1.0 0`;
    expect(parseEng(none)[0]!.delayList).toBeUndefined();
  });

  it('offers plugged to the picker for such a motor', () => {
    const plugged = `TP10 24 70 3-P 0.010 0.025 Test
0 0
0.5 20
1.0 0`;
    expect(offersPlugged({ delays: parseEng(plugged)[0]!.delayList })).toBe(true);
    expect(parseDelays(parseEng(plugged)[0]!.delayList).delays).toEqual([3]);
  });

  it('imports a two-pulse curve whole, coast and all', () => {
    // Two humps with a zero-thrust coast between them. Nothing about a zero
    // ends the block, and a blank line inside it is skipped the way upstream
    // skips it, so the second pulse is not left out of the motor.
    const twoPulse = `K1000 54 404 P 0.500 1.000 TwoPulse
0.0 0
0.5 1000
1.2 0

3.2 1000
4.5 0`;
    const m = parseEng(twoPulse)[0]!;
    expect(m.samples).toHaveLength(5);
    expect(m.samples[m.samples.length - 1]).toEqual({ time: 4.5, thrust: 0 });
  });

  it('refuses a malformed data line instead of keeping the curve before it', () => {
    // Upstream refuses the whole file (`RASPMotorLoader`: "Data should only
    // have 2 entries"). Stopping there and keeping what came before imports a
    // fragment of a curve as if it were the motor, which on a two-pulse motor
    // is the first pulse flown as the whole thing, and says nothing.
    const stray = `K1000 54 404 P 0.500 1.000 TwoPulse
0.0 0
0.5 1000
1.2
3.2 1000
4.5 0`;
    expect(() => parseEng(stray)).toThrow(/Malformed \.eng data on line 4/);
  });

  it('throws on too few lines', () => {
    expect(() => parseEng('; only a comment')).toThrow();
    expect(() => parseEng('')).toThrow();
  });

  it('throws on a header with fewer than 7 fields', () => {
    expect(() => parseEng('C6 18 70 0-3\n0 0\n1 0')).toThrow(/header/i);
  });

  it('throws on non-numeric dimensions', () => {
    expect(() => parseEng('C6 xx 70 0-3 0.01 0.02 Estes\n0 0\n1 0')).toThrow(
      expect.objectContaining({ key: 'errors.motorFile.engHeaderNumbers' }),
    );
  });

  it('throws when there are fewer than two thrust samples', () => {
    expect(() => parseEng('C6 18 70 0-3 0.01 0.02 Estes\n0 0')).toThrow(/thrust-curve/i);
  });
});

/**
 * Header values that are finite but physically impossible.
 *
 * All of these pass `Number.isFinite`, so the parser checks each one. A
 * negative prop mass is the subtle one: `masses = total - prop * (impulse /
 * totalImpulse)` then makes the rocket gain mass as the motor burns.
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

describe('parseEng refuses what ThrustCurveMotor.Builder.build() refuses', () => {
  it('a negative thrust, naming the motor and its line in the file', () => {
    // Line 6: two comments and a blank line come before the header.
    expect(() => parseEng(ENG.replace('0.5 20', '0.5 -20'))).toThrow(
      expect.objectContaining({ key: 'errors.motorFile.engNegativeThrust', values: { motor: 'TC10', line: 6 } }),
    );
  });

  it('a negative time, naming the motor and its line in the file', () => {
    // Upstream puts a (0, 0) point ahead of a curve that does not start at
    // zero, and the builder then refuses a time that runs backward.
    expect(() => parseEng(ENG.replace('\n0 0\n', '\n-0.1 0\n'))).toThrow(
      expect.objectContaining({ key: 'errors.motorFile.engNegativeTime', values: { motor: 'TC10', line: 5 } }),
    );
  });
});

describe('parseEng designation', () => {
  it('takes the delay off the name, as the .rse reader and upstream do', () => {
    const m = parseEng(ENG.replace('TC10 24', 'C6-5 24'))[0]!;
    expect(m.designation).toBe('C6');
    expect(m.id).toBe('custom:Test Mfr:C6');
    expect(parseEng(ENG.replace('TC10 24', 'C6-P 24'))[0]!.designation).toBe('C6');
    // A dash that is not a delay stays.
    expect(parseEng(ENG.replace('TC10 24', 'G-WIZ 24'))[0]!.designation).toBe('G-WIZ');
  });
});

describe('the sample ceiling', () => {
  // The one `.rse` is held to: every sample lands in the stored custom-motor
  // blob, which is parsed on every picker open and `.ork` save.
  const eng = (n: number) =>
    'X1 24 70 0 0.010 0.025 Test\n' + Array.from({ length: n }, (_, i) => `${i * 0.001} 10`).join('\n') + '\n';

  it('refuses a motor with more data points than MAX_CURVE_SAMPLES', () => {
    expect(() => parseEng(eng(MAX_CURVE_SAMPLES + 1))).toThrow(/more than .* data points/i);
  });

  it('accepts a curve at the ceiling', () => {
    expect(parseEng(eng(MAX_CURVE_SAMPLES))[0]!.samples).toHaveLength(MAX_CURVE_SAMPLES);
  });
});

describe('parseEng finalizes the curve before its totals', () => {
  it('adds the opening ramp from t = 0, as RASPMotorLoader does', () => {
    // Finalized: (0, 0), (1, 36), (1.5, 0). Impulse 0.5*1*36 + 0.5*0.5*36 =
    // 27 Ns, an E; the raw samples alone give 9 Ns, a C.
    const m = parseEng('X1 18 70 0 0.010 0.030 T\n1.0 36\n1.5 0\n')[0]!;
    expect(m.samples[0]).toEqual({ time: 0, thrust: 0 });
    expect(totalImpulse(m.samples)).toBeCloseTo(27, 9);
    expect(m.class).toBe('E');
  });

  it('sorts samples listed out of order', () => {
    const m = parseEng('X1 18 70 0 0.010 0.030 T\n0 0\n1.5 0\n1.0 36\n')[0]!;
    expect(m.samples.map((p) => p.time)).toEqual([0, 1, 1.5]);
  });
});
