import { describe, it, expect } from 'vitest';
import {
  STD_DIAMS,
  fitIdx,
  motorFitsMount,
  offersPlugged,
  parseDelays,
  initialThrust,
} from '../../src/services/motorPicker';

describe('fitIdx', () => {
  it('picks the largest standard diameter that fits the bore (+1mm tolerance)', () => {
    expect(STD_DIAMS[fitIdx(17.6)]).toBe(18); // default 18mm mount bore → 18
    expect(STD_DIAMS[fitIdx(24)]).toBe(24);
    expect(STD_DIAMS[fitIdx(5)]).toBe(6); // never below the smallest
    expect(STD_DIAMS[fitIdx(999)]).toBe(150); // clamps to the largest
  });
});

describe('motorFitsMount', () => {
  // A 24 mm mount tube 70 mm long, with OpenRocket's default 6.35 mm overhang.
  const mount = { bore: 24, maxLength: 76.35 };

  it('keeps a motor that goes in the bore and refuses one that does not', () => {
    expect(motorFitsMount({ diameter: 24, length: 70 }, mount)).toBe(true);
    expect(motorFitsMount({ diameter: 18, length: 70 }, mount)).toBe(true);
    expect(motorFitsMount({ diameter: 29, length: 70 }, mount)).toBe(false);
  });

  it('allows a motor to reach into the overhang, which is what the overhang is', () => {
    // 75 mm of motor in 70 mm of tube: it hangs 5 mm out of the aft end, which
    // is where the app already draws it. Measured against the bare tube this
    // would have been hidden, and the rocket flies it.
    expect(motorFitsMount({ diameter: 24, length: 75 }, mount)).toBe(true);
    expect(motorFitsMount({ diameter: 24, length: 90 }, mount)).toBe(false);
  });

  it('judges a motor of unknown length on its bore alone', () => {
    // Every bundled row carries a length; one imported from an .eng need not,
    // and dropping it would be a guess dressed up as a measurement.
    expect(motorFitsMount({ diameter: 24 }, mount)).toBe(true);
    expect(motorFitsMount({ diameter: 38 }, mount)).toBe(false);
  });

  it('takes the bore alone when the mount has no length either', () => {
    expect(motorFitsMount({ diameter: 24, length: 500 }, { bore: 24 })).toBe(true);
  });

  it('carries the rounding slack on both bounds', () => {
    // The catalog rounds to whole millimeters, so an exact fit must not be lost
    // to the last unit of it.
    expect(motorFitsMount({ diameter: 25, length: 70 }, mount)).toBe(true);
    expect(motorFitsMount({ diameter: 26, length: 70 }, mount)).toBe(false);
    expect(motorFitsMount({ diameter: 24, length: 77 }, mount)).toBe(true);
    expect(motorFitsMount({ diameter: 24, length: 78 }, mount)).toBe(false);
  });
});

describe('parseDelays', () => {
  it('parses comma and dash separated numeric delays', () => {
    expect(parseDelays('4,6,7,8,10')).toEqual({ delays: [4, 6, 7, 8, 10], plugged: false });
    expect(parseDelays('0-3-5-7')).toEqual({ delays: [0, 3, 5, 7], plugged: false });
  });

  it('detects a plugged option and separates it from numbers', () => {
    expect(parseDelays('0,3,P')).toEqual({ delays: [0, 3], plugged: true });
    expect(parseDelays('P')).toEqual({ delays: [], plugged: true });
  });

  it('de-dupes, sorts, and handles empty input', () => {
    expect(parseDelays('6,4,4')).toEqual({ delays: [4, 6], plugged: false });
    expect(parseDelays(undefined)).toEqual({ delays: [], plugged: false });
  });
});

describe('offersPlugged', () => {
  it('is what the manufacturer LISTS, not what is possible', () => {
    // 381 of the 815 bundled rows carry a P, and 374 of those have no numeric
    // delay at all: most reloads, every hybrid.
    expect(offersPlugged({ delays: 'P' })).toBe(true);
    expect(offersPlugged({ delays: '0,3,5,7,P' })).toBe(true);
    expect(offersPlugged({ delays: '4,6,8' })).toBe(false);
    // Any motor can still be FLOWN plugged from the delay control; a motor with
    // no delay data is simply not one the maker lists that way.
    expect(offersPlugged({})).toBe(false);
  });
});

describe('initialThrust', () => {
  it('averages thrust over the first 0.5 s (trapezoid)', () => {
    expect(
      initialThrust([
        [0, 0],
        [0.5, 20],
        [1, 0],
      ]),
    ).toBeCloseTo(10, 9);
  });

  it('clips the window when a sample spans past it', () => {
    // ramp 0→20 N over 1 s; the 0–0.5 s slice averages 5 N.
    expect(
      initialThrust([
        [0, 0],
        [1, 20],
      ]),
    ).toBeCloseTo(5, 9);
  });

  it('returns null for fewer than two samples', () => {
    expect(initialThrust([[0, 5]])).toBeNull();
    expect(initialThrust([])).toBeNull();
  });
});
