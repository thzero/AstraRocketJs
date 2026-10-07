// Parser for RockSim `.rse` motor files, the XML thrust-curve format that
// carries what RASP `.eng` cannot: the motor TYPE (so a hybrid imports as a
// hybrid) and the propellant mass sample by sample, rather than one header
// number the mass curve has to be reconstructed from.
//
// A TypeScript PORT of OpenRocket's `file/motor/RockSimMotorLoader.java`, not
// an extraction of it, for the reason the `.rkt` design reader is one: that
// class is SAX-based and pulls in SimpleSAX, WarningSet, MotorDigest,
// Manufacturer and ThrustCurveMotor.Builder — the file-loading machinery the
// engine extraction deliberately leaves behind. The schema is small enough to
// read directly, and reading it here keeps both motor formats on the same side
// of the engine boundary: plain DOM, unit-testable, no kernel round trip.
//
// Deliberate differences from upstream, each because the thing it needs does
// not exist on this side:
//
//   - No `MotorDigest`. It exists to recognize the same motor arriving from two
//     files; nothing here does that.
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

/** RockSim's `Type` attribute, mapped to the catalog's own vocabulary. */
const TYPES: Record<string, NonNullable<CustomMotor['type']>> = {
  'single-use': 'SU',
  hybrid: 'hybrid',
  reloadable: 'reload',
};

/**
 * Ceilings an untrusted `.rse` is held to.
 *
 * This parser is reached with NO file picker: `loadOrk` runs it over every
 * `.rse` member an imported `.ork` carried, and that member may be up to the
 * archive's 64 MiB per-entry ceiling. The `.ork` reader caps fin points and
 * shroud lines for exactly this reason; the embedded-motor path capped nothing,
 * so a member with a million `<engine>` elements froze the tab while merely
 * OPENING a shared design.
 *
 * A manufacturer's whole range is a few hundred motors, and the longest real
 * curve is a few thousand samples.
 */
export const MAX_RSE_ENGINES = 2000;
export const MAX_RSE_SAMPLES = 20_000;

/** One `<eng-data>` row, before the quirk fixing below. */
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

/** A required numeric attribute, in the file's own units. */
function num(el: Element, name: string, what: string): number {
  const raw = el.getAttribute(name);
  if (raw === null) throw new Error(`.rse motor is missing its ${what}.`);
  const v = Number(raw);
  if (!Number.isFinite(v)) throw new Error(`.rse motor has an invalid ${what} (${raw}).`);
  return v;
}

/** An optional numeric attribute; NaN when absent or unparseable, as upstream. */
function optNum(el: Element, name: string): number {
  const raw = el.getAttribute(name);
  if (raw === null) return NaN;
  const v = Number(raw);
  return Number.isFinite(v) ? v : NaN;
}

/**
 * Sort by time, carrying the other columns along.
 *
 * Upstream's `sortLists`, which exists because the samples are not guaranteed
 * ordered. A plain stable sort of the rows does the same job.
 */
function sortByTime(points: Point[]): Point[] {
  return [...points].sort((a, b) => a.time - b.time);
}

/** Upstream's `MathUtil.equals`: an absolute epsilon, not a relative one. */
const eq = (a: number, b: number) => Math.abs(a - b) < 0.00001;

/**
 * The real-world quirk fixing from `AbstractMotorLoader.finalizeThrustCurve`,
 * ported case for case because each case is a shape of file that exists.
 *
 * What is NOT ported is the commented-out block upstream keeps at the end: it
 * appends a zero-thrust point at the last sample's own time, which makes two
 * points share a time and then breaks the interpolation that reads them. The
 * comment there says as much, and it is left out here for the same reason.
 */
function finalizeThrustCurve(points: Point[]): Point[] {
  if (points.length === 0) return points;
  const p = [...points];

  // No datapoint at t=0: put one there. A nonzero thrust at t=0 is an error in
  // the file, but not one worth refusing it over, and a second zero-thrust
  // point at the same time would be the duplicate-time problem below.
  if (!eq(p[0]!.time, 0)) p.unshift({ ...p[0]!, time: 0, thrust: 0 });

  // Two points at t=0, one zero-thrust and one not. Drop the zero.
  if (p.length > 1 && eq(p[0]!.time, 0) && eq(p[1]!.time, 0)) p.shift();

  // Two adjacent points identical in BOTH time and thrust (KBA K1750 does
  // this). Drop the second.
  for (let i = 0; i < p.length - 1; i++) {
    while (i < p.length - 1 && eq(p[i]!.time, p[i + 1]!.time) && eq(p[i]!.thrust, p[i + 1]!.thrust)) {
      p.splice(i, 1);
    }
  }

  // Two FINAL points at the same time, one of them zero thrust. Drop the zero.
  const n = p.length - 1;
  if (n > 0 && eq(p[n - 1]!.time, p[n]!.time)) {
    if (eq(p[n - 1]!.thrust, 0)) p.splice(n - 1, 1);
    else if (eq(p[n]!.thrust, 0)) p.splice(n, 1);
  }

  return p;
}

