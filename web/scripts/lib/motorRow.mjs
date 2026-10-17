// One motor catalog row, built from a thrustcurve.org motor and its data files
// (sync-motors.mjs).
//
// The diameter is kept to a tenth of a millimeter. The motor sizes are nominal
// millimeters, and not all of them are whole: Apogee's 10.5 mm motors are
// 0.0105 m in desktop OpenRocket's database, and a row rounded to 11 would
// show, fly and save a motor half a millimeter wider than the one desktop
// holds. The digest step keys both databases on the same tenth
// (lib/motorDigestKey.mjs).
import { rankCurves } from './rankCurves.mjs';

/** `n` to `d` decimals as a number; 0 for anything that is not a finite number. */
const round = (n, d) => (Number.isFinite(n) ? Number(n.toFixed(d)) : 0);

/** Decimals a row keeps of the diameter, in millimeters. */
export const DIAMETER_DECIMALS = 1;

// A motor can have several data files (cert vs user submissions, RASP/RockSim
// formats). Bundle them all, best-first (lib/rankCurves.mjs), so the picker can
// offer a choice.
const sourceLabel = (s) => ({ cert: 'Certified', mfr: 'Manufacturer', user: 'User' })[s] || s || 'Unknown';

/**
 * Loaded mass (g) read straight from the thrust-curve file: RASP header
 * `totalWeight` (kg) or RockSim `<engine initWt>` (g). This is the mass
 * OpenRocket uses; thrustcurve.org's `totalWeightG` metadata can disagree with
 * the file (e.g. AeroTech J350W: file 651 g vs metadata 665 g), which throws off
 * loaded CG and stability. We prefer the file to match OpenRocket.
 */
function fileLoadedMassG(format, b64) {
  if (!b64) return null;
  const text = Buffer.from(b64, 'base64').toString('utf8');
  if (format === 'RASP') {
    // name  diameter  length  delays  propWeight(kg)  totalWeight(kg)  manufacturer
    const header = text.split('\n').find((l) => l.trim() && !l.trim().startsWith(';'));
    const total = header ? parseFloat(header.trim().split(/\s+/)[5]) : NaN;
    return Number.isFinite(total) ? total * 1000 : null;
  }
  if (format === 'RockSim') {
    const m = text.match(/<engine\b[^>]*\binitWt="([\d.]+)"/i);
    return m ? parseFloat(m[1]) : null;
  }
  return null;
}

/** CG-vs-time as [[t(s), cgFromNose(m)]] from a RockSim file's `<eng-data cg t>`
 *  (cg is mm from the motor's forward end). null when the file carries no CG. */
function rockSimCg(b64) {
  if (!b64) return null;
  const text = Buffer.from(b64, 'base64').toString('utf8');
  const pts = [];
  for (const m of text.matchAll(/<eng-data\b([^>]*)\/>/g)) {
    const cg = m[1].match(/\bcg="([\d.]+)"/);
    const t = m[1].match(/\bt="([\d.]+)"/);
    if (cg && t) pts.push([round(parseFloat(t[1]), 4), round(parseFloat(cg[1]) / 1000, 5)]);
  }
  return pts.length ? pts : null;
}

/**
 * The catalog row for one thrustcurve.org search result `m` and its data
 * files `curve` (each with `source`, `format`, `samples`, `data` and
 * `simfileId`), or no files.
 */
export function motorRow(m, curve) {
  const row = {
    designation: m.commonName || m.designation,
    manufacturer: m.manufacturerAbbrev || m.manufacturer,
    class: m.impulseClass,
    diameter: round(m.diameter, DIAMETER_DECIMALS),
    impulse: round(m.totImpulseNs, 3),
    burn: round(m.burnTimeS, 3),
    mass: round(m.totalWeightG, 2),
  };
  // Descriptive metadata for the detail panel (kept on every motor).
  if (m.designation && m.designation !== row.designation) row.code = m.designation; // full mfr code
  if (m.type) row.type = m.type; // SU / reload / hybrid
  if (m.delays) row.delays = m.delays; // "4,6,7,8,10"
  if (m.propInfo) row.propInfo = m.propInfo; // propellant type
  if (m.sparky) row.sparky = true;
  // thrustcurve.org's availability is regular, occasional or OOP; desktop's
  // "not in regular production" is OOP. Marked only when true, to keep rows small.
  if (m.availability === 'OOP') row.oop = true;
  if (Number.isFinite(m.avgThrustN)) row.avgThrust = round(m.avgThrustN, 2);
  if (Number.isFinite(m.maxThrustN)) row.maxThrust = round(m.maxThrustN, 2);
  if (Number.isFinite(m.length)) row.length = round(m.length, 2); // mm
  if (Number.isFinite(m.propWeightG)) row.propWeightG = round(m.propWeightG, 2); // g
  // Bundled thrust curves (best-first), so a picked motor resolves with no
  // fetch and the picker can offer a choice when there are several.
  if (curve && Number.isFinite(m.length) && Number.isFinite(m.propWeightG)) {
    const ranked = rankCurves(curve);
    row.curves = ranked.map((c) => ({
      src: `${sourceLabel(c.source)} · ${c.format}`,
      samples: c.samples.map((s) => [round(s.time, 4), round(s.thrust, 3)]),
    }));
    // Loaded mass from the primary bundled file (the one the app uses by
    // default), which matches OpenRocket; overrides the metadata mass set above.
    const fileMass = fileLoadedMassG(ranked[0].format, ranked[0].data);
    if (Number.isFinite(fileMass)) row.mass = round(fileMass, 2);
    // Real CG-vs-time from the best RockSim file, if any (else the motor
    // build falls back to mid-length, same as OpenRocket for RASP-only data).
    const rockSim = ranked.find((c) => c.format === 'RockSim');
    const cg = rockSim ? rockSimCg(rockSim.data) : null;
    if (cg) row.cg = cg;
  } else {
    // No bundled curve (none published, or missing length/prop weight so it
    // can't be built). Flag it so the UI can mark it and block compare/combine.
    row.noCurve = true;
  }
  return row;
}
