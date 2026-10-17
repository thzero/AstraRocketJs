import type { MotorSpec, RocketTree } from '../../engine/openRocketEngine';
import { catalogDigest, loadCatalog, matchCatalogMotor, sameMaker } from './motorDb';
import { liveMotors, type FlightConfig } from '../flight/flightConfigs';
import type { OrkExportMotor } from '../files/orkFile';
import { embeddedMotorFile } from '../files/ork/embeddedMotors';

/**
 * Build the mount-id -> export-motor map shared verbatim by the `.ork` and
 * RASAero writers: every mount the flight configuration seats a motor in, in
 * tree order, with the ignition override that mount carries.
 *
 * `base` carries through what an import captured for each mount (the file's
 * digest, its manufacturer) that this map has no model for, while the mount
 * still holds the motor the file named. The captured digest goes out only when
 * `fillMotorDigests` has nothing to put in its place: with the catalog loaded,
 * a motor the catalog names gets the catalog's digest and any other the digest
 * of its own embedded curve. `base` is one configuration's motors as the file
 * was opened, and a digest written under another motor's name is the one
 * desktop goes by, since ThrustCurveMotorSetDatabase.findMotors puts a digest
 * match ahead of a name match. A mount that now holds a different motor takes
 * nothing from it.
 *
 * The manufacturer is the motor's own when it has one. The desktop's findMotors
 * filters by manufacturer when the file names one, so a made-up one resolves
 * nothing, and with none it goes by the designation alone. Every motor the
 * picker seats carries its manufacturer (thrustcurve.ts), and this map writes
 * it through.
 *
 * The digest is the other half of resolving it, and it is filled in separately,
 * by `fillMotorDigests`.
 *
 * A mount a loaded file left empty holds a placeholder with no designation
 * (`emptyMountMotor` in loadOrk.ts). That is no motor, and it is left out:
 * written as one, the desktop looks up a motor named '' and reports it missing.
 */
export function buildExportMotorMap(
  tree: RocketTree,
  config: FlightConfig,
  base: Record<string, OrkExportMotor> = {},
): Record<string, OrkExportMotor> {
  const motors: Record<string, OrkExportMotor> = {};
  for (const [id, m] of liveMotors(tree, config)) {
    if (!m.spec.designation) continue;
    const captured = base[id];
    motors[id] = {
      ...(captured && namesSeated(captured, m.spec) ? captured : {}),
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

/**
 * Whether an imported ref names the seated motor: the same delay, the
 * designation under either of the motor's names, and the same maker where both
 * name one. A file desktop wrote names a motor by its full code (`H128W`),
 * where the seated spec keeps the common name (`H128`) and the code beside it.
 */
function namesSeated(ref: OrkExportMotor, spec: MotorSpec): boolean {
  const norm = (s: string) => s.trim().toLowerCase();
  const named = norm(ref.designation);
  if (named !== norm(spec.designation) && named !== norm(spec.code ?? '')) return false;
  if (ref.delay !== spec.ejectionDelay) return false;
  if (!ref.manufacturer || !spec.manufacturer) return true;
  return norm(ref.manufacturer) === norm(spec.manufacturer);
}

/** A catalog row is only this motor if its diameter agrees, to the millimeter. */
const DIAMETER_TOLERANCE_MM = 1;

/**
 * Fill in each motor's OpenRocket digest from the motor catalog.
 *
 * Why the digest is needed: the desktop resolves a motor by manufacturer,
 * designation, diameter and length, and its database holds several entries
 * behind one of those names (Estes C6 is a plugged one and a delayed one), so
 * with nothing to choose between them it takes the first and says so:
 * "Multiple motors with designation 'C6' for manufacturer 'Estes' found, one
 * chosen arbitrarily". The digest is the only field that names which, which is
 * why the desktop writes one into every `<motor>` block it saves.
 *
 * Why at write time, and not when the motor is picked: a seated motor's full
 * spec is persisted with the design, and nothing re-resolves a spec that is
 * already stored, so a spec saved without a digest would never gain one.
 * Looking it up here makes the digest a property of the file rather than of
 * the session that happened to seat the motor.
 *
 * The delay is what picks between the entries, and where it does not the sync
 * has already put the closest motor first (`sync-motor-digests.mjs`).
 *
 * A catalog row stands for the motor only when, among the rows of its
 * diameter, the name finds it with no doubt (`matchCatalogMotor`) and the
 * motor names a maker the row's answers to. A digest match wins in desktop's
 * ThrustCurveMotorSetDatabase.findMotors whatever the maker, so a row taken on
 * less would have desktop fly that stock motor in place of this one: a
 * "Homemade G80" is not AeroTech's, a shortened name or a bare "C6" is a guess.
 * Any other motor travels with its own curve, named by that curve's digest, and
 * so does a curve the user imported (`MotorSpec.imported`), whatever it is
 * called: under a catalog motor's maker and name it is still not that motor's
 * curve, and named as the catalog motor it would reopen as the catalog's.
 * A row the desktop's database has no entry for gives no digest, and the motor
 * keeps whatever it came in with: a checksum that matches nothing is worse than
 * none, because the desktop then reports the motor as changed rather than
 * resolving it.
 *
 * Offline-safe. The catalog is a runtime fetch and a save must not depend on
 * it, so a failure leaves every motor exactly as it arrived.
 */
export async function fillMotorDigests(
  motors: Record<string, OrkExportMotor>,
): Promise<Record<string, OrkExportMotor>> {
  let catalog;
  try {
    // The bundled rows only. `loadCatalog` puts the user's imported motors
    // first, and an imported motor matches its own row there, which has no
    // digest: it would go out with neither a digest nor its curve, and desktop
    // could not find it. Off that list it is held to the bundled rows like any
    // other motor.
    catalog = (await loadCatalog()).filter((row) => row.custom !== true);
  } catch {
    return motors;
  }
  const out: Record<string, OrkExportMotor> = {};
  for (const [id, m] of Object.entries(motors)) {
    // Only rows of this motor's diameter are candidates, so a maker's two
    // sizes under one name (Quest's 13 mm and 18 mm A3) are not a doubt. By
    // the full code where the seated motor has one: a maker can sell two
    // motors under one common name (AeroTech's F67C and F67W are both F67),
    // which the common name alone leaves in doubt.
    const sized = catalog.filter((row) => Math.abs(row.diameter - m.diameter * 1000) <= DIAMETER_TOLERANCE_MM);
    const match = matchCatalogMotor(sized, m.seated?.code || m.designation, m.manufacturer);
    const maker = m.manufacturer?.trim().toLowerCase();
    const row =
      !m.seated?.imported && match && !match.doubt && maker && sameMaker(match.motor.manufacturer, maker)
        ? match.motor
        : undefined;
    const digest = row ? catalogDigest(row, m.delay) : undefined;
    // One the catalog has is written as the catalog's, embedding nothing.
    const embedded = !row && m.seated ? embeddedMotorFile(m.seated) : null;
    out[id] = embedded ? { ...m, embedded, digest: embedded.digest } : digest ? { ...m, digest } : m;
  }
  return out;
}
