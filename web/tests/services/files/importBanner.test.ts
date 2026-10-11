import { describe, it, expect } from 'vitest';
import { importNotes } from '../../../src/services/files/importBanner';
import type { LaunchConditions } from '../../../src/services/design/orkTree';
import { unitSymbols } from '../../../src/prefs/units';
import { DEFAULT_SETTINGS } from '../../../src/services/storage/settings';

const t = (key: string, vars: Record<string, unknown>) => `${key}${JSON.stringify(vars)}`;
const units = unitSymbols(DEFAULT_SETTINGS.units, DEFAULT_SETTINGS.unitOverrides);
const within = { launchRodAngleDeg: 5, windAverage: 2 } as unknown as LaunchConditions;

describe('importNotes', () => {
  it("hands back the reader's notes untouched when the launch is within the codes", () => {
    const notes = ['A part was approximated.'];
    expect(importNotes(notes, within, ['model'], t, units)).toBe(notes);
  });

  it('adds a note per launch condition outside the codes, after the reader notes', () => {
    const steep = { ...within, launchRodAngleDeg: 45 } as LaunchConditions;
    const out = importNotes(['A part was approximated.'], steep, ['model'], t, units);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe('A part was approximated.');
    expect(out[1]).toMatch(/^limits\./);
  });

  it('judges the angle once per class the configurations fly, and says a shared sentence once', () => {
    const tilted = { ...within, launchRodAngleDeg: 25 } as LaunchConditions;
    expect(importNotes([], tilted, ['model'], t, units)).toEqual([]);
    const both = importNotes([], tilted, ['model', 'highPower', 'highPower'], t, units);
    expect(both).toHaveLength(1);
    expect(both[0]).toMatch(/^limits\.rodAngleHighPower/);
    const windy = { ...within, windAverage: 40 } as LaunchConditions;
    expect(importNotes([], windy, ['model', 'highPower'], t, units)).toHaveLength(1);
  });
});
