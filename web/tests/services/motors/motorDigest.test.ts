import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { unzipSync, strToU8 } from 'fflate';
import { md5Hex } from '../../../src/services/motors/md5';
import { embeddedMotorFile, rowsDigest, rseDigest } from '../../../src/services/files/ork/embeddedMotors';
import type { MotorSpec } from '../../../src/engine/openRocketEngine';

describe('md5Hex', () => {
  it('matches the RFC 1321 test suite', () => {
    expect(md5Hex(strToU8(''))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5Hex(strToU8('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5Hex(strToU8('message digest'))).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(md5Hex(strToU8('12345678901234567890123456789012345678901234567890123456789012345678901234567890'))).toBe(
      '57edf4a22be3c955ac49da2e2107b67a',
    );
  });
});

const attr = (s: string, k: string): number => {
  const m = new RegExp(`(?:^|\\s)${k}="([^"]*)"`).exec(s);
  if (!m) throw new Error(`no ${k} in ${s}`);
  return Number(m[1]);
};

const rowsOf = (text: string) =>
  [...text.matchAll(/<eng-data ([^>]*?)\/>/g)].map((m) => ({
    t: attr(m[1]!, 't'),
    f: attr(m[1]!, 'f'),
    m: attr(m[1]!, 'm') / 1000,
    cg: attr(m[1]!, 'cg') / 1000,
  }));

/**
 * The ground truth: the desktop's own example designs embed their motors as
 * `thrustcurves/<digest>.rse`. Where the desktop named the file by the digest of
 * its own content, which is how every file we write is named, reading it back
 * the way the desktop's loader does and hashing it reproduces the name. That is
 * the check the desktop makes when it opens a `.ork` we write.
 *
 * The pods example's Estes A10 is left out: its name is the motor database's
 * digest of a source file that is not in the archive, and no hash of the
 * embedded rows reproduces it, so the desktop resolves it from its database.
 */
const SELF_NAMED: Record<string, string[]> = {
  'two-stage-high-power-rocket.ork': [
    'a06234b6049c1079e394cb9ecd4607a9',
    'a0006978c9a542518b425c0caa67042b',
    '1a3327383625336706131b2a9d198139',
  ],
  'pods-powered-with-recovery-deployment.ork': ['bd060845629e4cfceec7e9b19297ab9f'],
};

describe('the motor digest, against files the desktop wrote', () => {
  for (const [example, digests] of Object.entries(SELF_NAMED)) {
    it(`reproduces the embedded curve names in ${example}`, () => {
      const zip = unzipSync(new Uint8Array(readFileSync(resolve(__dirname, '../../../public/examples', example))));
      for (const digest of digests) {
        const text = new TextDecoder().decode(zip[`thrustcurves/${digest}.rse`]!);
        expect(rowsDigest(rowsOf(text))).toBe(digest);
      }
    });
  }
});

/**
 * Desktop's `RockSimMotorLoader` sorts the rows by time before it finalizes
 * and hashes them. The digests are what OpenRocket 24.12's own loader computes
 * for these two files (`RockSimMotorLoader.load(...).build().getDigest()`).
 */
describe('rseDigest, rows out of time order', () => {
  const rse = (rows: string[]) =>
    [
      '<engine-database>',
      ' <engine-list>',
      '  <engine mfg="Estes" code="C6" Type="single-use" dia="18" len="70" initWt="24" propWt="12" auto-calc-mass="0" auto-calc-cg="0">',
      '   <data>',
      ...rows.map((r) => `    <eng-data ${r}/>`),
      '   </data>',
      '  </engine>',
      ' </engine-list>',
      '</engine-database>',
    ].join('\n');

  it('sorts before hashing, as desktop does', () => {
    const text = rse([
      't="0.2" f="14" m="21" cg="35"',
      't="0" f="0" m="24" cg="35"',
      't="1.8" f="0" m="12" cg="35"',
      't="1" f="9" m="16" cg="34"',
    ]);
    expect(rseDigest(text)).toBe('53b7e867ec245a1935341254ecb8793d');
  });

  it('keeps the mass and CG entry desktop leaves behind when it drops a doubled t = 0 point', () => {
    const text = rse([
      't="0.2" f="14" m="21" cg="36"',
      't="0" f="0" m="24" cg="35"',
      't="0" f="3" m="23.5" cg="35.5"',
      't="1.8" f="0" m="12" cg="33"',
      't="1" f="9" m="16" cg="34"',
    ]);
    expect(rseDigest(text)).toBe('db1800174bc27717e987931e63fa4012');
  });
});

describe('embeddedMotorFile', () => {
  const spec: MotorSpec = {
    designation: 'G80',
    manufacturer: 'Custom',
    diameter: 0.029,
    length: 0.124,
    times: [0, 0.05, 0.9, 1.2],
    thrusts: [0, 95.3, 70.25, 0],
    masses: [0.1253, 0.1241, 0.0911, 0.0874],
    cgX: 0.062,
    ejectionDelay: 7,
  };

  it('names the file by the digest the desktop computes from what it reads back', () => {
    const file = embeddedMotorFile(spec)!;
    expect(file.path).toBe(`thrustcurves/${file.digest}.rse`);
    expect(rowsDigest(rowsOf(file.text))).toBe(file.digest);
  });

  it('states mass and CG on every row, so the desktop recomputes nothing', () => {
    const file = embeddedMotorFile(spec)!;
    expect(file.text).toContain('auto-calc-mass="0" auto-calc-cg="0"');
    expect(rowsOf(file.text)).toEqual([
      { t: 0, f: 0, m: 0.1253, cg: 0.062 },
      { t: 0.05, f: 95.3, m: 0.1241, cg: 0.062 },
      { t: 0.9, f: 70.25, m: 0.0911, cg: 0.062 },
      { t: 1.2, f: 0, m: 0.0874, cg: 0.062 },
    ]);
  });

  it('carries no file for a motor without a curve', () => {
    expect(embeddedMotorFile({ ...spec, times: [], thrusts: [], masses: [] })).toBeNull();
  });
});
