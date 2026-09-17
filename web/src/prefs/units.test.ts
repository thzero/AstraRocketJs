import { describe, it, expect } from 'vitest';
import {
  IMPERIAL_UNITS,
  METRIC_UNITS,
  QUANTITIES,
  UNITS,
  fmtSi,
  niceStep,
  normalizeUnitOverrides,
  normalizeUnits,
  resolveUnitChoice,
  siToUi,
  siToUiDelta,
  uiToSi,
  unitFor,
  unitScope,
} from './units';

describe('unit conversion', () => {
  it('round-trips every unit of every quantity', () => {
    for (const q of QUANTITIES) {
      for (const u of UNITS[q]) {
        expect(uiToSi(q, u.symbol, siToUi(q, u.symbol, 1.234))).toBeCloseTo(1.234, 9);
      }
    }
  });

  it('converts lengths against the desktop factors', () => {
    expect(siToUi('length', 'mm', 0.9)).toBeCloseTo(900, 9);
    expect(siToUi('length', 'in', 0.0254)).toBeCloseTo(1, 9);
    expect(uiToSi('length', 'ft', 1)).toBeCloseTo(0.3048, 9);
  });

  it('applies the temperature offset for a reading but not for a difference', () => {
    // 0 °C is 273.15 K; 32 °F is the same point.
    expect(uiToSi('temperature', '°C', 0)).toBeCloseTo(273.15, 6);
    expect(uiToSi('temperature', '°F', 32)).toBeCloseTo(273.15, 6);
    expect(siToUi('temperature', '°F', 373.15)).toBeCloseTo(212, 6);
    // A 1 K step is a 1 °C step and a 1.8 °F step — the offset cancels.
    expect(siToUiDelta('temperature', '°C', 1)).toBeCloseTo(1, 9);
    expect(siToUiDelta('temperature', '°F', 1)).toBeCloseTo(1.8, 9);
  });

  it('derives the areal and linear density factors from their definitions', () => {
    // 1 oz/yd² is one ounce (28.3495231 g) over one square yard (0.83612736 m²).
    expect(uiToSi('surfaceDensity', 'oz/yd²', 1)).toBeCloseTo(0.0283495231 / 0.83612736, 12);
    expect(uiToSi('surfaceDensity', 'g/cm²', 1)).toBeCloseTo(10, 12);
    expect(uiToSi('lineDensity', 'oz/ft', 1)).toBeCloseTo(0.0283495231 / 0.3048, 12);
    expect(uiToSi('lineDensity', 'g/m', 1)).toBeCloseTo(0.001, 12);
    // A 1.1 oz/yd² ripstop reads back as 1.1, not as a rounded 1.
    expect(fmtSi('surfaceDensity', 'oz/yd²', 1.1 * (0.0283495231 / 0.83612736), 2)).toBe('1.1');
  });

  it('falls back to the first unit for a symbol it does not know', () => {
    expect(siToUi('mass', 'stone', 1)).toBe(siToUi('mass', 'g', 1));
  });

  it('never returns a number for an absent value', () => {
    // The kernel emits null for NaN/Infinity, and `null / toSI` is 0 — which
    // would print an absent apogee as a confident zero.
    expect(fmtSi('distance', 'm', NaN)).toBe('—');
    expect(fmtSi('distance', 'm', null as unknown as number)).toBe('—');
  });

  it('formats with a magnitude ladder, or a requested precision', () => {
    expect(fmtSi('length', 'mm', 0.9)).toBe('900');
    expect(fmtSi('length', 'in', 0.9)).toBe('35.4');
    expect(fmtSi('length', 'in', 0.9, 3)).toBe('35.433');
  });
});

describe('niceStep', () => {
  it('snaps to a 1-2-5 ladder', () => {
    expect(niceStep(0.0012)).toBeCloseTo(0.001, 9);
    expect(niceStep(0.003)).toBeCloseTo(0.002, 9);
    expect(niceStep(4)).toBe(5);
    expect(niceStep(8)).toBe(10);
  });

  it('returns 1 rather than 0 or NaN for a non-positive input', () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-3)).toBe(1);
    expect(niceStep(NaN)).toBe(1);
  });
});

