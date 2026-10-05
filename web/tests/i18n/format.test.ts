import { describe, it, expect } from 'vitest';
import { fmtSig, fmtUpTo, ladderDigits, partLabel, stageLabel, withUnit } from '../../src/i18n/format';
import i18n from '../../src/i18n';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { siToUi } from '../../src/prefs/units';
import { DROGUE_BAND, MAIN_BAND } from '../../src/services/flight/recoverySizing';

/**
 * The helpers behind every figure that is authored in one unit and shown in
 * another: the descent bands (ft/s), and the NAR / Tripoli caps (mph, degrees).
 */

describe('ladderDigits', () => {
  it('gives fewer decimals the larger the number', () => {
    expect(ladderDigits(1234)).toBe(0);
    expect(ladderDigits(30.44)).toBe(1);
    expect(ladderDigits(4.572)).toBe(2);
    expect(ladderDigits(0.349)).toBe(3);
  });

  it('reads the magnitude, not the sign', () => {
    expect(ladderDigits(-30.44)).toBe(1);
  });
});

describe('fmtUpTo', () => {
  it('drops decimals a round number does not need', () => {
    expect(fmtUpTo(20, 1)).toBe('20');
    expect(fmtUpTo(15, 1)).toBe('15');
  });

  it('keeps the ones it does', () => {
    expect(fmtUpTo(30.44, 1)).toBe('30.4');
    expect(fmtUpTo(8.9408, 1)).toBe('8.9');
  });

  it('is a dash for a value that is not a number', () => {
    expect(fmtUpTo(Number.NaN, 1)).toBe('—');
    expect(fmtUpTo(Number.POSITIVE_INFINITY, 1)).toBe('—');
  });
});

describe('withUnit', () => {
  it('closes degrees up against the number and spaces everything else', () => {
    expect(withUnit('20', '°')).toBe('20°');
    expect(withUnit('8.9', 'm/s')).toBe('8.9 m/s');
    expect(withUnit('15–20', 'ft/s')).toBe('15–20 ft/s');
  });
});

describe('a descent band in the reader unit', () => {
  // The whole reason these helpers exist: the bands are round in ft/s and in
  // nothing else, so a fixed decimal count spoils one unit or the other.
  const band = (b: { min: number; max: number }, sym: string) =>
    withUnit(`${fmtUpTo(siToUi('velocity', sym, b.min), 1)}–${fmtUpTo(siToUi('velocity', sym, b.max), 1)}`, sym);

  it('stays round in the unit it was authored in', () => {
    expect(band(MAIN_BAND, 'ft/s')).toBe('15–20 ft/s');
    expect(band(DROGUE_BAND, 'ft/s')).toBe('50–75 ft/s');
  });

  it('carries one decimal into the units that need it', () => {
    expect(band(MAIN_BAND, 'm/s')).toBe('4.6–6.1 m/s');
    expect(band(DROGUE_BAND, 'm/s')).toBe('15.2–22.9 m/s');
  });
});

/**
 * An unnamed stage reads the same in every view, through one interpolated key.
 * Gluing a translated word to a number is wrong in a language that puts the
 * number first (ja: "第 2 段"), and the PDF wrote English "Stage 2" in every
 * language.
 */
describe('stageLabel', () => {
  it('names a stage by its own name, else by an interpolated number', async () => {
    const t = i18n.getFixedT('ja');
    expect(stageLabel(t, 1)).toBe('第 2 段');
    expect(stageLabel(t, 1, '  ')).toBe('第 2 段');
    expect(stageLabel(t, 0, 'Booster')).toBe('Booster');
  });

  it('is the only way a view numbers a stage', () => {
    const src = resolve(__dirname, '../../src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          if (entry !== 'vendor' && entry !== 'locales') walk(path);
        } else if (/\.tsx?$/.test(entry)) {
          const text = readFileSync(path, 'utf8');
          if (/t\('flight\.stage'\)\}\s*\$\{|\|\|\s*`Stage \$\{/.test(text)) offenders.push(path.slice(src.length + 1));
        }
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
  });
});

/**
 * A part as every view names it: its own name, trimmed, else its translated
 * type, else the raw type for one the locale does not know. Copies disagreed:
 * one used `??`, so a cleared Name field drew a blank title.
 */
describe('partLabel', () => {
  const t = i18n.getFixedT('en');
  it('falls back to the translated type for an empty or blank name', () => {
    expect(partLabel(t, { type: 'bodytube', name: '' })).toBe(t('part.bodytube'));
    expect(partLabel(t, { type: 'bodytube', name: '  ' })).toBe(t('part.bodytube'));
    expect(partLabel(t, { type: 'bodytube' })).toBe(t('part.bodytube'));
    expect(partLabel(t, { type: 'bodytube', name: ' Airframe ' })).toBe('Airframe');
    expect(partLabel(t, { type: 'widget' })).toBe('widget');
  });
});

/**
 * Significant figures in the reader's locale, for numbers spanning orders of
 * magnitude (the inertia tiles). Built on toPrecision/toExponential they printed
 * "0.001234" beside "0,12" in a German strip.
 */
describe('fmtSig', () => {
  it('keeps four significant figures in the reader locale', async () => {
    await i18n.changeLanguage('de');
    try {
      expect(fmtSig(0.0012345, 4)).toBe('0,001235');
      expect(fmtSig(0.00001234, 4)).toMatch(/^1,234E-5$/);
    } finally {
      await i18n.changeLanguage('en');
    }
    expect(fmtSig(0.0012345, 4)).toBe('0.001235');
    expect(fmtSig(0, 4)).toBe('0');
    expect(fmtSig(Number.NaN, 4)).toBe('—');
  });
});
