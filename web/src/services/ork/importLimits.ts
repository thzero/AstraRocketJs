import { MAX_INSTANCE_COUNT } from '../../tree/nodeProps';

/**
 * Ceilings the .ork reader holds an untrusted file to. A real design is a few
 * hundred KB of XML nesting four or five levels deep; these are generous
 * bounds that turn a crafted file into a clear error instead of a frozen tab.
 */

// Decompression caps for the untrusted `.ork` zip (a real design is a few
// hundred KB of XML; these are generous ceilings, not tuning knobs).
export const MAX_ARCHIVE_ENTRIES = 256;
export const MAX_ARCHIVE_ENTRY_BYTES = 64 * 1024 * 1024; // 64 MiB uncompressed per member
export const MAX_ARCHIVE_TOTAL_BYTES = 128 * 1024 * 1024; // 128 MiB uncompressed total
// A real design nests ~4-5 levels; this bounds a crafted deeply-nested
// <subcomponents> chain so the recursive walk throws a clear error instead of
// overflowing the JS stack with an opaque RangeError.
export const MAX_NESTING_DEPTH = 100;
// Flight configurations declared in one file. The desktop tops out in the
// low tens; this bounds the per-config re-scanning below.
export const MAX_MOTOR_CONFIGS = 256;
// Domain ceilings for the counts a file can declare. Every consumer loops on
// these (a mesh per fin, a shape per instance, a vertex per fin point), so an
// unbounded count from a crafted file is a frozen tab, not a big rocket.
// Fins share the editor's own ceiling (nodeProps.MAX_INSTANCE_COUNT); pods and
// rings can legitimately repeat more, but nothing buildable repeats a thousand.
export const MAX_FIN_COUNT = MAX_INSTANCE_COUNT;
export const MAX_ASSEMBLY_INSTANCES = 1000;
export const MAX_FIN_POINTS = 10_000;
export const MAX_LINE_COUNT = 100;
