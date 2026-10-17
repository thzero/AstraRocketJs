import type { MotorSpec, MotorType } from '../../../engine/openRocketEngine';
import { motorDigest } from '../../motors/motorDigest';
import { finalizeThrustCurve, sortLists } from '../../motors/curveFinalize';
import { escapeXml } from '../xmlUtil';

/**
 * A motor's thrust curve as the desktop embeds it in a `.ork`:
 * `thrustcurves/<digest>.rse` in the zip, the same `<digest>` in the motor's
 * XML. On load the desktop prefers its own database entry when the digest
 * matches one, and otherwise reads this file and accepts it only if the curve
 * it parses hashes to the name (`MotorHandler.loadMotorFromZip`). So the digest
 * here is computed from the numbers exactly as written, after the same cleanup
 * the desktop's loader applies before it hashes (`sortLists`, then
 * `finalizeThrustCurve`).
 */
export interface EmbeddedMotorFile {
  digest: string;
  /** Path inside the `.ork` zip. */
  path: string;
  text: string;
}

/** One `<eng-data>` row: s, N, kg, m. */
interface Row {
  t: number;
  f: number;
  m: number;
  cg: number;
}

/** The digest the desktop computes for these rows once loaded. */
export function rowsDigest(rows: readonly Row[]): string {
  const times = rows.map((r) => r.t);
  const thrusts = rows.map((r) => r.f);
  const masses = rows.map((r) => r.m);
  const cgs = rows.map((r) => r.cg);
  sortLists(times, thrusts, masses, cgs);
  finalizeThrustCurve(times, thrusts, [masses, cgs]);
  return motorDigest({ times, masses, cgs, thrusts });
}

const attrOf = (attrs: string, key: string): number | null => {
  const m = new RegExp(`(?:^|\\s)${key}="([^"]*)"`).exec(attrs);
  const v = m ? Number(m[1]) : NaN;
  return Number.isFinite(v) ? v : null;
};

/**
 * The digest the desktop computes when it loads this `.rse` text, or null when
 * the file does not state mass and CG on every row. Desktop also hashes other
 * data when `auto-calc-mass` or `auto-calc-cg` is absent or true
 * (`RockSimMotorLoader.getMotor`): the mass from the initial and propellant
 * weights, and no CG. The files this app writes set both to 0.
 */
export function rseDigest(text: string): string | null {
  const rows: Row[] = [];
  for (const [, attrs] of text.matchAll(/<eng-data\s([^>]*?)\/?>/g)) {
    const t = attrOf(attrs!, 't');
    const f = attrOf(attrs!, 'f');
    const m = attrOf(attrs!, 'm');
    const cg = attrOf(attrs!, 'cg');
    if (t === null || f === null || m === null || cg === null) return null;
    rows.push({ t, f, m: m / 1000, cg: cg / 1000 });
  }
  return rows.length ? rowsDigest(rows) : null;
}

/**
 * A plain decimal the desktop's `Double.parseDouble` reads back to the same
 * double: JavaScript's shortest round-trip form, which Java parses exactly.
 */
const num = (v: number) => String(v);

/** The `Type` attribute for each motor type, as `RockSimMotorLoader` reads it. */
const RSE_TYPES: Record<MotorType, string> = { SU: 'single-use', reload: 'reloadable', hybrid: 'hybrid' };

/**
 * The motor's `Type` attribute, or nothing when the spec has no type. The
 * loader reads an absent attribute as unknown and then takes the type from the
 * manufacturer, so leaving it out keeps that inference, where a stated value
 * would override it.
 */
const typeAttr = (spec: MotorSpec): string => (spec.type ? ` Type="${RSE_TYPES[spec.type]}"` : '');

/**
 * The `.rse` the desktop would write for this motor (`RockSimMotorWriter`):
 * mass and CG stated on every row, so nothing is recomputed on load. Null for a
 * motor with no curve to carry (an unresolved placeholder).
 */
export function embeddedMotorFile(spec: MotorSpec): EmbeddedMotorFile | null {
  const n = Math.min(spec.times?.length ?? 0, spec.thrusts?.length ?? 0, spec.masses?.length ?? 0);
  if (n < 2) return null;
  const written = Array.from({ length: n }, (_, i) => ({
    t: num(spec.times[i]!),
    f: num(spec.thrusts[i]!),
    m: num(spec.masses[i]! * 1000),
    cg: num(spec.cgX * 1000),
  }));
  // Hashed from the text, read back the way the loader reads it (grams and
  // millimeters divided by 1000), so the name is the file's own digest.
  const digest = rowsDigest(
    written.map((r) => ({ t: Number(r.t), f: Number(r.f), m: Number(r.m) / 1000, cg: Number(r.cg) / 1000 })),
  );
  const initWt = spec.masses[0]! * 1000;
  const propWt = (spec.masses[0]! - spec.masses[n - 1]!) * 1000;
  const lines = [
    '<engine-database>',
    ' <engine-list>',
    `  <engine mfg="${escapeXml(spec.manufacturer || 'custom')}" code="${escapeXml(spec.designation)}"${typeAttr(spec)}` +
      ` dia="${num(spec.diameter * 1000)}" len="${num(spec.length * 1000)}" initWt="${num(initWt)}"` +
      ` propWt="${num(propWt)}" auto-calc-mass="0" auto-calc-cg="0">`,
    '   <data>',
    ...written.map((r) => `    <eng-data t="${r.t}" f="${r.f}" m="${r.m}" cg="${r.cg}"/>`),
    '   </data>',
    '  </engine>',
    ' </engine-list>',
    '</engine-database>',
    '',
  ];
  return { digest, path: `thrustcurves/${digest}.rse`, text: lines.join('\n') };
}
