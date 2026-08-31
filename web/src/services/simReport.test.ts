import { describe, it, expect } from 'vitest';
import {
  stabilityState,
  stabilityTone,
  stabilityVerdictKey,
  EVENT_LABEL,
  EVENT_PRIORITY,
} from './simReport';

describe('stabilityState (healthy-band classifier)', () => {
  it('returns null for null/undefined/non-finite input', () => {
    expect(stabilityState(null)).toBeNull();
    expect(stabilityState(undefined)).toBeNull();
    expect(stabilityState(NaN)).toBeNull();
    expect(stabilityState(Infinity)).toBeNull();
  });

  it('classifies under / ok / over with inclusive [1,6] ok band', () => {
    expect(stabilityState(0.99)).toBe('under');
    expect(stabilityState(1.0)).toBe('ok'); // lower boundary inclusive
    expect(stabilityState(3)).toBe('ok');
    expect(stabilityState(6.0)).toBe('ok'); // upper boundary inclusive
    expect(stabilityState(6.01)).toBe('over');
  });
});

describe('stabilityTone (margin-sign tiers)', () => {
  it('is emerald at/above 1 cal, amber in [0,1), red below 0', () => {
    expect(stabilityTone(1)).toBe('text-emerald-400');
    expect(stabilityTone(2.5)).toBe('text-emerald-400');
    expect(stabilityTone(0)).toBe('text-amber-400');
    expect(stabilityTone(0.5)).toBe('text-amber-400');
    expect(stabilityTone(-0.1)).toBe('text-red-400');
  });
});

describe('stabilityVerdictKey', () => {
  it('mirrors stabilityTone tiers with i18n keys', () => {
    expect(stabilityVerdictKey(1)).toBe('stability.stable');
    expect(stabilityVerdictKey(0)).toBe('stability.marginal');
    expect(stabilityVerdictKey(-1)).toBe('stability.unstable');
  });
});

describe('flight-event tables', () => {
  it('maps every prioritized event to a label', () => {
    for (const ev of EVENT_PRIORITY) {
      expect(EVENT_LABEL[ev]).toBeTruthy();
    }
  });

  it('orders APOGEE ahead of BURNOUT (most-significant first)', () => {
    expect(EVENT_PRIORITY.indexOf('APOGEE')).toBeLessThan(EVENT_PRIORITY.indexOf('BURNOUT'));
  });
});
