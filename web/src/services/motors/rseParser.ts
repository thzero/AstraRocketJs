// Parser for RockSim `.rse` motor files, the XML thrust-curve format that
// carries what RASP `.eng` cannot: the motor type (so a hybrid imports as a
// hybrid) and the motor's mass sample by sample (`m`, the mass of the motor
// at that instant, as RockSimMotorWriter writes it), rather than one header
// number the mass curve has to be reconstructed from.
//
// A TypeScript port of OpenRocket's `file/motor/RockSimMotorLoader.java`, not
// an extraction of it, for the reason the `.rkt` design reader is one: that
// class is SAX-based and pulls in SimpleSAX, WarningSet, MotorDigest,
// Manufacturer and ThrustCurveMotor.Builder, the file-loading machinery the
// engine extraction deliberately leaves behind. The schema is small enough to
// read directly, and reading it here keeps both motor formats on the same side
// of the engine boundary: plain DOM, unit-testable, no kernel round trip.
//
// Deliberate differences from upstream, each because the thing it needs does
// not exist on this side:
//
//   - No `MotorDigest`. A parsed motor carries none. The one caller that needs
//     it, matching a `.ork`'s embedded `.rse` to the motor the design names,
//     hashes the file text itself (`ork/embeddedMotors.rseDigest`, through
//     `motorDigest.ts`).
//   - No manufacturer-based type inference. Upstream falls back to
//     `Manufacturer.getMotorType()` for a file with no `Type`, from a table of
//     known manufacturers we do not carry. An unrecognized type stays absent
//     instead, which is what the picker already renders for a motor whose type
//     the catalog does not give.
//   - No `calculateMass` port. Upstream reconstructs the mass curve from thrust
//     when the file omits it, and `thrustcurve.samplesToMotorSpec` already does
//     the identical arithmetic for every motor without per-sample mass (mass
//     falls from loaded to burnout in proportion to cumulative impulse, both by
//     the trapezoid rule). A file with no mass data therefore just omits
//     `massesG` and takes that path. `rseParser.test.ts` holds the two to each
//     other.
import type { CustomMotor } from './motorStore';
import { impulseClass } from './motorCombine';
import { delayList } from './motorPicker';
import { totalImpulse } from './engParser';
import { parseXmlText } from '../files/xmlUtil';
import { MAX_CURVE_SAMPLES, finalizeCurve } from './curveFinalize';
import { KeyedError } from '../../i18n/keyedError';

/** RockSim's `Type` attribute, mapped to the catalog's own vocabulary. */
const TYPES: Record<string, NonNullable<CustomMotor['type']>> = {
  'single-use': 'SU',
  hybrid: 'hybrid',
  reloadable: 'reload',
};

/**
 * Ceilings an untrusted `.rse` is held to.
 *
 * This parser is reached with no file picker: `loadOrk` runs it over every
 * `.rse` member an imported `.ork` carries, and that member may be up to the
 * archive's 64 MiB per-entry ceiling. The `.ork` reader caps fin points and
 * shroud lines for the same reason: without a cap, a member with a million
 * `<engine>` elements would freeze the tab while merely opening a shared design.
 *
 * A manufacturer's whole range is a few hundred motors. The per-motor sample
 * ceiling is `MAX_CURVE_SAMPLES`, shared with the `.eng` reader.
 */
export const MAX_RSE_ENGINES = 2000;

/** One `<eng-data>` row, before `finalizeCurve` fixes the curve's quirks. */
interface Point {
  time: number;
  thrust: number;
  /** Grams; NaN when the file gives none (the attribute is optional). */
  mass: number;
  /** Millimeters from the motor's forward end; NaN when absent. */
  cg: number;
}

/**
 * Strip a delay from the end of a designation, if present: `J350-14` is the
 * J350, and the delay is carried separately. Upstream's
 * `AbstractMotorLoader.removeDelay`, same regex.
 */
export function removeDelay(designation: string): string {
  return /-([0-9]+|[pP])$/.test(designation) ? designation.slice(0, designation.lastIndexOf('-')) : designation;
}

/** A required numeric attribute, in the file's own units. `whatKey` is the i18n key a refusal names it by. */
function num(el: Element, name: string, whatKey: string): number {
  const raw = el.getAttribute(name);
  if (raw === null) throw new KeyedError('errors.motorFile.rseMissing', { what: { key: whatKey } });
  // `Number('')` is 0, where upstream's `Double.parseDouble` refuses a blank.
  const v = raw.trim() === '' ? NaN : Number(raw);
  if (!Number.isFinite(v)) throw new KeyedError('errors.motorFile.rseInvalid', { what: { key: whatKey }, raw });
  return v;
}

/** An optional numeric attribute; NaN when absent, blank or unparseable, as upstream. */
function optNum(el: Element, name: string): number {
  const raw = el.getAttribute(name);
  if (raw === null || raw.trim() === '') return NaN;
  const v = Number(raw);
  return Number.isFinite(v) ? v : NaN;
}

