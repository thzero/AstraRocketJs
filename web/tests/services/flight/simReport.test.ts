import { describe, it, expect } from 'vitest';
import {
  stabilityState,
  stabilityTone,
  stabilityVerdictKey,
  stabilityToneOf,
  EVENT_LABEL,
  EVENT_PRIORITY,
  clusterEventLabels,
} from '../../../src/services/flight/simReport';

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
    expect(stabilityTone(1)).toBe('text-ok-400');
    expect(stabilityTone(2.5)).toBe('text-ok-400');
    expect(stabilityTone(0)).toBe('text-warn-400');
    expect(stabilityTone(0.5)).toBe('text-warn-400');
    expect(stabilityTone(-0.1)).toBe('text-danger-400');
  });
});

describe('stabilityVerdictKey', () => {
  it('splits under-stable into marginal and unstable, and names the over-stable band', () => {
    expect(stabilityVerdictKey(1)).toBe('stability.stable');
    expect(stabilityVerdictKey(6)).toBe('stability.stable');
    expect(stabilityVerdictKey(0)).toBe('stability.marginal');
    expect(stabilityVerdictKey(-1)).toBe('stability.unstable');
    // The drawing calls this over-stable; the stats strip must not call it stable.
    expect(stabilityVerdictKey(7)).toBe('schematic.overStable');
  });
});

/**
 * The on-pad readouts share one band: the stats strip, the info card and the 2D
 * and 3D drawings. A 7-caliber design was green "stable" in the strip and amber
 * over-stable beside it; 0.5 cal was amber in the strip and red in the drawing.
 */
describe('stabilityToneOf', () => {
  it('colors a margin by its band, as every on-pad readout does', () => {
    expect(stabilityToneOf(stabilityState(7)!)).toBe('text-warn-400');
    expect(stabilityToneOf(stabilityState(0.5)!)).toBe('text-danger-400');
    expect(stabilityToneOf(stabilityState(3)!)).toBe('text-ok-400');
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

describe('clusterEventLabels', () => {
  // 1 px per second keeps the math obvious.
  const x = (t: number) => t;

  it('keeps the drogue deployment at apogee as its own label (Fireball case)', () => {
    // Sustainer branch: apogee 13.2, ejection 14.7, drogue 14.7, main 34.2.
    const evts = [
      { time: 13.2, type: 'APOGEE' },
      { time: 14.7, type: 'EJECTION_CHARGE' },
      { time: 14.7, type: 'RECOVERY_DEVICE_DEPLOYMENT' },
      { time: 34.2, type: 'RECOVERY_DEVICE_DEPLOYMENT' },
    ];
    const out = clusterEventLabels(evts, x);
    // Apogee absorbs the coincident ejection charge; BOTH deployments survive.
    expect(out.map((g) => g.type)).toEqual(['APOGEE', 'RECOVERY_DEVICE_DEPLOYMENT', 'RECOVERY_DEVICE_DEPLOYMENT']);
  });

  it('still folds a burnout+apogee pileup into the highest-priority label', () => {
    const evts = [
      { time: 10.0, type: 'BURNOUT' },
      { time: 10.1, type: 'APOGEE' },
    ];
    expect(clusterEventLabels(evts, x).map((g) => g.type)).toEqual(['APOGEE']);
  });

  it('does not merge deployments that are far apart', () => {
    const evts = [
      { time: 5, type: 'RECOVERY_DEVICE_DEPLOYMENT' },
      { time: 40, type: 'RECOVERY_DEVICE_DEPLOYMENT' },
    ];
    expect(clusterEventLabels(evts, x)).toHaveLength(2);
  });
});
