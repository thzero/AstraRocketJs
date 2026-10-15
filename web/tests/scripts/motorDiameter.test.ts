import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-expect-error - a plain .mjs build script helper, no types
import { motorRow, DIAMETER_DECIMALS } from '../../scripts/lib/motorRow.mjs';
// @ts-expect-error - a plain .mjs build script helper, no types
import { digestKey } from '../../scripts/lib/motorDigestKey.mjs';
import type { CatalogMotor } from '../../src/services/motors/motorDb';

/**
 * A motor's diameter survives the sync to the tenth of a millimeter.
 *
 * Desktop OpenRocket's motor database (`datafiles/thrustcurves/thrustcurves.ser`
 * in OpenRocket-24.12.jar) holds Apogee's 1/4A2, 1/2A2, A2 and B2 at
 * `ThrustCurveMotor.getDiameter()` = 0.0105 m, as scripts/motor-digests/
 * MotorDump.java prints them (its fifth column). thrustcurve.org's search
 * result for them says `diameter: 10.5`. A row rounded to whole millimeters
 * would show 11 mm, fly a 0.011 m motor and save one into the .ork, and the
 * digest step would have to round desktop's side to meet it.
 */
const DESKTOP_APOGEE_DIAMETER_M = 0.0105;

/** thrustcurve.org's search.json result for Apogee A2, the fields the row reads. */
const apogeeA2 = {
  motorId: '5f4294d20002310000000123',
  manufacturer: 'Apogee Components',
  manufacturerAbbrev: 'Apogee',
  designation: 'A2',
  commonName: 'A2',
  impulseClass: 'A',
  diameter: 10.5,
  length: 57,
  totImpulseNs: 2.3,
  burnTimeS: 1.2,
  totalWeightG: 7.5,
  propWeightG: 2.3,
  avgThrustN: 1.9,
  maxThrustN: 5.2,
};

describe('the motor row diameter', () => {
  it('keeps the tenth of a millimeter desktop holds for Apogee A2', () => {
    const row = motorRow(apogeeA2, undefined) as CatalogMotor;
    expect(row.diameter).toBeCloseTo(DESKTOP_APOGEE_DIAMETER_M * 1000, 9);
    expect(row.diameter).not.toBe(11);
  });

  it('keeps one decimal, so the digest key and the row agree on the tenth', () => {
    expect(DIAMETER_DECIMALS).toBe(1);
    expect((motorRow({ ...apogeeA2, diameter: 10.54 }, undefined) as CatalogMotor).diameter).toBe(10.5);
    expect((motorRow({ ...apogeeA2, diameter: 18 }, undefined) as CatalogMotor).diameter).toBe(18);
  });
});

describe('the motor digest key', () => {
  const desktopMm = DESKTOP_APOGEE_DIAMETER_M * 1000;

  it('keys a 10.5 mm row and the desktop 0.0105 m motor together, apart from 11 mm', () => {
    const row = motorRow(apogeeA2, undefined) as CatalogMotor;
    expect(digestKey('Apogee', 'A2', row.diameter)).toBe(digestKey('Apogee', 'A2', desktopMm));
    expect(digestKey('Apogee', 'A2', row.diameter)).not.toBe(digestKey('Apogee', 'A2', 11));
    expect(digestKey('Apogee', 'A2', row.diameter)).not.toBe(digestKey('Apogee', 'A2', 10));
  });

  it('keys whole-millimeter motors the same on either side of the match', () => {
    expect(digestKey('Estes', 'C6', 0.018 * 1000)).toBe(digestKey('Estes', 'C6', 18));
    expect(digestKey('Estes', 'C6', 18)).not.toBe(digestKey('Estes', 'C6', 18.5));
  });

  it('reads the maker and the designation the way a human does', () => {
    expect(digestKey('AeroTech', 'H128W', 29)).toBe(digestKey('aero-tech', 'h128 w', 29));
  });
});

/**
 * The committed catalog is what the sync wrote: the four Apogee motors at 10.5
 * mm, each with a digest, which the digest step finds only when its key meets
 * desktop's 0.0105 m at the same tenth.
 */
describe('the committed motor catalog', () => {
  const catalog = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../public/data/motors.generated.json', import.meta.url)), 'utf8'),
  ) as CatalogMotor[];

  it.each(['1/4A2', '1/2A2', 'A2', 'B2'])('holds Apogee %s at 10.5 mm with a desktop digest', (designation) => {
    const rows = catalog.filter((m) => m.manufacturer === 'Apogee' && m.designation === designation);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.diameter).toBeCloseTo(DESKTOP_APOGEE_DIAMETER_M * 1000, 9);
    expect(rows[0]!.digests?.length).toBeGreaterThan(0);
  });
});
