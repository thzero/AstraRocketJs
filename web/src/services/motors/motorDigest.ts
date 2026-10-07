import { md5Hex } from './md5';

/**
 * OpenRocket's motor digest (`MotorDigest`), for a curve whose mass and CG are
 * given at every sample: the case `RockSimMotorLoader` hashes for a `.rse` with
 * explicit `m` and `cg` on each row, and `digestMotor` for any loaded motor.
 *
 * Each block is its order number, its length and its values, every one a
 * big-endian 32-bit integer; a value is scaled by its block's multiplier and
 * rounded, with the kernel's epsilon nudge away from zero on both sides of the
 * scaling so a value that sits on a rounding boundary rounds the same way.
 */
export interface DigestCurve {
  /** s */
  times: readonly number[];
  /** kg, at each time */
  masses: readonly number[];
  /** m from the motor's front, at each time */
  cgs: readonly number[];
  /** N */
  thrusts: readonly number[];
}

const EPSILON = 0.00000000001;

/** `MotorDigest.DataType`: order and multiplier. Blocks go in ascending order. */
const DIGEST_TYPES = {
  TIME_ARRAY: [0, 1000],
  MASS_SPECIFIC: [1, 10000],
  MASS_PER_TIME: [2, 10000],
  CG_PER_TIME: [4, 1000],
  FORCE_PER_TIME: [5, 1000],
} as const;
type DigestType = (typeof DIGEST_TYPES)[keyof typeof DIGEST_TYPES];

const next = (v: number) => v + Math.sign(v) * EPSILON;

/** Java's `(int) Math.round(v)`: half up, then truncated to 32 bits. */
const javaRoundInt = (v: number) => Math.floor(v + 0.5) | 0;

/** The digest over blocks of values, in the order given (`MotorDigest.update` then `getDigest`). */
function digestBlocks(blocks: readonly (readonly [DigestType, readonly number[]])[]): string {
  const ints: number[] = [];
  for (const [[order, multiplier], values] of blocks) {
    ints.push(order, values.length);
    for (const v of values) ints.push(javaRoundInt(next(next(v) * multiplier)));
  }
  const bytes = new Uint8Array(ints.length * 4);
  const view = new DataView(bytes.buffer);
  ints.forEach((v, i) => view.setInt32(i * 4, v, false));
  return md5Hex(bytes);
}

export function motorDigest(curve: DigestCurve): string {
  return digestBlocks([
    [DIGEST_TYPES.TIME_ARRAY, curve.times],
    [DIGEST_TYPES.MASS_PER_TIME, curve.masses],
    [DIGEST_TYPES.CG_PER_TIME, curve.cgs],
    [DIGEST_TYPES.FORCE_PER_TIME, curve.thrusts],
  ]);
}
