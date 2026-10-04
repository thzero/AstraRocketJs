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
    expect(importNotes(notes, within, t, units)).toBe(notes);
  });

  it('adds a note per launch condition outside the codes, after the reader notes', () => {
    const steep = { ...within, launchRodAngleDeg: 45 } as LaunchConditions;
    const out = importNotes(['A part was approximated.'], steep, t, units);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe('A part was approximated.');
    expect(out[1]).toMatch(/^limits\./);
  });
});
