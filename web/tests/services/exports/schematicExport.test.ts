import { afterEach, describe, it, expect, vi } from 'vitest';
import { dataHeaderLines, type ExportData } from '../../../src/services/exports/schematicExport';
import { METRIC_UNITS } from '../../../src/prefs/units';
import { appName } from '../../../src/services/app/appInfo';
import type { StaticInfo } from '../../../src/engine/openRocketEngine';
import i18n from '../../../src/i18n';

const info = {
  length: 0.6,
  refDiameter: 0.024,
  mass: 0.12,
  massEmpty: 0.09,
  cg: 0.35,
  cp: 0.42,
  cna: 9.5,
  stabilityCalibers: 1.234,
} as unknown as StaticInfo;

const data = (over: Partial<ExportData> = {}): ExportData => ({
  name: 'My Rocket',
  info,
  units: { ...METRIC_UNITS, length: 'm', mass: 'g' },
  withMotors: true,
  appVersion: '9.9.9',
  t: (key, options) => i18n.t(key, options),
  ...over,
});

describe('dataHeaderLines', () => {
  it('emits just the name and a version/date footer when there is no static info', () => {
    const lines = dataHeaderLines(data({ info: null }));
    expect(lines[0]).toBe('My Rocket');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/v9\.9\.9, .*\d{4}/);
  });

  /**
   * The footer carries the day on the user's own clock. Late on the 15th in
   * Los Angeles it is already the 16th in UTC; early on the 15th in Tokyo it
   * is still the 14th. The expected day is the instant's own local date.
   */
  describe('dates the footer on the local day', () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    });

    it.each([
      ['America/Los_Angeles', [2026, 9, 15, 23, 50]],
      ['Asia/Tokyo', [2026, 9, 15, 0, 10]],
    ])('in %s', (zone, [y, mo, d, h, mi]) => {
      vi.stubEnv('TZ', zone);
      const at = new Date(y!, mo!, d!, h!, mi!);
      expect(at.getUTCDate()).not.toBe(at.getDate());
      vi.useFakeTimers();
      vi.setSystemTime(at);
      const footer = dataHeaderLines(data({ info: null }))[1]!;
      expect(footer).toContain(String(at.getFullYear()));
      expect(footer).toMatch(new RegExp(`\\b${at.getDate()}\\b`));
      expect(footer).not.toMatch(new RegExp(`\\b${at.getUTCDate()}\\b`));
    });
  });

  it('names the app the way every other export does', () => {
    const footer = dataHeaderLines(data({ info: null }))[1]!;
    expect(footer.startsWith(`${appName()} v9.9.9`)).toBe(true);
  });

  it('includes dimension, mass, and stability lines when info is present', () => {
    const lines = dataHeaderLines(data());
    expect(lines[0]).toBe('My Rocket');
    expect(lines.some((l) => l.includes('Length') && l.includes('max diameter'))).toBe(true);
    expect(lines.some((l) => l.includes('margin 1.23 cal'))).toBe(true); // toFixed(2)
  });

  it('states no CP or margin for a design with no normal force', () => {
    const finless = { ...info, cna: 0, cp: 0, stabilityCalibers: Number.NaN } as StaticInfo;
    const lines = dataHeaderLines(data({ info: finless }));
    expect(lines.some((l) => l.includes('CG 0.35'))).toBe(true);
    expect(lines.some((l) => l.includes('CP') || l.includes('margin'))).toBe(false);
  });

  it('switches mass wording on withMotors', () => {
    expect(dataHeaderLines(data({ withMotors: true })).some((l) => l.includes('Launch mass'))).toBe(true);
    const dry = dataHeaderLines(data({ withMotors: false }));
    expect(dry.some((l) => l.includes('Dry mass') && l.includes('no motors loaded'))).toBe(true);
  });

  it('writes the margin and joins the dimensions in the UI language', async () => {
    await i18n.changeLanguage('de');
    try {
      const lines = dataHeaderLines(data({ spanM: 0.1 }));
      // German decimals take a comma, like the lengths beside the margin.
      expect(lines.some((l) => l.includes(' 1,23 '))).toBe(true);
      expect(lines.some((l) => l.includes('1.23'))).toBe(false);
      // The lengths and masses too: 0.6 m long, 120 g at launch, 90 g dry.
      expect(lines.some((l) => l.includes('0,6 m'))).toBe(true);
      expect(lines.some((l) => l.includes('0,024 m'))).toBe(true);
      expect(lines.some((l) => l.includes('0.6 m') || l.includes('0.024 m'))).toBe(false);
      // Three dimensions as one German list: "A, B und C".
      expect(lines.some((l) => / und /.test(l) && l.includes(i18n.t('export.headerSpan', { value: '' }).trim()))).toBe(
        true,
      );
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('adds a span line only when spanM is given', () => {
    expect(dataHeaderLines(data()).some((l) => l.includes('span'))).toBe(false);
    expect(dataHeaderLines(data({ spanM: 0.1 })).some((l) => l.includes('span'))).toBe(true);
  });
});