/** One `<engine>` element as a stored custom motor. */
function parseEngine(el: Element): CustomMotor {
  const manufacturer = el.getAttribute('mfg')?.trim();
  if (!manufacturer) throw new KeyedError('errors.motorFile.rseNoMaker');
  const code = el.getAttribute('code')?.trim();
  if (!code) throw new KeyedError('errors.motorFile.rseNoCode');
  const designation = removeDelay(code);

  // The file's units are the ones this app stores: mm and grams. Upstream
  // divides all four by 1000 because the kernel is SI; `CustomMotor` is not,
  // and `samplesToMotorSpec` does that conversion at the engine boundary.
  const diameter = num(el, 'dia', 'errors.motorFile.attrDiameter');
  const length = num(el, 'len', 'errors.motorFile.attrLength');
  const totalWeightG = num(el, 'initWt', 'errors.motorFile.attrInitialMass');
  const propWeightG = num(el, 'propWt', 'errors.motorFile.attrPropellantMass');

  if (!(diameter > 0) || !(length > 0)) {
    throw new KeyedError('errors.motorFile.rseSize', { motor: designation });
  }
  // Upstream refuses this too. Without it the rocket gains mass as the motor
  // burns, which nothing downstream would report.
  if (!(propWeightG >= 0) || !(totalWeightG > 0) || propWeightG > totalWeightG) {
    throw new KeyedError('errors.motorFile.rseMass', { motor: designation });
  }

  const sampleEls = el.querySelectorAll('data > eng-data');
  if (sampleEls.length > MAX_CURVE_SAMPLES) {
    throw new KeyedError('errors.motorFile.rseTooManyPoints', { motor: designation, max: MAX_CURVE_SAMPLES });
  }
  const rows: Point[] = [...sampleEls].map((d) => ({
    time: optNum(d, 't'),
    thrust: optNum(d, 'f'),
    mass: optNum(d, 'm'),
    cg: optNum(d, 'cg'),
  }));
  for (const r of rows) {
    if (!Number.isFinite(r.time) || !Number.isFinite(r.thrust)) {
      throw new KeyedError('errors.motorFile.rseBadPoint', { motor: designation });
    }
    // A curve that starts before t = 0 gets a zero point put ahead of it, and
    // ThrustCurveMotor refuses a time that runs backward. The bridge builds
    // every seated motor through it, so the file is refused here.
    if (r.time < 0) throw new KeyedError('errors.motorFile.rseNegativeTime', { motor: designation });
  }
  const points = finalizeCurve(rows);
  if (points.length < 2) throw new KeyedError('errors.motorFile.rseNoCurve', { motor: designation });

  // ThrustCurveMotor refuses both of these, and the bridge builds every
  // seated motor through it, so the file is refused here as desktop drops it.
  if (points.some((p) => p.thrust < 0)) {
    throw new KeyedError('errors.motorFile.rseNegativeThrust', { motor: designation });
  }

  const samples = points.map((p) => ({ time: p.time, thrust: p.thrust }));

  // Mass and CG are each used only if the file gives them for every point and
  // does not ask for them to be recomputed. Upstream sets the same two flags
  // from `auto-calc-mass` / `auto-calc-cg` and from any NaN in the column; a
  // half-filled column cannot be interpolated and is no better than none.
  const autoMass = !isFalse(el.getAttribute('auto-calc-mass'));
  const autoCg = !isFalse(el.getAttribute('auto-calc-cg'));
  const haveMass = !autoMass && points.every((p) => Number.isFinite(p.mass));
  const haveCg = !autoCg && points.every((p) => Number.isFinite(p.cg));
  // A negative sample mass is refused, as ThrustCurveMotor's constructor
  // refuses it, and as the stored-motor check (motorStore `isMassArray`) would
  // drop the motor later without a word.
  if (haveMass && points.some((p) => p.mass < 0)) {
    throw new KeyedError('errors.motorFile.rseNegativeMass', { motor: designation });
  }
  if (haveCg && points.some((p) => p.cg < 0 || p.cg > length)) {
    throw new KeyedError('errors.motorFile.rseCgOutside', { motor: designation, length });
  }

  const type = TYPES[(el.getAttribute('Type') ?? '').trim().toLowerCase()];

  return {
    id: `custom:${manufacturer}:${designation}`,
    designation,
    manufacturer,
    class: impulseClass(totalImpulse(samples)),
    diameter,
    length,
    totalWeightG,
    propWeightG,
    delayList: delayList(el.getAttribute('delays'), 'rocksim'),
    type,
    // Grams, parallel to `samples`. This is the whole reason `.rse` is the
    // richer format: the mass curve is measured rather than inferred from the
    // thrust curve and one header number.
    massesG: haveMass ? points.map((p) => p.mass) : undefined,
    // Millimeters from the motor's forward end. Only the launch value is kept:
    // `MotorSpec.cgX` is a scalar, so a per-sample CG has nowhere to go. A
    // bundled catalog row's CG series is likewise read only at launch.
    cgMm: haveCg ? points[0]!.cg : undefined,
    samples,
    source: 'rse',
  };
}

/** `auto-calc-*` is off only when the file says so explicitly, as upstream. */
const isFalse = (v: string | null) => v === '0' || v?.toLowerCase() === 'false';

/**
 * Every motor in a `.rse` file.
 *
 * A list, not one motor: `<engine-database>` files carry a manufacturer's whole
 * range, and upstream's loader returns a list for the same reason. `parseEng`
 * returns a list too, one motor per RASP header block.
 */
export function parseRse(text: string): CustomMotor[] {
  const doc = parseXmlText(text, '.rse');
  const engineEls = doc.querySelectorAll('engine');
  if (engineEls.length === 0) throw new KeyedError('errors.motorFile.rseNoEngine');
  // Counted before the spread, so a crafted member does not materialize a
  // million-element array on the way to being refused.
  if (engineEls.length > MAX_RSE_ENGINES) {
    throw new KeyedError('errors.motorFile.rseTooManyMotors', { max: MAX_RSE_ENGINES });
  }
  return [...engineEls].map(parseEngine);
}
