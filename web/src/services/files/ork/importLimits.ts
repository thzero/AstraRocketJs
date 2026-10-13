import { KeyedError } from '../../../i18n/keyedError';
import {
  MAX_FIN_COUNT as KERNEL_MAX_FIN_COUNT,
  MAX_INSTANCE_COUNT,
  MAX_LINE_COUNT as NODE_MAX_LINE_COUNT,
} from '../../../tree/nodeProps';

/**
 * Ceilings the .ork reader holds an untrusted file to. A real design is a few
 * hundred KB of XML nesting four or five levels deep; these are generous
 * bounds that turn a crafted file into a clear error instead of a frozen tab.
 */

// Decompression caps for the untrusted `.ork` zip (a real design is a few
// hundred KB of XML; these are generous ceilings, not tuning knobs).
export const MAX_ARCHIVE_ENTRIES = 256;
/**
 * Gzip members in a gzipped `.ork`. OpenRocket writes one; the format allows
 * any number back to back, and each costs a fresh inflater whatever it holds,
 * so a 64 MiB file of one-byte members (millions of them) takes minutes while
 * every byte cap stays far off.
 */
export const MAX_GZIP_MEMBERS = 4;
export const MAX_ARCHIVE_ENTRY_BYTES = 64 * 1024 * 1024; // 64 MiB uncompressed per member
export const MAX_ARCHIVE_TOTAL_BYTES = 128 * 1024 * 1024; // 128 MiB uncompressed total
// A real design nests ~4-5 levels; this bounds a crafted deeply-nested
// <subcomponents> chain so the recursive walk throws a clear error instead of
// overflowing the JS stack with an opaque RangeError.
//
// Set by the kernel, not by taste. Its JSON reader refuses nesting past 64
// levels (JsonLite.MAX_DEPTH), and every component level costs two (the part,
// then its `children` list), plus two more for a freeform fin's point list. So 30
// component levels is the most the engine always builds, and a deeper file would
// import, draw and persist and then fail every engine call with a message naming
// a character offset. A part at level L is walked at depth L - 1 (a stage
// is level 1), so 30 levels is a depth of 29. engineBoundary.test.ts holds this
// to the kernel: the deepest design the cap admits builds, one level more does not.
export const MAX_NESTING_DEPTH = 29;
// Flight configurations declared in one file. The desktop tops out in the
// low tens; this bounds the per-config re-scanning below.
export const MAX_MOTOR_CONFIGS = 256;
// Domain ceilings for the counts a file can declare. Every consumer loops on
// these (a mesh per fin, a shape per instance, a vertex per fin point), so an
// unbounded count from a crafted file is a frozen tab, not a big rocket.
// Fins take the kernel's ceiling (nodeProps.MAX_FIN_COUNT), which desktop
// OpenRocket applies on load too. Rings, lugs, pods and other repeated parts take
// the kernel's instance ceiling (ComponentFactory.MAX_INSTANCE_COUNT, 64, the
// same as the editor's nodeProps.MAX_INSTANCE_COUNT): a count past it would
// import and then fail every build.
export const MAX_FIN_COUNT = KERNEL_MAX_FIN_COUNT;
export const MAX_ASSEMBLY_INSTANCES = MAX_INSTANCE_COUNT;
export const MAX_FIN_POINTS = 10_000;
// Total components in one file. The byte caps above do not bound this: a
// `<bodytube/>` is ~13 bytes, so the 64 MiB per-entry ceiling admits millions
// of them from a small zip, and `convertChildren` walks every one. Each is
// then re-scanned once per declared configuration (see MAX_MOTOR_CONFIGS), so
// the import is O(components x configs) of synchronous DOM work on the main
// thread -- a hung tab rather than the clear error these limits promise.
// The largest real designs are a few hundred parts.
const MAX_COMPONENTS = 10_000;
// Shroud lines take the bridge's ceiling (nodeProps.MAX_LINE_COUNT), the same
// one the editor holds the field to.
export const MAX_LINE_COUNT = NODE_MAX_LINE_COUNT;
// Simulations in one .ork. The byte caps do not bound this either: a
// `<simulation/>` is 13 bytes, and each one is read (its launch conditions and
// passthrough XML) and becomes a row in the workspace, the table and storage.
// Desktop designs carry a handful; a few hundred is already unusual.
export const MAX_SIMULATIONS = 1000;
// Unrecognized elements carried as raw XML on one element (a component,
// `<rocket>`, a simulation). The byte caps do not bound this: `<x/>` is 4
// bytes, and each one is cloned, serialized, stored on the node, persisted and
// written back on every save. Desktop writes a handful (appearance, a newer
// version's tags).
export const MAX_PASSTHROUGH = 1000;

/** The file extension an over-limit error names. */
type ImportFormat = '.ork' | '.rkt';

/**
 * Count one more component against MAX_COMPONENTS. `ctx.nodeCount` is one
 * running total because the readers recurse, so a per-level count would not
 * bound the file.
 */
export function countComponent(ctx: { nodeCount: number }, format: ImportFormat): void {
  if (++ctx.nodeCount > MAX_COMPONENTS) {
    throw new KeyedError('errors.file.tooManyComponents', { format });
  }
}

/** Refuse a walk deeper than MAX_NESTING_DEPTH before it recurses again. */
export function checkDepth(depth: number, format: ImportFormat): void {
  if (depth > MAX_NESTING_DEPTH) {
    throw new KeyedError('errors.file.tooDeep', { format });
  }
}
