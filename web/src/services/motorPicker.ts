// Pure helpers for the motor picker / detail — extracted from the components so
// they're unit-testable without rendering. No React, no DOM.

// Standard motor diameters (mm) — the stops on the range slider.
export const STD_DIAMS = [6, 13, 18, 24, 29, 38, 54, 75, 98, 150];
export const MAX_IDX = STD_DIAMS.length - 1;

// A motor "fits" a mount whose bore is this many mm under the motor's nominal
// diameter (covers the nominal-vs-bore rounding gap without leaking the next size).
// The same slack applies to length, where the catalog's millimeters are rounded
// too: a 70 mm motor is not kept out of exactly 70 mm of tube by float noise.
const FIT_TOLERANCE_MM = 1;

/**
 * The slider stop for the largest standard diameter that fits this bore (mm).
 *
 * Which stop the "fits the mount" box pulls the diameter ceiling down to, so the
 * restriction is a thing you can SEE on the slider rather than a hidden rule.
 */
export function fitIdx(bore: number): number {
  let i = 0;
  while (i < MAX_IDX && STD_DIAMS[i + 1]! <= bore + FIT_TOLERANCE_MM) i++;
  return i;
}

/**
 * The hole a motor has to go into, in millimeters.
 *
 * `maxLength` is the mount tube's own length PLUS its motor overhang, because
 * that is how far a motor is actually allowed to reach: the app seats one at
 * `aft - motorLength + overhang` (see rocketPieces), so a 70 mm motor in a 65 mm
 * tube with the default 6.35 mm overhang genuinely does fit, and a filter that
 * measured against the bare tube would hide a motor the rocket can fly. Absent
 * when the mount's length cannot be read, in which case only the bore is judged.
 */
export interface MountFit {
  /** Inner diameter of the mount tube. */
  bore: number;
  maxLength?: number;
}

/**
 * Will this motor go in that mount?
 *
 * A motor whose length the catalog never recorded is judged on bore ALONE rather
 * than hidden: every one of the bundled rows carries a length, but a motor
 * imported from an `.eng` need not, and dropping it from the list would be a
 * guess dressed up as a measurement. Both bounds carry the rounding slack above.
 */
export function motorFitsMount(m: { diameter: number; length?: number }, fit: MountFit): boolean {
  if (m.diameter > fit.bore + FIT_TOLERANCE_MM) return false;
  if (fit.maxLength != null && m.length != null && m.length > fit.maxLength + FIT_TOLERANCE_MM) return false;
  return true;
}

/** Parse a motor's delay string ("4,6,7,8,10" / "0-3-5-7" / "P") into its numeric
 *  delay options and whether it offers a plugged (no-ejection) choice. */
export function parseDelays(s?: string): { delays: number[]; plugged: boolean } {
  if (!s) return { delays: [], plugged: false };
  let plugged = false;
  const delays: number[] = [];
  for (const tok of s.split(/[,\s-]+/)) {
    if (!tok) continue;
    if (/^p/i.test(tok)) {
      plugged = true;
      continue;
    } // "P" / "Plugged"
    const n = Number(tok);
    if (Number.isFinite(n)) delays.push(n);
  }
  return { delays: [...new Set(delays)].sort((a, b) => a - b), plugged };
}

/**
 * Does the manufacturer list this motor as available PLUGGED (no ejection
 * charge)?
 *
 * What the spec says, not what is possible: any motor can be flown plugged, and
 * the picker's delay control offers exactly that on every one of them, for
 * staging and for electronically triggered recovery. So this is for the other
 * question - finding the motors BUILT without an ejection charge, which is 381
 * of the 815 bundled rows, and 374 of those have no numeric delay at all
 * (mostly reloads and hybrids).
 */
export function offersPlugged(m: { delays?: string }): boolean {
  return parseDelays(m.delays).plugged;
}

/** Mean thrust over the first `win` seconds (trapezoid, clipped to the window). */
export function initialThrust(samples: [number, number][], win = 0.5): number | null {
  if (samples.length < 2) return null;
  let imp = 0,
    dur = 0;
  for (let i = 1; i < samples.length; i++) {
    const [t0, f0] = samples[i - 1]!;
    let [t1, f1] = samples[i]!;
    if (t0 >= win) break;
    if (t1 > win) {
      f1 = f0 + (f1 - f0) * ((win - t0) / (t1 - t0));
      t1 = win;
    }
    imp += ((t1 - t0) * (f0 + f1)) / 2;
    dur += t1 - t0;
  }
  return dur > 0 ? imp / dur : null;
}
