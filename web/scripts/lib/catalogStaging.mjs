// Where a catalog waits between its two sync steps, and how a finished one is
// written.
//
// The motor and parts catalogs are each made in two steps: sync-motors or
// sync-components builds the rows, then sync-motor-digests or
// sync-preset-digests adds the digests desktop OpenRocket needs and checks the
// coverage. The first step writes here, outside public/data, so a digest step
// that fails leaves public/data holding the last finished catalog rather than
// one with no digests. The digest step reads the staged catalog, writes the
// finished one into public/data, and removes the staged one; run on its own,
// with nothing staged, it reads and rewrites the catalog in public/data.
//
// A staged catalog left by a digest step that failed is read by the next run of
// that step, which is the retry. The next run of the first step replaces it.
import { renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The parts catalog sync-components built, before its digests. */
export const STAGED_COMPONENTS = join(tmpdir(), 'astrarocketjs-components.staged.json');

/** The motor catalog sync-motors built, before its digests. */
export const STAGED_MOTORS = join(tmpdir(), 'astrarocketjs-motors.staged.json');

/**
 * Write `text` to `path` in one step: into a file beside it, then renamed over
 * it, so a run that stops partway leaves the previous file whole.
 */
export function writeFileAtomic(path, text) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}
