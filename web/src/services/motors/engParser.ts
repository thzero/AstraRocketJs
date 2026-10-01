// Parser for RASP `.eng` motor files (the common thrust-curve exchange format).
// A .eng file is: comment lines starting with ';', then a header line, then
// "time thrust" data pairs. Header fields (whitespace-separated):
//
//   designation  diameter(mm)  length(mm)  delays  propWeight(kg)  totalWeight(kg)  manufacturer
//
// e.g.  C6  18  70  0-3-5-7  0.0108  0.0242  Estes
//
// We parse the FIRST motor definition in the file (single-motor imports are the
// norm); data parsing stops at the first non-numeric line.
import type { CustomMotor } from './motorStore';
// ONE classifier, shared with the Motor Dashboard. The private copy that used
// to live here clamped every sub-A impulse to index 0 and so labeled a 0.75
// N-s MicroMaxx an "A", while the shared one called the same motor "below A".
// Same motor, two different classes depending on which screen you were on.
import { impulseClass } from './motorCombine';
import { delayList } from './motorPicker';

/** Total impulse (Ns) of a thrust curve by the trapezoid rule. */
export function totalImpulse(samples: { time: number; thrust: number }[]): number {
  let s = 0;
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i]!.time - samples[i - 1]!.time;
    s += (dt * (samples[i]!.thrust + samples[i - 1]!.thrust)) / 2;
  }
  return s;
}

export function parseEng(text: string): CustomMotor {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith(';'));
  if (lines.length < 2) throw new Error('Not a valid .eng file (no motor data found).');

  const header = lines[0]!.split(/\s+/);
  if (header.length < 7) {
    throw new Error(
      'Malformed .eng header — expected: designation diameter length delays propWeight totalWeight manufacturer.',
    );
  }
  const [designation, diaS, lenS, delaysS, propS, totalS, ...mfr] = header;
  const diameter = Number(diaS);
  const length = Number(lenS);
  const propKg = Number(propS);
  const totalKg = Number(totalS);
  if (![diameter, length, propKg, totalKg].every(Number.isFinite)) {
    throw new Error('Malformed .eng header — non-numeric diameter/length/weight.');
  }
  // Finite is not enough. `samplesToMotorSpec` rejects a non-positive diameter
  // or length and a prop mass above the total, but NOT a negative prop mass:
  // `masses = total - prop*(impulse/totalImpulse)` then makes the rocket GAIN
  // mass as the motor burns.
  if (!(diameter > 0) || !(length > 0)) {
    throw new Error('Malformed .eng header — diameter and length must be positive.');
  }
  if (!(propKg >= 0) || !(totalKg > 0) || propKg > totalKg) {
    throw new Error('Malformed .eng header — propellant mass must be between 0 and the total mass.');
  }

  // Through the shared reader, which is what the catalog's delay column is and
  // the only form that can say plugged. Splitting on '-' and dropping anything
  // non-numeric lost the whole field for a plugged motor, and `customToRow`
  // reads `delayList` and nothing else, so an imported `.eng` arrived at the
  // picker with no delays at all.
  const delays = delayList(delaysS, 'rasp');

  // A data line is a time and a thrust, and nothing else is tolerated inside
  // the block. Upstream (`RASPMotorLoader`) refuses the whole file on anything
  // else; this stopped at it and kept what it had, so a file with one bad line
  // imported as the fragment of a curve before it, with no complaint. On a
  // two-pulse motor that is the first pulse flown as the whole motor.
  //
  // The one line that legitimately ends the block is the NEXT motor's header,
  // which is why its 7 fields are the only non-data line that stops rather than
  // throws (comments and blanks are already gone).
  const samples: { time: number; thrust: number }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = lines[i]!.split(/\s+/);
    if (fields.length >= 7) break; // the next motor in a multi-motor file
    const [t, f] = fields.map(Number);
    if (fields.length !== 2 || !Number.isFinite(t) || !Number.isFinite(f)) {
      throw new Error(`Malformed .eng data on line ${i + 1} — expected a time and a thrust, got "${lines[i]}".`);
    }
    samples.push({ time: t!, thrust: f! });
  }
  if (samples.length < 2) throw new Error('.eng file has no thrust-curve data points.');

  const manufacturer = mfr.join(' ') || 'Custom';
  return {
    id: `custom:${manufacturer}:${designation}`,
    designation: designation!,
    manufacturer,
    class: impulseClass(totalImpulse(samples)),
    diameter,
    length,
    totalWeightG: totalKg * 1000,
    propWeightG: propKg * 1000,
    delayList: delays,
    samples,
    source: 'eng',
  };
}
