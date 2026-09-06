import { describe, it, expect } from 'vitest';
import {
  airDensity,
  canopyDiameter,
  classifyRate,
  descentMass,
  descentRate,
  DROGUE_BAND,
  MAIN_BAND,
  msToFtS,
  propellantMass,
} from './recoverySizing';

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

  it('honours explicit temperature / pressure overrides', () => {
    // Hot day thins the air.
    const hot = airDensity({ launchAltitudeM: 0, temperatureC: 40 });
    const cool = airDensity({ launchAltitudeM: 0, temperatureC: 0 });
    expect(hot).toBeLessThan(cool);
  });

  it('defaults to sea-level density with no launch data', () => {
    expect(airDensity(null)).toBeCloseTo(1.225, 3);
    expect(airDensity(undefined)).toBeCloseTo(1.225, 3);
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

  it('msToFtS converts', () => {
    expect(msToFtS(0.3048)).toBeCloseTo(1, 9);
  });
});
