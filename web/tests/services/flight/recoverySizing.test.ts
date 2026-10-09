import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  airDensity,
  canopyDiameter,
  classifyRate,
  descentMass,
  descentRate,
  DROGUE_BAND,
  MAIN_BAND,
  propellantMass,
  siteAirDensity,
} from '../../../src/services/flight/recoverySizing';

describe('recovery sizing physics', () => {
  it('descentRate and canopyDiameter are inverses', () => {
    const m = 0.5;
    const cd = 0.8;
    const rho = 1.225;
    const d = canopyDiameter(m, MAIN_BAND.target, cd, rho);
    expect(descentRate(m, d, cd, rho)).toBeCloseTo(MAIN_BAND.target, 6);
  });

  it('a bigger canopy descends slower (1/D law)', () => {
    const slow = descentRate(1, 0.6, 0.8, 1.225);
    const fast = descentRate(1, 0.3, 0.8, 1.225);
    // Half the diameter -> twice the speed.
    expect(fast / slow).toBeCloseTo(2, 6);
  });

  it('returns Infinity (never NaN) for non-positive descent mass', () => {
    expect(descentRate(0, 0.6, 0.8, 1.225)).toBe(Infinity);
    expect(descentRate(-1, 0.6, 0.8, 1.225)).toBe(Infinity);
    expect(canopyDiameter(-1, MAIN_BAND.target, 0.8, 1.225)).toBe(Infinity);
  });

  it('descentMass is null when propellant meets or exceeds loaded mass', () => {
    expect(descentMass(0.5, [{ masses: [0.6, 0] }])).toBeNull(); // 0.6 propellant > 0.5 loaded
    expect(descentMass(0.5, [{ masses: [0.5, 0] }])).toBeNull(); // exactly zero descent mass
    expect(descentMass(1.0, [{ masses: [0.3, 0.1] }])).toBeCloseTo(0.8, 6); // normal
  });

  it('matches a hand-worked descent rate', () => {
    // 1 kg, 1 m canopy, Cd 0.8, rho 1.225:
    // A = pi/4 = 0.785398; v = sqrt(2*1*9.80665/(1.225*0.8*0.785398)) = 5.048 m/s
    expect(descentRate(1, 1, 0.8, 1.225)).toBeCloseTo(5.048, 2);
  });

  it('thinner air (altitude) lands the same canopy faster', () => {
    const seaLevel = descentRate(1, 0.8, 0.8, airDensity({ launchAltitudeM: 0 }));
    const highField = descentRate(1, 0.8, 0.8, airDensity({ launchAltitudeM: 1500 }));
    expect(highField).toBeGreaterThan(seaLevel);
    // ~6-7% faster by 1500 m.
    expect(highField / seaLevel).toBeGreaterThan(1.05);
  });
});

