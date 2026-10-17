import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalogDigest, type CatalogMotor } from '../../../src/services/motors/motorDb';
import { PLUGGED_DELAY } from '../../../src/engine/openRocketEngine';

/**
 * Which desktop entry a saved `.ork` names when the delay does not decide.
 *
 * The masses are desktop's: `ThrustCurveMotor.getLaunchMass` for every entry
 * of a catalog row with more than one, dumped from OpenRocket-24.12.jar by
 * `scripts/motor-digests/MotorDump.java` and keyed by digest. The app's loaded
 * mass is the row's `mass`, which `thrustcurve.ts` builds a bundled motor from.
 */
const CATALOG = JSON.parse(
  readFileSync(join(__dirname, '../../../public/data/motors.generated.json'), 'utf8'),
) as CatalogMotor[];
const DESKTOP_LAUNCH_MASS_KG = JSON.parse(readFileSync(join(__dirname, 'desktopLaunchMass.json'), 'utf8')) as Record<
  string,
  number
>;

/** Launch masses more than this far apart, relative, are different motors. */
const DIFFERENT_MASS = 0.02;

const row = (manufacturer: string, code: string) =>
  CATALOG.find((m) => m.manufacturer === manufacturer && (m.code ?? m.designation) === code)!;
const appMassKg = (r: CatalogMotor) => r.mass / 1000;
const massError = (r: CatalogMotor, digest: string) =>
  Math.abs(DESKTOP_LAUNCH_MASS_KG[digest]! - appMassKg(r)) / appMassKg(r);

/** Every delay a row's entries offer, as `catalogDigest` takes one. */
const delaysOf = (r: CatalogMotor) =>
  [...new Set(r.digests!.flatMap((e) => e.delays))].map((d) => (d === 'P' ? PLUGGED_DELAY : d));

describe('a motor whose desktop entries differ in launch mass', () => {
  it.each([
    ['AeroTech', 'L339N'],
    ['Cesaroni', '601I350-16A'],
  ])('%s %s names the entry desktop loads with the mass the app flies', (manufacturer, code) => {
    const r = row(manufacturer, code);
    // The premise: two entries, the delay offered by both, and masses apart.
    expect(r.digests!.length).toBeGreaterThan(1);
    const masses = r.digests!.map((e) => DESKTOP_LAUNCH_MASS_KG[e.digest]!);
    expect(Math.max(...masses) / Math.min(...masses)).toBeGreaterThan(1 + DIFFERENT_MASS);
    for (const delay of delaysOf(r)) {
      expect(DESKTOP_LAUNCH_MASS_KG[catalogDigest(r, delay)!]).toBeCloseTo(appMassKg(r), 6);
    }
  });

  it('holds across the catalog: no delay names a different mass while an entry with ours offers it', () => {
    const covered = CATALOG.filter(
      (r) => (r.digests?.length ?? 0) > 1 && r.digests!.every((e) => e.digest in DESKTOP_LAUNCH_MASS_KG),
    );
    expect(covered.length).toBeGreaterThan(100);
    const wrong: string[] = [];
    for (const r of covered) {
      for (const delay of delaysOf(r)) {
        const want = delay >= PLUGGED_DELAY ? 'P' : delay;
        const offering = r.digests!.filter((e) => e.delays.includes(want));
        const best = Math.min(...offering.map((e) => massError(r, e.digest)));
        const chosen = massError(r, catalogDigest(r, delay)!);
        if (best <= DIFFERENT_MASS && chosen > DIFFERENT_MASS)
          wrong.push(`${r.manufacturer} ${r.code ?? r.designation}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
