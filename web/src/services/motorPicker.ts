// Pure helpers for the motor picker / detail — extracted from the components so
// they're unit-testable without rendering. No React, no DOM.

// Standard motor diameters (mm) — the stops on the range slider.
export const STD_DIAMS = [6, 13, 18, 24, 29, 38, 54, 75, 98, 150];
export const MAX_IDX = STD_DIAMS.length - 1;

// A motor "fits" a mount whose bore is this many mm under the motor's nominal
// diameter (covers the nominal-vs-bore rounding gap without leaking the next size).
export const FIT_TOLERANCE_MM = 1;

/** Slider index of the largest standard diameter fitting a mount of this bore (mm). */
export function fitIdx(bore: number): number {
  let i = 0;
  while (i < MAX_IDX && STD_DIAMS[i + 1]! <= bore + FIT_TOLERANCE_MM) i++;
  return i;
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
