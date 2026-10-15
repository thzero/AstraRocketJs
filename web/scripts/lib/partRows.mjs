// The rows sync-components keeps, and the key it drops a repeated one by.
import { lenM, num, str } from './orcText.mjs';

/**
 * The key a row is kept once under.
 *
 * Desktop makes one preset per `.orc` element (ComponentPresetFactory) and
 * tells presets apart by digest, so two elements that agree in every field are
 * one preset twice and one row carries it, while two that differ anywhere are
 * two rows. A parachute row carries its canopy only, and sync-preset-digests
 * adds the lines, packed size and materials from the desktop's loader, so for
 * a parachute the key reads those elements from `block` as well: on the canopy
 * alone, two presets that differ only there collapse into one row, and the
 * second preset's digest is never offered.
 */
function partRowKey(row, block = '') {
  if (row.type !== 'parachute') return JSON.stringify(row);
  return JSON.stringify([
    row,
    num(block, 'LineCount'),
    lenM(block, 'LineLength'),
    lenM(block, 'PackedLength'),
    lenM(block, 'PackedDiameter'),
    str(block, 'Material'),
    str(block, 'LineMaterial'),
  ]);
}

/**
 * The rows of a parts catalog, each `.orc` element once. `push(row, block)`
 * drops a row keyed like an earlier one, and a parachute's `block` is the
 * element it was read from (see `partRowKey`).
 */
export function uniqueRows() {
  const rows = [];
  const seen = new Set();
  const push = (row, block) => {
    const key = partRowKey(row, block);
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };
  return { rows, push };
}
