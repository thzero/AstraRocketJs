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

const CLASS_LETTERS = 'ABCDEFGHIJKLMNO';

/** NAR/TRA impulse class letter from total impulse (Ns): A ≤ 2.5, doubling. */
function impulseClass(ns: number): string {
  if (ns <= 0) return '?';
  const i = Math.min(CLASS_LETTERS.length - 1, Math.max(0, Math.ceil(Math.log2(ns / 2.5))));
  return CLASS_LETTERS[i]!;
}

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

  const delays = delaysS!.split('-').map(Number).filter(Number.isFinite);

  const samples: { time: number; thrust: number }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const [t, f] = lines[i]!.split(/\s+/).map(Number);
    if (!Number.isFinite(t) || !Number.isFinite(f)) break; // end of this motor's data
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
    delays: delays.length ? delays : undefined,
    samples,
    source: 'eng',
  };
}
