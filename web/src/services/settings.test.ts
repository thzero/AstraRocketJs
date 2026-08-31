// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from './settings';

const KEY = 'astrarrocketjs:settings:v1';

beforeEach(() => localStorage.clear());

describe('loadSettings', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('deep-merges partial simulation prefs over the defaults', () => {
    localStorage.setItem(KEY, JSON.stringify({ simulation: { timeStep: 0.1 } }));
    const s = loadSettings();
    expect(s.simulation.timeStep).toBe(0.1); // overridden
    expect(s.simulation.maxTime).toBe(DEFAULT_SETTINGS.simulation.maxTime); // default kept
    expect(s.simulation.confirmDelete).toBe(DEFAULT_SETTINGS.simulation.confirmDelete);
  });

  it('deep-merges partial phase colors', () => {
    localStorage.setItem(KEY, JSON.stringify({ phaseColors: { boost: '#000000' } }));
    const s = loadSettings();
    expect(s.phaseColors.boost).toBe('#000000');
    expect(s.phaseColors.coast).toBe(DEFAULT_SETTINGS.phaseColors.coast);
  });

  it('guards playbackSpeed against a non-number', () => {
    localStorage.setItem(KEY, JSON.stringify({ playbackSpeed: 'fast' }));
    expect(loadSettings().playbackSpeed).toBe(DEFAULT_SETTINGS.playbackSpeed);
  });

  it('falls back to defaults on corrupt JSON', () => {
    localStorage.setItem(KEY, '{not valid');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('defaults wipAcknowledged to false and round-trips a stored true', () => {
    expect(loadSettings().wipAcknowledged).toBe(false);
    localStorage.setItem(KEY, JSON.stringify({ wipAcknowledged: true }));
    expect(loadSettings().wipAcknowledged).toBe(true);
  });
});

describe('saveSettings', () => {
  it('round-trips through localStorage', () => {
    const custom = { ...DEFAULT_SETTINGS, playbackSpeed: 2, partColors: { fins: '#123456' } };
    saveSettings(custom);
    const s = loadSettings();
    expect(s.playbackSpeed).toBe(2);
    expect(s.partColors.fins).toBe('#123456');
  });
});
