// Parser for RASP `.eng` motor files (the common thrust-curve exchange format).
// A .eng file is one or more motors, each a header line followed by
// "time thrust" data pairs, with comment lines starting with ';' anywhere.
// Header fields (whitespace-separated):
//
//   designation  diameter(mm)  length(mm)  delays  propWeight(kg)  totalWeight(kg)  manufacturer
//
// e.g.  C6  18  70  0-3-5-7  0.0108  0.0242  Estes
//
// Every motor in the file is returned, as upstream's RASPMotorLoader returns
// them; one bad motor refuses the whole file, as it does there.
import type { CustomMotor } from './motorStore';
// The one impulse classifier, shared with the Motor Dashboard, so a motor gets
// the same class on every screen (a 0.75 N-s MicroMaxx is a 1/2A, not an A).
import { impulseClass } from './motorCombine';
import { trapezoidImpulse } from './motorMath';
import { removeDelay } from './rseParser';
import { MAX_CURVE_SAMPLES, finalizeCurve } from './curveFinalize';
import { delayList } from './motorPicker';
import { KeyedError } from '../../i18n/keyedError';

/** Total impulse (Ns) of a thrust curve by the trapezoid rule. */
export function totalImpulse(samples: { time: number; thrust: number }[]): number {
  return trapezoidImpulse(
    samples.map((s) => s.time),
    samples.map((s) => s.thrust),
  );
}

/** One non-blank, non-comment line and its 1-based line number in the file. */
interface Line {
  text: string;
  no: number;
}

/**
 * Every motor in a `.eng` file.
 *
 * A list, as `parseRse` returns: a RASP file can carry a manufacturer's range,
 * one header block per motor, and each header names its own motor.
 */
export function parseEng(text: string): CustomMotor[] {
  const lines: Line[] = text
    .split(/\r?\n/)
    .map((l, i) => ({ text: l.trim(), no: i + 1 }))
    .filter((l) => l.text && !l.text.startsWith(';'));
  if (lines.length < 2) throw new KeyedError('errors.motorFile.engNoData');

  const motors: CustomMotor[] = [];
  let i = 0;
  while (i < lines.length) {
    const { motor, next } = parseMotor(lines, i);
    motors.push(motor);
    i = next;
  }
  return motors;
}

/** The motor whose header is `lines[at]`, and the index of the line after its data. */
function parseMotor(lines: readonly Line[], at: number): { motor: CustomMotor; next: number } {
  const header = lines[at]!.text.split(/\s+/);
  if (header.length < 7) {
    throw new KeyedError('errors.motorFile.engHeader');
  }
  const [rawDesignation, diaS, lenS, delaysS, propS, totalS, ...mfr] = header;
  // The delay comes off the name, as upstream's RASPMotorLoader and this app's
  // .rse reader take it: `C6-5` is the C6, and the delay is carried in the
  // delay field. Kept on, one motor would have two ids by file format and seat
  // as `C6-5-5`.
  const designation = removeDelay(rawDesignation!);
  const diameter = Number(diaS);
  const length = Number(lenS);
  const propKg = Number(propS);
  const totalKg = Number(totalS);
  if (![diameter, length, propKg, totalKg].every(Number.isFinite)) {
    throw new KeyedError('errors.motorFile.engHeaderNumbers');
  }
  // Finite is not enough. `samplesToMotorSpec` rejects a non-positive diameter
  // or length and a prop mass above the total, but not a negative prop mass:
  // `masses = total - prop*(impulse/totalImpulse)` then makes the rocket gain
  // mass as the motor burns.
  if (!(diameter > 0) || !(length > 0)) {
    throw new KeyedError('errors.motorFile.engHeaderSize');
  }
  if (!(propKg >= 0) || !(totalKg > 0) || propKg > totalKg) {
    throw new KeyedError('errors.motorFile.engHeaderMass');
  }

  // Through the shared reader, which is what the catalog's delay column is and
  // the only form that can say plugged. `customToRow` reads `delayList` and
  // nothing else, so a field that failed to parse here would reach the picker
  // with no delays at all.
  const delays = delayList(delaysS, 'rasp');

  // A data line is a time and a thrust, and nothing else is tolerated inside
  // the block. Upstream (`RASPMotorLoader`) refuses the whole file on anything
  // else, and so does this: stopping at a bad line would import the fragment of
  // a curve before it, which on a two-pulse motor flies the first pulse as the
  // whole motor.
  //
  // The one line that legitimately ends the block is the next motor's header,
  // which is why its 7 fields are the only non-data line that stops rather than
  // throws (comments and blanks are already gone).
  const raw: { time: number; thrust: number }[] = [];
  let i = at + 1;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const fields = line.text.split(/\s+/);
    if (fields.length >= 7) break; // the next motor's header
    const [t, f] = fields.map(Number);
    if (fields.length !== 2 || !Number.isFinite(t) || !Number.isFinite(f)) {
      throw new KeyedError('errors.motorFile.engDataLine', { line: line.no, text: line.text });
    }
    // ThrustCurveMotor refuses a negative thrust, and a negative time, which
    // gets a zero point put ahead of it and so runs backward. The bridge
    // builds every seated motor through it, so the file is refused here as
    // desktop drops it.
    if (f! < 0) throw new KeyedError('errors.motorFile.engNegativeThrust', { motor: designation, line: line.no });
    if (t! < 0) throw new KeyedError('errors.motorFile.engNegativeTime', { motor: designation, line: line.no });
    // The ceiling `.rse` is held to, counted as the lines are read so a huge
    // file is refused before its samples are all in memory.
    if (raw.length >= MAX_CURVE_SAMPLES) {
      throw new KeyedError('errors.motorFile.engTooManyPoints', { motor: designation, max: MAX_CURVE_SAMPLES });
    }
    raw.push({ time: t!, thrust: f! });
  }
  // Finalized before anything is read from it, as desktop's RASPMotorLoader
  // and the .rse reader do: a curve that opens at (0.05 s, 40 N) gains its
  // ramp from zero, and the impulse, class and burn time count it.
  const samples = finalizeCurve(raw);
  if (samples.length < 2) throw new KeyedError('errors.motorFile.engNoCurve');

  const manufacturer = mfr.join(' ') || 'Custom';
  return {
    motor: {
      id: `custom:${manufacturer}:${designation}`,
      designation,
      manufacturer,
      class: impulseClass(totalImpulse(samples)),
      diameter,
      length,
      totalWeightG: totalKg * 1000,
      propWeightG: propKg * 1000,
      delayList: delays,
      samples,
      source: 'eng',
    },
    next: i,
  };
}
