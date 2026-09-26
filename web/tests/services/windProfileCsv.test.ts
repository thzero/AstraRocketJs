import { describe, it, expect } from 'vitest';
import { parseWindProfileCsv, WindProfileCsvError } from '../../src/services/windProfileCsv';

const csv = (...rows: string[]) => rows.join('\n');

describe('parseWindProfileCsv', () => {
  it('reads the desktop convenience format', () => {
    const levels = parseWindProfileCsv(
      csv('altitude,speed,direction,stddev', '0,4,90,0.4', '500,8,110,1.2', '1000,12,130,2.4'),
    );
    expect(levels).toEqual([
      { altitudeM: 0, speed: 4, directionDeg: 90, stddev: 0.4 },
      { altitudeM: 500, speed: 8, directionDeg: 110, stddev: 1.2 },
      { altitudeM: 1000, speed: 12, directionDeg: 130, stddev: 2.4 },
    ]);
  });

  it('sorts by altitude however the file was ordered', () => {
    const levels = parseWindProfileCsv(csv('altitude,speed,direction,stddev', '900,9,90,0', '0,3,90,0', '300,5,90,0'));
    expect(levels.map((l) => l.altitudeM)).toEqual([0, 300, 900]);
  });

  it('treats the standard deviation as optional, column and cell alike', () => {
    expect(parseWindProfileCsv(csv('altitude,speed,direction', '0,4,90'))[0]!.stddev).toBe(0);
    expect(parseWindProfileCsv(csv('altitude,speed,direction,stddev', '0,4,90,'))[0]!.stddev).toBe(0);
  });

  it('accepts semicolon and tab separated files', () => {
    expect(parseWindProfileCsv(csv('altitude;speed;direction', '0;4;90'))[0]!.speed).toBe(4);
    expect(parseWindProfileCsv(csv('altitude\tspeed\tdirection', '0\t4\t90'))[0]!.speed).toBe(4);
  });

  it('accepts the header spellings a sounding actually ships with', () => {
    const levels = parseWindProfileCsv(csv('Altitude MSL,Wind Speed,Heading,Std_Dev', '0,4,90,0.4'));
    expect(levels[0]).toEqual({ altitudeM: 0, speed: 4, directionDeg: 90, stddev: 0.4 });
  });

  it('survives a spreadsheet BOM on the first header', () => {
    expect(parseWindProfileCsv('﻿altitude,speed,direction\n0,4,90')).toHaveLength(1);
  });

  it('skips blank lines rather than failing on them', () => {
    expect(parseWindProfileCsv(csv('altitude,speed,direction', '0,4,90', '', '500,8,90', ''))).toHaveLength(2);
  });

  it('rejects a file with no usable columns', () => {
    expect(() => parseWindProfileCsv(csv('height,knots', '0,4'))).toThrow(WindProfileCsvError);
    try {
      parseWindProfileCsv(csv('height,knots', '0,4'));
    } catch (e) {
      expect((e as WindProfileCsvError).key).toBe('missingColumns');
    }
  });

  it('reports the line for a short or non-numeric row', () => {
    try {
      parseWindProfileCsv(csv('altitude,speed,direction', '0,4,90', '500,8'));
    } catch (e) {
      expect((e as WindProfileCsvError).key).toBe('shortRow');
      expect((e as WindProfileCsvError).line).toBe(3);
    }
    try {
      parseWindProfileCsv(csv('altitude,speed,direction', '0,brisk,90'));
    } catch (e) {
      expect((e as WindProfileCsvError).key).toBe('badNumber');
      expect((e as WindProfileCsvError).line).toBe(2);
    }
  });

  it('rejects an empty file and a header with no rows', () => {
    expect(() => parseWindProfileCsv('   ')).toThrow(/emptyFile/);
    expect(() => parseWindProfileCsv('altitude,speed,direction')).toThrow(/noData/);
  });
});

/**
 * A blank required cell is not a zero.
 *
 * `Number('')` is 0 and 0 passes `Number.isFinite`, so an empty altitude or
 * speed imported as a genuine 0 m/s reading at that level. The module's own
 * contract is that every failure throws rather than returning a short list,
 * and `stddev` is the only column where blank legitimately means "none".
 */
describe('a blank cell in a required column', () => {
  it('fails the row rather than reading as 0 m/s', () => {
    expect(() => parseWindProfileCsv('altitude,speed,direction\n100,,90\n')).toThrow();
    expect(() => parseWindProfileCsv('altitude,speed,direction\n,5,90\n')).toThrow();
    expect(() => parseWindProfileCsv('altitude,speed,direction\n100,5,\n')).toThrow();
  });

  it('still treats a blank stddev as no scatter', () => {
    const levels = parseWindProfileCsv('altitude,speed,direction,stddev\n100,5,90,\n');
    expect(levels[0]!.stddev).toBe(0);
    expect(levels[0]!.speed).toBe(5);
  });
});

/**
 * `altitudeagl` was accepted as a plain alias for the altitude column and its
 * meaning dropped: the levels imported as MSL, which at a 1500 m site is a
 * different wind. The result now says what the header said, as a property on
 * the array so the callers that only iterate it are untouched.
 */
describe('the altitude reference the header names', () => {
  it('is agl for an AGL header and msl for an MSL one', () => {
    expect(parseWindProfileCsv(csv('altitude AGL,speed,direction', '0,4,90')).reference).toBe('agl');
    expect(parseWindProfileCsv(csv('altitude_agl (m),speed,direction', '0,4,90')).reference).toBe('agl');
    expect(parseWindProfileCsv(csv('Altitude MSL,Wind Speed,Heading', '0,4,90')).reference).toBe('msl');
  });

  it('is absent, not msl, for a header that says nothing', () => {
    const levels = parseWindProfileCsv(csv('altitude,speed,direction', '0,4,90'));
    expect(levels.reference).toBeUndefined();
    expect('reference' in levels).toBe(false); // no key at all, so toEqual on the array still holds
  });
});

/**
 * A spreadsheet quotes any header carrying a comma, space or parenthesis, so
 * `"altitude (m)"` arrived with its quotes on and matched no alias at all.
 */
describe('quoted headers and cells', () => {
  it('reads a header a spreadsheet quoted', () => {
    const levels = parseWindProfileCsv(
      csv('"altitude (m)","speed (m/s)","direction (deg)","stddev (m/s)"', '0,4,90,0.4'),
    );
    expect(levels).toEqual([{ altitudeM: 0, speed: 4, directionDeg: 90, stddev: 0.4 }]);
  });

  it('reads quoted numeric cells too', () => {
    const levels = parseWindProfileCsv(csv('altitude,speed,direction,stddev', '"100","5","90",""'));
    expect(levels).toEqual([{ altitudeM: 100, speed: 5, directionDeg: 90, stddev: 0 }]);
  });
});
