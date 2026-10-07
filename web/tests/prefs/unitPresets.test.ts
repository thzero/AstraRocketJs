import { describe, it, expect } from 'vitest';
import { METRIC_UNITS, IMPERIAL_UNITS, UNITS, QUANTITIES } from '../../src/prefs/units';
import type { Quantity } from '../../src/prefs/units';

/**
 * The two presets against `UnitGroup.setDefaultMetricUnits()` and
 * `setDefaultImperialUnits()`, which is what their comments claim they are.
 *
 * Six entries differed and nothing said so. The conversion factors were all
 * correct, so no stored value was wrong, but a preset labeled "the desktop's" and
 * showing a different unit is a claim the code does not keep: a metric user read
 * a 67 g/m² canopy as 0.067, and an imperial user read a surface density in a
 * unit `UNITS_DENSITY_SURFACE` does not contain.
 *
 * The desktop values below are transcribed from
 * `engine-java/src/java/info/openrocket/core/unit/UnitGroup.java:422-486`, with
 * the Java symbol constants spelled out (SQUARED, CUBED, DEGREE, DOT). Where we
 * deliberately differ the row says so and why, so a deviation is a decision in
 * this file rather than a drift nobody can see.
 */

/** `setDefaultMetricUnits()`, line for line. */
const DESKTOP_METRIC: Partial<Record<Quantity, string>> = {
  length: 'cm',
  motorDimensions: 'mm',
  distance: 'm',
  area: 'cm²',
  velocity: 'm/s',
  acceleration: 'm/s²',
  mass: 'g',
  angle: '°',
  density: 'g/cm³',
  surfaceDensity: 'g/m²',
  lineDensity: 'g/m',
  force: 'N',
  temperature: '°C',
  windspeed: 'm/s',
  rollRate: 'r/s',
};

/** `setDefaultImperialUnits()`, line for line. */
const DESKTOP_IMPERIAL: Partial<Record<Quantity, string>> = {
  length: 'in',
  motorDimensions: 'in',
  distance: 'ft',
  area: 'in²',
  velocity: 'ft/s',
  acceleration: 'ft/s²',
  mass: 'oz',
  angle: '°',
  density: 'oz/in³',
  surfaceDensity: 'oz/ft²',
  lineDensity: 'oz/ft',
  temperature: '°F',
  windspeed: 'mph',
  rollRate: 'r/s',
};

/**
 * Every quantity where we deliberately differ, with the desktop value and the
 * reason. A row here is a decision; an entry missing from both this table and the
 * desktop one above is a drift.
 */
const DEVIATIONS: Partial<Record<Quantity, { metric?: string; imperial?: string; why: string }>> = {
  pressure: {
    metric: 'mbar',
    imperial: 'mbar',
    why: 'hPa is mbar under its SI name (both 100 Pa); psi is the imperial unit the desktop forgets to set',
  },
  impulse: {
    metric: 'Ns',
    imperial: 'Ns',
    why: 'N·s is Ns with the dot this file uses everywhere; lbf·s is the imperial unit the desktop forgets to set',
  },
  force: {
    imperial: 'N',
    why: 'the desktop leaves force in newtons in imperial mode, which an Imperial preset should not do',
  },
};

describe('the metric preset is the desktop metric preset', () => {
  it.each(Object.entries(DESKTOP_METRIC) as [Quantity, string][])('%s is %s', (q, sym) => {
    expect(METRIC_UNITS[q]).toBe(sym);
  });
});

describe('the imperial preset is the desktop imperial preset', () => {
  it.each(Object.entries(DESKTOP_IMPERIAL) as [Quantity, string][])('%s is %s', (q, sym) => {
    expect(IMPERIAL_UNITS[q]).toBe(sym);
  });
});

describe('every quantity is accounted for, one way or the other', () => {
  it('leaves no quantity out of both tables', () => {
    // Without this, the way to make this suite green is to delete a row.
    const unexplained = QUANTITIES.filter((q) => !(q in DESKTOP_METRIC) && !(q in DEVIATIONS));
    expect(unexplained).toEqual([]);
  });

  it('states a reason for each deviation', () => {
    for (const [q, dev] of Object.entries(DEVIATIONS)) {
      expect(dev.why.length, q).toBeGreaterThan(20);
    }
  });

  it('names a deviation only where the two presets actually differ', () => {
    // A row here that agrees with the desktop would be a comment explaining a
    // difference that no longer exists, which is how a file starts lying again.
    for (const q of Object.keys(DEVIATIONS) as Quantity[]) {
      const dev = DEVIATIONS[q]!;
      if (dev.metric) expect(METRIC_UNITS[q], q).not.toBe(dev.metric);
      if (dev.imperial) expect(IMPERIAL_UNITS[q], q).not.toBe(dev.imperial);
    }
  });
});

describe('both presets name a unit that exists', () => {
  it.each(QUANTITIES)('%s', (q) => {
    const symbols = UNITS[q].map((u) => u.symbol);
    expect(symbols, `metric ${q}`).toContain(METRIC_UNITS[q]);
    expect(symbols, `imperial ${q}`).toContain(IMPERIAL_UNITS[q]);
  });
});
