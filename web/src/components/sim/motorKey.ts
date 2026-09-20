import type { CatalogMotor } from '../../services/motorDb';

/**
 * Stable identity for a motor across filter/sort changes.
 *
 * `code` (the full manufacturer designation) is part of the key because mfr +
 * common name + bore is NOT unique: AeroTech ships an F67W (White Lightning,
 * 61 N.s) and an F67C (Classic, 77 N.s), both "F67" in 29 mm, and Cesaroni
 * reloads collide the same way. 14 such pairs are in the current catalog. This
 * key is the row key AND the selection / checkbox / series-color identity, so a
 * collision does not just warn in the console: it makes two distinct motors
 * select and check as one.
 *
 * Its own module so the picker (MotorDialog) can share it without importing
 * the whole dashboard. The picker used to key rows on their LIST INDEX, so a
 * highlight pointed at a different motor the moment a filter moved the list.
 */
export const keyOf = (m: CatalogMotor) => `${m.manufacturer}|${m.designation}|${m.diameter}|${m.code ?? ''}`;
