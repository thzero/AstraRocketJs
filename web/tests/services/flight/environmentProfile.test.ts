import { describe, expect, it } from 'vitest';
import type { FlightSeries } from '../../../src/engine/openRocketEngine';
import { environmentProfile, MAX_POINTS_PER_LEG } from '../../../src/services/flight/environmentProfile';

/** A flight up to 300 m and back down, `n` samples, with the six air series. */
function series(n = 101, over: Record<string, number[]> = {}): FlightSeries {
  const altitude = Array.from({ length: n }, (_, i) => 300 * Math.sin((Math.PI * i) / (n - 1)));
  const col = (f: (alt: number, i: number) => number) => altitude.map(f);
  return {
    altitude,
    Vw: col((a, i) => 3 + a / 100 + (i > (n - 1) / 2 ? 0.5 : 0)),
    θw: col(() => Math.PI / 2),
    T: col((a) => 288.15 - 0.0065 * a),
    P: col((a) => 101325 * Math.exp(-a / 8434)),
    ρ: col((a) => 1.225 * Math.exp(-a / 10400)),
    Vs: col((a) => 340.3 - 0.004 * a),
    ...over,
  } as unknown as FlightSeries;
}

describe('environmentProfile', () => {
  it('reads the pad off the first sample', () => {
    const env = environmentProfile(series())!;
    expect(env.pad.temperature).toBeCloseTo(288.15, 12);
    expect(env.pad.pressure).toBeCloseTo(101325, 9);
    expect(env.pad.windDirection).toBeCloseTo(Math.PI / 2, 12);
  });

  it('splits the flight at apogee into an ascent and a descent that both reach it', () => {
    const env = environmentProfile(series())!;
    expect(env.apogee).toBeCloseTo(300, 9);
    const { ascent, descent } = env.profiles.windSpeed;
    expect(ascent[0]!.altitude).toBe(0);
    expect(ascent[ascent.length - 1]!.altitude).toBeCloseTo(300, 9);
    expect(descent[0]!.altitude).toBeCloseTo(300, 9);
    expect(descent[descent.length - 1]!.altitude).toBeCloseTo(0, 9);
    // The two passes keep their own wind; the fixture's descent is 0.5 m/s gustier.
    const at = (legs: typeof ascent, alt: number) =>
      legs.reduce((b, p) => (Math.abs(p.altitude - alt) < Math.abs(b.altitude - alt) ? p : b)).value;
    expect(at(descent, 150) - at(ascent, 150)).toBeCloseTo(0.5, 1);
  });

  it('thins a long flight but keeps apogee', () => {
    const env = environmentProfile(series(5001))!;
    const { ascent } = env.profiles.temperature;
    expect(ascent.length).toBeLessThanOrEqual(MAX_POINTS_PER_LEG + 1);
    expect(ascent[ascent.length - 1]!.altitude).toBeCloseTo(300, 9);
  });

  it('skips a gap in a series rather than drawing it as a value', () => {
    const s = series(11);
    (s as unknown as Record<string, number[]>)['T']![3] = NaN;
    const ascent = environmentProfile(s)!.profiles.temperature.ascent;
    expect(ascent.every((p) => Number.isFinite(p.value))).toBe(true);
    expect(ascent).toHaveLength(5);
  });

  it('is null for a result without the air series', () => {
    const s = series() as unknown as Record<string, unknown>;
    delete s['ρ'];
    expect(environmentProfile(s as never)).toBeNull();
  });
});