describe('launch-site air density', () => {
  it('is ~1.225 at sea level and falls with altitude', () => {
    expect(airDensity({ launchAltitudeM: 0 })).toBeCloseTo(1.225, 2);
    expect(airDensity({ launchAltitudeM: 1524 })).toBeLessThan(airDensity({ launchAltitudeM: 0 }));
  });

  /**
   * With forecast levels and no site temperature or pressure, the flight flies
   * the levels alone (the bridge's AtmosphereProfile), so the estimate reads
   * the air at the pad from them too.
   */
  describe('with forecast levels', () => {
    const levels = [
      { altitudeM: 1000, temperatureC: 15, pressureHPa: 900, relativeHumidity: 0.5 },
      { altitudeM: 3000, temperatureC: 5, pressureHPa: 700, relativeHumidity: 0.3 },
    ];

    it('interpolates between levels: temperature linearly, pressure on a log scale', () => {
      // Halfway: 10 C, and sqrt(900 * 700) hPa.
      expect(airDensity({ launchAltitudeM: 2000, atmosphereLevels: levels })).toBeCloseTo(0.976544, 5);
    });

    it('follows the standard atmosphere from the lowest level below it', () => {
      // 500 m under the 1000 m level: the standard 3.25 K warmer and the
      // standard pressure ratio, applied to that level's 15 C and 900 hPa.
      // The kernel's own value is checked in tests/engine/atmosphereProfile.test.ts.
      expect(airDensity({ launchAltitudeM: 500, atmosphereLevels: levels })).toBeCloseTo(1.14281, 5);
    });

    it('uses the site values when both are set, as the flight does', () => {
      const site = { launchAltitudeM: 2000, temperatureC: 20, pressureHPa: 800 };
      expect(airDensity({ ...site, atmosphereLevels: levels })).toBe(airDensity(site));
    });

    it('reads the levels when only one site value is set', () => {
      const one = airDensity({ launchAltitudeM: 2000, temperatureC: 20, atmosphereLevels: levels });
      expect(one).toBeCloseTo(0.976544, 5);
    });
  });

  it('honors explicit temperature / pressure overrides', () => {
    // Hot day thins the air.
    const hot = airDensity({ launchAltitudeM: 0, temperatureC: 40 });
    const cool = airDensity({ launchAltitudeM: 0, temperatureC: 0 });
    expect(hot).toBeLessThan(cool);
  });

  it('reads a standalone site at its own pressure, with or without a typed temperature', () => {
    // 2,682 m: the ISA temperature there is about -2.4 C.
    const blank = siteAirDensity(2682, null);
    expect(blank).toBeCloseTo(airDensity({ launchAltitudeM: 2682 }), 9);
    expect(siteAirDensity(2682, -2.4)).toBeCloseTo(blank, 2);
    // A typed 15 C is warmer than standard there, so the air is thinner, not
    // the sea-level 1.225 a flight's blank pressure would give.
    expect(siteAirDensity(2682, 15)).toBeLessThan(blank);
    expect(siteAirDensity(null, null)).toBeCloseTo(1.225, 3);
  });

  it('defaults to sea-level density with no launch data', () => {
    expect(airDensity(null)).toBeCloseTo(1.225, 3);
    expect(airDensity(undefined)).toBeCloseTo(1.225, 3);
  });

  /**
   * The panel has to size for the air the flight flies, and the flight's rule
   * has a step in it that only shows away from sea level.
   *
   * With every field blank the kernel gets standard ISA, which at the pad is
   * the ISA value for the site altitude. As soon as any one of temperature,
   * pressure or humidity is set it gets an `ExtendedISAModel` anchored at the
   * site altitude, and a field left blank is filled with the sea-level standard
   * constant. Filling a blank from the site altitude instead is a different
   * atmosphere, and sizing a canopy in it is sizing for a flight nobody makes.
   */
  describe('fills a blank the way the flight does', () => {
    const HIGH = 2682; // m, high enough for the two rules to differ clearly

    it('uses the site-altitude ISA when nothing at all is set', () => {
      // The textbook ISA value to within 0.1 %: the kernel tabulates the
      // standard atmosphere every 500 m and interpolates linearly, and the
      // estimate reads it the same way (checked against the kernel in
      // tests/engine/atmosphereProfile.test.ts).
      const tIsa = 288.15 - 0.0065 * HIGH;
      const pIsa = 101325 * Math.pow(tIsa / 288.15, 9.80665 / (287.053 * 0.0065));
      expect(airDensity({ launchAltitudeM: HIGH }) / (pIsa / (287.053 * tIsa))).toBeCloseTo(1, 3);
    });

    it('uses the sea-level standard pressure when only a temperature is typed', () => {
      // 101325 / (287.053 * 303.15), not the ~73 kPa of a 2,682 m field.
      expect(airDensity({ launchAltitudeM: HIGH, temperatureC: 30 })).toBeCloseTo(1.1644, 4);
    });

    it('uses the sea-level standard temperature when only a pressure is typed', () => {
      // 85000 / (287.053 * 288.15), not the ~271 K of a 2,682 m field.
      expect(airDensity({ launchAltitudeM: HIGH, pressureHPa: 850 })).toBeCloseTo(1.0276, 4);
    });

    it('switches branch on humidity alone, which sets neither value', () => {
      // Humidity is enough to hand the kernel a custom model, so both blanks
      // are then the sea-level standards - the same air as a sea-level field.
      expect(airDensity({ launchAltitudeM: HIGH, relativeHumidity: 0.8 })).toBeCloseTo(1.225, 3);
      expect(airDensity({ launchAltitudeM: HIGH, relativeHumidity: 0.8 })).not.toBeCloseTo(
        airDensity({ launchAltitudeM: HIGH }),
        3,
      );
    });

    it('agrees with the no-override case at sea level, where the branches meet', () => {
      expect(airDensity({ launchAltitudeM: 0, temperatureC: 15 })).toBeCloseTo(airDensity({ launchAltitudeM: 0 }), 6);
    });
  });

  /**
   * The rule above is the bridge's, and this is the only thing holding the copy
   * to it. A JS atmosphere that quietly stops matching the Java one puts a large
   * error in this panel, so the source that owns the rule is read here rather
   * than trusted.
   */
  it('still matches the rule the bridge hands the kernel', () => {
    const bridge = readFileSync(
      resolve(process.cwd(), '../engine-java/src/api/java/api/OpenRocketEngine.java'),
      'utf8',
    );
    // Any one of the three switches to the custom model...
    expect(bridge).toMatch(
      /if \(!Double\.isNaN\(temperature\) \|\| !Double\.isNaN\(pressure\) \|\| !Double\.isNaN\(humidity\)\)/,
    );
    // ...anchored at the site altitude, with the standard constants for blanks.
    expect(bridge).toContain('Double.isNaN(temperature) ? ExtendedISAModel.STANDARD_TEMPERATURE : temperature');
    expect(bridge).toContain('Double.isNaN(pressure) ? ExtendedISAModel.STANDARD_PRESSURE : pressure');

    // And those constants are the ones this module calls T0 and P0.
    const model = readFileSync(
      resolve(process.cwd(), '../engine-java/src/java/info/openrocket/core/models/atmosphere/ExtendedISAModel.java'),
      'utf8',
    );
    expect(model).toContain('STANDARD_TEMPERATURE = 288.15');
    expect(model).toContain('STANDARD_PRESSURE = 101325');
  });
});

describe('descent mass', () => {
  const motor = { masses: [0.02, 0.015, 0.006] }; // loaded 20 g, burnout 6 g -> 14 g propellant

  it('is loaded mass minus expelled propellant', () => {
    expect(propellantMass(motor)).toBeCloseTo(0.014, 6);
    expect(descentMass(0.5, [motor])).toBeCloseTo(0.486, 6);
  });

  it('sums propellant across multiple motors', () => {
    expect(descentMass(0.5, [motor, motor])).toBeCloseTo(0.472, 6);
  });

  it('is null with no motor (nothing burns off) or unknown mass', () => {
    expect(descentMass(0.5, [])).toBeNull();
    expect(descentMass(0.5, [null, undefined, { masses: [] }])).toBeNull();
    expect(descentMass(null, [motor])).toBeNull();
  });
});

describe('rate classification', () => {
  it('places rates in the right band', () => {
    expect(classifyRate(10 * 0.3048)).toBe('slow');
    expect(classifyRate(MAIN_BAND.target)).toBe('main');
    expect(classifyRate(35 * 0.3048)).toBe('between');
    expect(classifyRate(DROGUE_BAND.target)).toBe('drogue');
    expect(classifyRate(100 * 0.3048)).toBe('fast');
  });
});
