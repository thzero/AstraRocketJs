import { describe, it, expect } from 'vitest';
import { dataHeaderLines, type ExportData } from './schematicExport';
import type { StaticInfo } from '../engine/openRocketEngine';

const info = {
  length: 0.6, refDiameter: 0.024, mass: 0.12, massEmpty: 0.09,
  cg: 0.35, cp: 0.42, stabilityCalibers: 1.234,
} as unknown as StaticInfo;

const data = (over: Partial<ExportData> = {}): ExportData => ({
  name: 'My Rocket',
  info,
  units: { length: 'm', mass: 'g' },
  withMotors: true,
  appVersion: '9.9.9',
  ...over,
});

describe('dataHeaderLines', () => {
  it('emits just the name and a version/date footer when there is no static info', () => {
    const lines = dataHeaderLines(data({ info: null }));
    expect(lines[0]).toBe('My Rocket');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/v9\.9\.9 — \d{4}-\d{2}-\d{2}$/);
  });

  it('includes dimension, mass, and stability lines when info is present', () => {
    const lines = dataHeaderLines(data());
    expect(lines[0]).toBe('My Rocket');
    expect(lines.some((l) => l.includes('Length') && l.includes('max diameter'))).toBe(true);
    expect(lines.some((l) => l.includes('margin 1.23 cal'))).toBe(true); // toFixed(2)
  });

  it('switches mass wording on withMotors', () => {
    expect(dataHeaderLines(data({ withMotors: true })).some((l) => l.includes('Launch mass'))).toBe(true);
    const dry = dataHeaderLines(data({ withMotors: false }));
    expect(dry.some((l) => l.includes('Dry mass') && l.includes('no motors loaded'))).toBe(true);
  });

  it('adds a span line only when spanM is given', () => {
    expect(dataHeaderLines(data()).some((l) => l.includes('span'))).toBe(false);
    expect(dataHeaderLines(data({ spanM: 0.1 })).some((l) => l.includes('span'))).toBe(true);
  });
});
