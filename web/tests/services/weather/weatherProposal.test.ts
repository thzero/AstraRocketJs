import { describe, expect, it } from 'vitest';
import { parseForecast } from '../../../src/services/weather/openMeteo';
import {
  hasGroup,
  proposalFor,
  proposalPatch,
  turbulenceFromGust,
  UPPER_AIR_TURBULENCE,
  type ProposalGroup,
} from '../../../src/services/weather/weatherProposal';
import { usableAtmosphereLevels } from '../../../src/services/flight/atmosphereLevels';
import { answer } from '../../testing/openMeteoFixture';

const hour = (elevation = 1500) => parseForecast(answer(elevation), [elevation])[0]!.samples[0]!;

describe('turbulenceFromGust (desktop OpenRocket PR #3211)', () => {
  it('is the gust spread over three times the mean wind', () => {
    expect(turbulenceFromGust(4, 7)).toBeCloseTo(0.25, 12);
  });
  it('is held to 0.05..0.35', () => {
    expect(turbulenceFromGust(10, 10.5)).toBe(0.05);
    expect(turbulenceFromGust(2, 10)).toBe(0.35);
  });
  it('is 0.10 near calm, with no gust, or with a gust no higher than the wind', () => {
    expect(turbulenceFromGust(0.05, 5)).toBe(0.1);
    expect(turbulenceFromGust(4, null)).toBe(0.1);
    expect(turbulenceFromGust(4, 4)).toBe(0.1);
  });
});

describe('proposalFor', () => {
  it('takes the surface values, humidity as a fraction', () => {
    const p = proposalFor(hour(), 1500);
    expect(p).toMatchObject({ temperatureC: 12, pressureHPa: 850, relativeHumidity: 0.4 });
  });

  it('puts the 10 m wind 10 m above the pad, then the height winds, then the pressure levels above them', () => {
    const levels = proposalFor(hour(), 1500).wind!.levels;
    expect(levels.slice(0, 4).map((l) => l.altitudeM)).toEqual([1510, 1580, 1620, 1680]);
    // Pressure levels at or below the 180 m wind are left to the height winds.
    expect(levels.slice(4).every((l) => l.altitudeM > 1680)).toBe(true);
    const sorted = [...levels].sort((a, b) => a.altitudeM - b.altitudeM);
    expect(levels).toEqual(sorted);
    expect(new Set(levels.map((l) => l.altitudeM)).size).toBe(levels.length);
  });

  it('gives the surface its gust turbulence and the levels above the fixed one', () => {
    const w = proposalFor(hour(), 1500).wind!;
    expect(w.levels[0]).toMatchObject({ speed: 4, directionDeg: 270, stddev: 0.25 * 4 });
    expect(w.surfaceStdDev).toBeCloseTo(1, 12);
    for (const l of w.levels.slice(1)) expect(l.stddev).toBeCloseTo(UPPER_AIR_TURBULENCE * l.speed, 12);
  });

  it('builds the atmosphere from the pressure levels above the pad only', () => {
    const a = proposalFor(hour(), 1500).atmosphere!;
    expect(a.every((l) => l.altitudeM > 1500)).toBe(true);
    expect(a.map((l) => l.pressureHPa)).toEqual([...a.map((l) => l.pressureHPa)].sort((x, y) => y - x));
    // 850 hPa sits near 1457 m, under this 1500 m pad, so 800 hPa is the first level kept.
    expect(a[0]).toMatchObject({ pressureHPa: 800, relativeHumidity: 0.3 });
    expect(usableAtmosphereLevels(a)).toEqual(a);
  });

  it('offers no group it has nothing for', () => {
    const s = { ...hour(), windSpeed: null, levels: [], humidityPct: null };
    const p = proposalFor(s, 1500);
    expect(
      (['temperature', 'pressure', 'humidity', 'wind', 'atmosphere'] as ProposalGroup[]).filter((g) => hasGroup(p, g)),
    ).toEqual(['temperature', 'pressure']);
  });
});

describe('proposalPatch', () => {
  const p = proposalFor(hour(), 1500);
  it('writes only the ticked groups', () => {
    expect(proposalPatch(p, new Set<ProposalGroup>(['temperature']))).toEqual({ temperatureC: 12 });
  });
  it('writes the wind as an MSL profile and fills the single wind from the surface', () => {
    const patch = proposalPatch(p, new Set<ProposalGroup>(['wind']));
    expect(patch).toMatchObject({ windAverage: 4, windStdDev: 1, windDirectionDeg: 270, windAltitudeReference: 'msl' });
    expect(patch.windLevels).toEqual(p.wind!.levels);
  });
  it('writes the atmosphere levels and, when asked, the terrain elevation', () => {
    const patch = proposalPatch(p, new Set<ProposalGroup>(['atmosphere']), { launchAltitudeM: 1612 });
    expect(patch.atmosphereLevels).toEqual(p.atmosphere);
    expect(patch.launchAltitudeM).toBe(1612);
  });
});

describe('usableAtmosphereLevels', () => {
  const l = (altitudeM: number, pressureHPa: number) => ({
    altitudeM,
    temperatureC: 0,
    pressureHPa,
    relativeHumidity: 0.5,
  });
  it('sorts, and drops a level the engine would refuse', () => {
    expect(
      usableAtmosphereLevels([
        l(3000, 700),
        l(1000, 900),
        { ...l(2000, 800), temperatureC: -300 },
        { ...l(2500, 750), relativeHumidity: 1.5 },
        l(1000, 890),
        l(4000, 710),
        'junk',
        { altitudeM: 5000 },
      ]),
    ).toEqual([l(1000, 900), l(3000, 700)]);
  });
});
