import { type Quantity, uiToSi } from './units';

/**
 * The one rule every numeric data entry in the app obeys: a value is stored
 * only if it is finite once every conversion has been applied, and inside the
 * bounds the field declares.
 *
 * It lives in its own module because the hazard is not the typing, it is the
 * conversion after the typing. A box holds the user's unit and everything
 * behind it (the tree, the kernel, saved files, share links) holds SI, so a
 * number that is perfectly finite as typed can convert to a non-finite stored
 * value: 1e306 g/cm3 is 1e309 kg/m3, which is Infinity. Stored, it would pass
 * through the mass and the mesh and come out of the `.ork` writer as
 * `Infinity`, which the reader takes back as 0, so the field would show a
 * number the geometry never had.
 *
 * Every entry point calls in here rather than repeating the check, so every
 * box applies the same rule. A hand-rolled `Number(x) || 0`, for instance, lets
 * Infinity straight through, since `Infinity || 0` is Infinity.
 *
 * `null` is the single answer for "do not store this": the box keeps its own
 * draft text while focused, so a refused keystroke leaves what was already
 * there rather than snapping the field to zero.
 */

/**
 * SI bounds for quantities that have a physical one, as opposed to a bound
 * that belongs to one field.
 *
 * A per-field `min`/`max` still applies on top and is the right place for a
 * limit that is about the field (a rod angle, a sweep's altitude band). This
 * table is for a ceiling no value of that quantity can exceed whatever field
 * it is typed into, so that a key-by-key prefix of a long number cannot commit
 * an absurd value on the way to a sane one.
 *
 * Deliberately short. A quantity with no real physical ceiling does not get an
 * invented one; the finite check alone already keeps it storable.
 */
export const SI_LIMITS: Partial<Record<Quantity, { min?: number; max?: number }>> = {
  /**
   * Bulk density, kg/m3. The densest material that exists is osmium at about
   * 22,590, so 30,000 is past anything real and still far short of the value
   * a mistyped exponent produces. Without it a custom material could be saved
   * at a density that makes every rocket using it unflyable.
   */
  density: { max: 30_000 },
};

/**
 * A number that may be stored, or `null`.
 *
 * Use this for an entry that is not unit-converted: a count, a stride, a
 * delay in seconds, a decimal-place setting. For anything the user types in
 * their own unit, use {@link siEntry}, which applies this rule to the
 * converted value.
 */
export function clampEntry(n: number | null | undefined, min?: number, max?: number): number | null {
  // `Number.isFinite`, not `!isNaN`: Infinity passes a NaN check, and it also
  // passes a clamp, because `Infinity < min` is false and most fields declare
  // no max at all.
  if (n == null || !Number.isFinite(n)) return null;
  let v = n;
  if (min != null && v < min) v = min;
  if (max != null && v > max) v = max;
  return v;
}

/**
 * Parse typed text into a storable number, or `null`.
 *
 * Separate from {@link clampEntry} because the DOM cannot be trusted to
 * exercise the overflow case: jsdom refuses to deliver "1e999" to a
 * `type="number"` input at all, so a rendered test of it passes for the wrong
 * reason. A browser does deliver it, and `parseFloat` returns `Infinity`.
 */
export function parseEntry(raw: string, min?: number, max?: number): number | null {
  if (raw.trim() === '') return null;
  return clampEntry(parseFloat(raw), min, max);
}

/**
 * A typed display value → the SI number to store, or `null` if it cannot be
 * stored.
 *
 * `then` chains a further conversion for a value whose stored form is not SI -
 * launch conditions keep the `.ork`'s own conventions (degrees, Celsius, hPa),
 * and a couple of fields store a ratio of the converted number. Its result is
 * checked too, so the guard covers the whole path from keystroke to stored
 * value rather than just the first leg of it.
 */
export function siEntry(
  quantity: Quantity,
  symbol: string,
  ui: number | null | undefined,
  then?: (si: number) => number,
): number | null {
  if (ui == null || !Number.isFinite(ui)) return null;
  const limit = SI_LIMITS[quantity];
  const si = clampEntry(uiToSi(quantity, symbol, ui), limit?.min, limit?.max);
  if (si === null) return null;
  return then ? clampEntry(then(si)) : si;
}

/** The part of a resolved `FieldUnit` an entry handler needs. */
export interface SiConverter {
  toSi: (ui: number | null | undefined, then?: (si: number) => number) => number | null;
}

/**
 * Wrap a "store this" callback so a unit-converted box can be handed straight
 * to it:
 *
 *     onChange={onSi(fu, (si) => patch({ altitude: si }))}
 *
 * It settles the three cases the same way everywhere, which is the point of it
 * being here rather than spelled out at each box:
 *
 * - Blank: `null` reaches the callback. Clearing a box is a real edit.
 * - Refused: the callback is not called, so the stored value is left alone and
 *   the draft text keeps showing what was typed.
 * - Otherwise: the SI value reaches the callback.
 *
 * A field whose blank means zero rather than "no value" says so in its own
 * callback (`(si) => patch({ key: si ?? 0 })`); that is a decision about the
 * field, not about what a number may be.
 */
export function onSi(
  fu: SiConverter,
  commit: (si: number | null) => void,
  then?: (si: number) => number,
): (ui: number | null) => void {
  return (ui) => {
    if (ui == null) {
      commit(null);
      return;
    }
    const si = fu.toSi(ui, then);
    if (si === null) return;
    commit(si);
  };
}
