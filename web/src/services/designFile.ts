import type { OrkImportResult } from './orkTypes';
import { importOrk } from './orkFile';
import { importRkt } from './rktImport';

/**
 * Which design format a file is, decided from its BYTES rather than its name.
 *
 * The app now reads two: OpenRocket `.ork` (a zip, or bare XML) and RockSim
 * `.rkt` (XML). Sniffing rather than trusting the extension means a `.rkt`
 * chosen in the OpenRocket picker still opens, and a file renamed on the way
 * out of somebody's email does too — and it keeps the loader to ONE path, so
 * everything downstream (`loadOrk`, the notes banner, the safety-limit check)
 * is shared instead of duplicated per format.
 */

/** The number of leading bytes to look at. A root element is well inside this. */
const SNIFF_BYTES = 512;

export type DesignFormat = 'ork' | 'rkt';

/**
 * The format of a design file, or null when it is neither.
 *
 * A zip is always a `.ork`: RockSim writes plain XML. Otherwise the root
 * element decides, which is why this looks for the tag and not merely the word
 * — "RockSim" appears in plenty of `.ork` files as a material or a comment.
 */
export function sniffDesignFormat(data: ArrayBuffer | string): DesignFormat | null {
  if (typeof data !== 'string') {
    const bytes = new Uint8Array(data);
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'ork'; // "PK": a zip
    data = new TextDecoder().decode(bytes.subarray(0, SNIFF_BYTES));
  }
  const head = data.slice(0, SNIFF_BYTES);
  if (/<RockSimDocument[\s>]/.test(head)) return 'rkt';
  if (/<openrocket[\s>]/.test(head)) return 'ork';
  return null;
}

/**
 * Parse a design file of either format into the one import result shape.
 *
 * Throws with the formats it does know when handed something else, because
 * "Not a .ork file (missing <rocket>)" is a confusing thing to be told after
 * picking a `.rkt`.
 */
export function parseDesignFile(data: ArrayBuffer | string): OrkImportResult {
  const format = sniffDesignFormat(data);
  if (format === 'rkt') return importRkt(data);
  if (format === 'ork') return importOrk(data);
  throw new Error('Not a rocket design file — expected OpenRocket (.ork) or RockSim (.rkt).');
}
