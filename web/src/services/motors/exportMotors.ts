import type { RocketTree } from '../../engine/openRocketEngine';
import { catalogDigest, findCatalogMotor, loadCatalog } from './motorDb';
import { liveMotors, type FlightConfig } from '../flight/flightConfigs';
import type { OrkExportMotor } from '../files/orkFile';
import { embeddedMotorFile } from '../files/ork/embeddedMotors';

/**
 * Build the mount-id -> export-motor map shared verbatim by the `.ork` and
 * RASAero writers: every mount the flight configuration seats a motor in, in
 * tree order, with the ignition override that mount carries.
 *
 * `base` carries through fields captured at import that this map has no model
 * for, so a round-trip export does not drop them.
 *
 * The MANUFACTURER is the motor's own, not just the imported one. The desktop
 * finds a motor by manufacturer and designation together, so a file that names
 * no manufacturer is a file whose motors it cannot resolve: it says "No motor
 * with designation 'C6' for manufacturer 'custom' found" and opens the design
 * with an empty mount. Every motor the picker seats carries its manufacturer
 * (thrustcurve.ts), and this is where it was being dropped.
 *
 * The DIGEST is the other half of resolving it, and it is filled in separately,
 * by `fillMotorDigests`.
 */
export function buildExportMotorMap(
  tree: RocketTree,
  config: FlightConfig,
  base: Record<string, OrkExportMotor> = {},
): Record<string, OrkExportMotor> {
  const motors: Record<string, OrkExportMotor> = {};
  for (const [id, m] of liveMotors(tree, config)) {
    motors[id] = {
      ...base[id],
      designation: m.spec.designation,
      ...(m.spec.manufacturer ? { manufacturer: m.spec.manufacturer } : {}),
      diameter: m.spec.diameter,
      length: m.spec.length,
      delay: m.spec.ejectionDelay,
      ignitionEvent: m.ignitionEvent,
      ignitionDelay: m.ignitionDelay,
      seated: m.spec,
    };
  }
  return motors;
}

/** A catalog row is only this motor if its diameter agrees, to the millimeter. */
const DIAMETER_TOLERANCE_MM = 1;

/**
 * Fill in each motor's OpenRocket digest from the motor catalog.
 *
 * WHY THE DIGEST IS NEEDED. The desktop resolves a motor by manufacturer,
 * designation, diameter and length, and its database holds SEVERAL entries
 * behind one of those names - Estes C6 is a plugged one and a delayed one - so
 * with nothing to choose between them it takes the first and says so:
 * "Multiple motors with designation 'C6' for manufacturer 'Estes' found, one
 * chosen arbitrarily". The digest is the only field that names which, which is
 * why the desktop writes one into every `<motor>` block it saves.
 *
 * WHY AT WRITE TIME, and not when the motor is picked. A seated motor's full
 * spec is persisted with the design, so a design built before the catalog
 * carried digests would never gain one: nothing re-resolves a spec that is
 * already in the file on disk. Looking it up here makes the digest a property
 * of the FILE rather than of the session that happened to seat the motor.
 *
 * The delay is what picks between the entries, and where it does not the sync
 * has already put the closest curve first (`sync-motor-digests.mjs`). A motor
 * with no catalog row, an imported one or one the desktop's database does not
 * contain, keeps whatever it came in with: a checksum that matches nothing is
 * worse than none, because the desktop then reports the motor as CHANGED rather
 * than resolving it.
 *
 * Offline-safe. The catalog is a runtime fetch and a save must not depend on
 * it, so a failure leaves every motor exactly as it arrived.
 */
export async function fillMotorDigests(
  motors: Record<string, OrkExportMotor>,
): Promise<Record<string, OrkExportMotor>> {
  let catalog;
  try {
    catalog = await loadCatalog();
  } catch {
    return motors;
  }
  const out: Record<string, OrkExportMotor> = {};
  for (const [id, m] of Object.entries(motors)) {
    const row = findCatalogMotor(catalog, m.designation, m.manufacturer);
    // `findCatalogMotor` is deliberately forgiving about the name, so the
    // diameter is what confirms it landed on the same motor.
    const same = row && Math.abs(row.diameter - m.diameter * 1000) <= DIAMETER_TOLERANCE_MM;
    const digest = same ? catalogDigest(row, m.delay) : undefined;
    // A motor the catalog does not have travels with its own curve, named by
    // that curve's digest: no database has it, so nothing else could name it.
    // One the catalog has is written as the catalog's, embedding nothing.
    const embedded = !row && m.seated ? embeddedMotorFile(m.seated) : null;
    out[id] = embedded ? { ...m, embedded, digest: embedded.digest } : digest ? { ...m, digest } : m;
  }
  return out;
}
