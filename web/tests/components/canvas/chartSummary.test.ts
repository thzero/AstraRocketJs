// cspell:ignore Höhe Spitze -- German, from the de locale the test reads in
import { describe, it, expect } from 'vitest';
import {
  eventsSummary,
  machSeriesSummary,
  peakOf,
  rangeOf,
  timeSeriesSummary,
  velocityAltitudeSummary,
} from '../../../src/components/canvas/chartSummary';
import { localeTranslator } from '../../testing/localeTranslator';
import en from '../../../src/i18n/locales/en.json';
import de from '../../../src/i18n/locales/de.json';

/**
 * The sentences a screen reader hears for each chart, in place of the drawing.
 * Built from real locale strings, so a renamed key or a lost placeholder fails
 * here rather than reaching a reader as a raw key.
 */
const t = localeTranslator(en);

describe('peakOf and rangeOf', () => {
  it('finds the sample of largest magnitude, keeping its sign', () => {
    expect(peakOf([0, 1, 2], [3, -9, 5])).toEqual({ value: -9, at: 1 });
  });

  it('gives the span of the samples', () => {
    expect(rangeOf([4, 1, 7])).toEqual({ min: 1, max: 7 });
  });

  it('gives nothing for no samples', () => {
    expect(peakOf([], [])).toBeNull();
    expect(rangeOf([])).toBeNull();
  });
});

describe('timeSeriesSummary', () => {
  const climb = { name: 'Sustainer', xs: [0, 3, 6.1, 9], ys: [0, 150, 312, 200] };

  it('states a flow series by its peak and when it happened', () => {
    expect(timeSeriesSummary(t, 'Altitude', 'm', 0, false, [climb])).toBe('Altitude: peak 312 m at 6.1 s');
  });

  it('states a level series by the span it covers', () => {
    const mass = { name: 'Sustainer', xs: [0, 1, 2], ys: [120, 104, 98] };
    expect(timeSeriesSummary(t, 'Mass', 'g', 0, true, [mass])).toBe('Mass: from 98 g to 120 g');
  });

  it('names each stage when there are several', () => {
    const booster = { name: 'Booster', xs: [0, 2, 3], ys: [0, 80, 120] };
    expect(timeSeriesSummary(t, 'Altitude', 'm', 0, false, [climb, booster])).toBe(
      'Altitude: Sustainer: peak 312 m at 6.1 s; Booster: peak 120 m at 3.0 s',
    );
  });

  it('says so when a stage has no samples', () => {
    expect(timeSeriesSummary(t, 'Mach', '', 2, false, [{ name: 'S', xs: [], ys: [] }])).toBe('Mach: no data');
  });

  it('reads in the locale', () => {
    expect(timeSeriesSummary(localeTranslator(de), 'Höhe', 'm', 0, false, [climb])).toBe(
      'Höhe: Spitze 312 m bei 6.1 s',
    );
  });
});

describe('eventsSummary', () => {
  const label = (type: string) => type.toLowerCase();

  it('lists events in time order, each once', () => {
    const events = [
      { type: 'APOGEE', time: 6.1 },
      { type: 'BURNOUT', time: 1.9 },
      { type: 'BURNOUT', time: 1.9 },
      { type: 'LAUNCH', time: 0 },
    ];
    expect(eventsSummary(t, events, label)).toBe('Events: launch at 0.0 s, burnout at 1.9 s, apogee at 6.1 s');
  });

  it('gives nothing for no events', () => {
    expect(eventsSummary(t, [], label)).toBeNull();
  });
});

describe('velocityAltitudeSummary', () => {
  it('states the top speed and the altitude it was reached at', () => {
    const fmt = { velocity: (v: number) => `${v} m/s`, altitude: (a: number) => `${a} m` };
    const line = { name: 'S', alt: [0, 40, 120, 300], vel: [0, 60, 95, 10] };
    expect(velocityAltitudeSummary(t, 'Velocity vs altitude', [line], fmt)).toBe(
      'Velocity vs altitude: top speed 95 m/s at 120 m',
    );
  });
});

describe('machSeriesSummary', () => {
  const machs = [0.1, 0.5, 0.9, 1.1];

  it('states each curve by its peak and the Mach number it occurs at, skipping gaps', () => {
    const series = [
      { name: 'Total', values: [0.42, 0.45, 0.61, NaN] },
      { name: 'Base', values: [0.12, 0.13, 0.15, 0.2] },
    ];
    expect(machSeriesSummary(t, 'Cd vs Mach', 'Cd', 3, machs, series)).toBe(
      'Cd vs Mach: Total: peak 0.610 Cd at Mach 0.90; Base: peak 0.200 Cd at Mach 1.10',
    );
  });

  it('leaves the curve name out when there is only one', () => {
    expect(machSeriesSummary(t, 'CP', '%', 1, machs, [{ name: 'CP', values: [60, 61, 64, 70] }])).toBe(
      'CP: peak 70.0 % at Mach 1.10',
    );
  });
});