describe('normalizeUnits', () => {
  it('defaults a missing or non-object blob', () => {
    expect(normalizeUnits(undefined)).toEqual(METRIC_UNITS);
    expect(normalizeUnits('nope')).toEqual(METRIC_UNITS);
  });

  it('keeps known symbols and drops unknown ones per quantity', () => {
    const out = normalizeUnits({ length: 'in', mass: 'stone', bogus: 'x' });
    expect(out.length).toBe('in');
    expect(out.mass).toBe(METRIC_UNITS.mass);
    expect(Object.keys(out).sort()).toEqual([...QUANTITIES].sort());
  });
});

describe('per-field unit overrides', () => {
  const noseLength = unitScope('prop', 'nosecone', 'length');
  const noseThickness = unitScope('prop', 'nosecone', 'thickness');

  it('changes the one field and leaves every other alone', () => {
    // The whole point: a chip on the nose cone's Length must not re-base its
    // Thickness, the body tube's Length, or anything outside the card.
    const ov = { [noseLength]: 'in' };
    expect(unitFor(METRIC_UNITS, ov, 'length', noseLength)).toBe('in');
    expect(unitFor(METRIC_UNITS, ov, 'length', noseThickness)).toBe('cm');
    expect(unitFor(METRIC_UNITS, ov, 'length', unitScope('prop', 'bodytube', 'length'))).toBe('cm');
    expect(unitFor(METRIC_UNITS, ov, 'length', unitScope('stats', 'cp'))).toBe('cm');
  });

  it('keeps an untouched field following the preference when that changes', () => {
    const imperialish = { ...METRIC_UNITS, length: 'mm' };
    expect(unitFor(imperialish, {}, 'length', noseLength)).toBe('mm');
    // …while a field with its own choice stays put.
    expect(unitFor(imperialish, { [noseLength]: 'in' }, 'length', noseLength)).toBe('in');
  });

  it('falls back when the stored symbol does not suit the quantity', () => {
    // A scope key does not say which quantity it belongs to, so a stale 'in'
    // left on a field that is now a mass would otherwise reach `unitDef` and
    // quietly become grams. Checking against the quantity catches it here.
    expect(unitFor(METRIC_UNITS, { [noseLength]: 'in' }, 'mass', noseLength)).toBe('g');
    expect(unitFor(METRIC_UNITS, { [noseLength]: 'smoot' }, 'length', noseLength)).toBe('cm');
  });

  it('resolves to the preference with no scope at all', () => {
    expect(unitFor(METRIC_UNITS, { [noseLength]: 'in' }, 'length')).toBe('cm');
  });

  it('keeps only string entries when loading a stored blob', () => {
    expect(normalizeUnitOverrides({ [noseLength]: 'in', bad: 5, empty: '' })).toEqual({
      [noseLength]: 'in',
    });
    expect(normalizeUnitOverrides(undefined)).toEqual({});
    expect(normalizeUnitOverrides('nope')).toEqual({});
  });
});

describe('export unit choice', () => {
  const current = { ...METRIC_UNITS, length: 'in' };

  it('follows the app preferences for "current"', () => {
    // Per-field chips deliberately do NOT reach an export: a document written
    // half in inches and half in centimeters because of where someone happened
    // to click is not a document anyone wants.
    expect(resolveUnitChoice('current', current)).toBe(current);
    expect(resolveUnitChoice('current', current).length).toBe('in');
  });

  it('pins to a system regardless of what the app is showing', () => {
    expect(resolveUnitChoice('metric', current)).toEqual(METRIC_UNITS);
    expect(resolveUnitChoice('imperial', current)).toEqual(IMPERIAL_UNITS);
    // …and the app's own units are not disturbed by asking for one.
    expect(current.length).toBe('in');
  });
});

describe('presets', () => {
  it('has exactly one metric set, matching the desktop', () => {
    // There were two once — the app's original hard-coded mm / kg·m⁻³ as the
    // startup default against the desktop's cm / g·cm⁻³ as the preset — which
    // left the Units tab with two buttons that both meant "metric" and
    // disagreed about these two quantities, with nothing to explain why.
    // METRIC_UNITS is now the only one, so Reset and the preset cannot differ.
    expect(METRIC_UNITS.length).toBe('cm');
    expect(METRIC_UNITS.density).toBe('g/cm³');
  });

  it('name only symbols this build defines', () => {
    for (const preset of [METRIC_UNITS, IMPERIAL_UNITS]) {
      for (const q of QUANTITIES) {
        expect(UNITS[q].some((u) => u.symbol === preset[q])).toBe(true);
      }
    }
  });
});