/** One `<engine>` element as a stored custom motor. */
function parseEngine(el: Element): CustomMotor {
  const manufacturer = el.getAttribute('mfg')?.trim();
  if (!manufacturer) throw new Error('.rse motor is missing its manufacturer (mfg).');
  const code = el.getAttribute('code')?.trim();
  if (!code) throw new Error('.rse motor is missing its designation (code).');
  const designation = removeDelay(code);

  // The file's units are the ones this app stores: mm and grams. Upstream
  // divides all four by 1000 because the kernel is SI; `CustomMotor` is not,
  // and `samplesToMotorSpec` does that conversion at the engine boundary.
  const diameter = num(el, 'dia', 'diameter');
  const length = num(el, 'len', 'length');
  const totalWeightG = num(el, 'initWt', 'initial mass');
  const propWeightG = num(el, 'propWt', 'propellant mass');

  if (!(diameter > 0) || !(length > 0)) {
    throw new Error(`.rse motor ${designation} has a non-positive diameter or length.`);
  }
  // Upstream refuses this too. Without it the rocket GAINS mass as the motor
  // burns, which nothing downstream would report.
  if (!(propWeightG >= 0) || !(totalWeightG > 0) || propWeightG > totalWeightG) {
    throw new Error(`.rse motor ${designation} lists more propellant than total mass.`);
  }

  const sampleEls = el.querySelectorAll('data > eng-data');
  if (sampleEls.length > MAX_RSE_SAMPLES) {
    throw new Error(`.rse motor ${designation} has more than ${MAX_RSE_SAMPLES} data points.`);
  }
  const rows: Point[] = [...sampleEls].map((d) => ({
    time: optNum(d, 't'),
    thrust: optNum(d, 'f'),
    mass: optNum(d, 'm'),
    cg: optNum(d, 'cg'),
  }));
  for (const r of rows) {
    if (!Number.isFinite(r.time) || !Number.isFinite(r.thrust)) {
      throw new Error(`.rse motor ${designation} has a data point with no time or thrust.`);
    }
  }
  const points = finalizeThrustCurve(sortByTime(rows));
  if (points.length < 2) throw new Error(`.rse motor ${designation} has no thrust-curve data.`);

  const samples = points.map((p) => ({ time: p.time, thrust: p.thrust }));

  // Mass and CG are each used only if the file gives them for EVERY point and
  // does not ask for them to be recomputed. Upstream sets the same two flags
  // from `auto-calc-mass` / `auto-calc-cg` and from any NaN in the column; a
  // half-filled column cannot be interpolated and is no better than none.
  const autoMass = !isFalse(el.getAttribute('auto-calc-mass'));
  const autoCg = !isFalse(el.getAttribute('auto-calc-cg'));
  const haveMass = !autoMass && points.every((p) => Number.isFinite(p.mass));
  const haveCg = !autoCg && points.every((p) => Number.isFinite(p.cg));

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
    // Millimeters from the motor's forward end. Only the LAUNCH value is kept:
    // `MotorSpec.cgX` is a scalar, so a per-sample CG has nowhere to go, which
    // is also what the bundled catalog stores for its RockSim rows.
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
 * range, and upstream's loader returns a list for the same reason. `.eng`
 * import takes only the first because a RASP file's second motor is a separate
 * header block that the format gives no way to name.
 */
export function parseRse(text: string): CustomMotor[] {
  const doc = parseXmlText(text, 'Not a valid .rse file (XML parse error).');
  const engineEls = doc.querySelectorAll('engine');
  if (engineEls.length === 0) throw new Error('Not a valid .rse file (no <engine> found).');
  // Counted BEFORE the spread, so a crafted member does not materialize a
  // million-element array on the way to being refused.
  if (engineEls.length > MAX_RSE_ENGINES) {
    throw new Error(`This .rse declares more than ${MAX_RSE_ENGINES} motors (possibly malformed).`);
  }
  return [...engineEls].map(parseEngine);
}
