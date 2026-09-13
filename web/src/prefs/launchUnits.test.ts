import { describe, it, expect } from 'vitest';
import { LAUNCH_SI, type LaunchUnitKind } from './launchUnits';
import { siToUi, uiToSi, METRIC_UNITS, IMPERIAL_UNITS } from './units';

const KINDS = Object.keys(LAUNCH_SI) as LaunchUnitKind[];

/**
 * Launch conditions are the one place the app stores something that is NOT SI
 * (degrees, Celsius, hPa), so every launch field crosses two conversions to
 * reach the screen. These pin the inner one.
 */
describe('launch-condition SI bridge', () => {
  it('round-trips every field, so nothing drifts on a re-render', () => {
    for (const kind of KINDS) {
      const { toSi, fromSi } = LAUNCH_SI[kind];
      expect(fromSi(toSi(12.5)), kind).toBeCloseTo(12.5, 9);
      expect(fromSi(toSi(-3)), kind).toBeCloseTo(-3, 9);
    }
  });

  it('converts each stored convention to real SI', () => {
    expect(LAUNCH_SI.deg.toSi(180)).toBeCloseTo(Math.PI, 12);
    expect(LAUNCH_SI.degC.toSi(0)).toBeCloseTo(273.15, 12); // °C → K
    expect(LAUNCH_SI.hPa.toSi(1013.25)).toBeCloseTo(101325, 9); // hPa → Pa
    // The three already-SI fields must be untouched, not "converted" by 1000.
    expect(LAUNCH_SI.length.toSi(1.5)).toBe(1.5);
    expect(LAUNCH_SI.distance.toSi(250)).toBe(250);
    expect(LAUNCH_SI.windspeed.toSi(4)).toBe(4);
  });

  it('reaches the right displayed number through the full stored → SI → unit path', () => {
    // A launch field is stored, lifted to SI, then shown in the user's unit.
    // These are the end-to-end numbers a user would read off the panel.
    const shown = (kind: LaunchUnitKind, stored: number, units: typeof METRIC_UNITS) => {
      const c = LAUNCH_SI[kind];
      return siToUi(c.q, units[c.q], c.toSi(stored));
    };
    // 20 °C is 68 °F.
    expect(shown('degC', 20, IMPERIAL_UNITS)).toBeCloseTo(68, 6);
    // 1013.25 hPa is 14.6959 psi.
    expect(shown('hPa', 1013.25, IMPERIAL_UNITS)).toBeCloseTo(14.6959, 3);
    // 5 m/s is 11.1847 mph.
    expect(shown('windspeed', 5, IMPERIAL_UNITS)).toBeCloseTo(11.1847, 3);
    // A 1 m rod is 39.3701 in… but rod length uses the `length` group, which is
    // cm under metric — the panel is not silently metres.
    expect(shown('length', 1, METRIC_UNITS)).toBeCloseTo(100, 9);
  });

  it('writes back what the user typed, through the full unit → SI → stored path', () => {
    const stored = (kind: LaunchUnitKind, typed: number, units: typeof METRIC_UNITS) => {
      const c = LAUNCH_SI[kind];
      return c.fromSi(uiToSi(c.q, units[c.q], typed));
    };
    // Typing 68 °F must store 20 °C, not 68 and not 341.15.
    expect(stored('degC', 68, IMPERIAL_UNITS)).toBeCloseTo(20, 6);
    // Typing 14.6959 psi must store ~1013.25 hPa.
    expect(stored('hPa', 14.6959, IMPERIAL_UNITS)).toBeCloseTo(1013.25, 1);
    // Typing 45° must store 45 degrees — the two angle conversions cancel.
    expect(stored('deg', 45, METRIC_UNITS)).toBeCloseTo(45, 9);
  });

  it('keeps the temperature offset out of the wind and angle fields', () => {
    // The offset is the easiest thing to leak into a neighbour: a field that
    // gained +273.15 would read as a plausible-looking number, not an error.
    expect(LAUNCH_SI.windspeed.toSi(0)).toBe(0);
    expect(LAUNCH_SI.deg.toSi(0)).toBe(0);
    expect(LAUNCH_SI.hPa.toSi(0)).toBe(0);
  });
});
