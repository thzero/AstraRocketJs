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
//
// The OS temp directory is shared by every checkout and worktree on the
// machine, so each staged name carries a hash of the checkout it belongs to. A
// digest step run in one checkout never reads a catalog another one staged.
import { createHash } from 'node:crypto';
import { renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The `web` folder of this checkout. */
const CHECKOUT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Where `catalog` ("components" or "motors") is staged for the checkout whose
 * `web` folder is `checkout`. The path is resolved, and case-folded on Windows,
 * whose paths ignore case, so one checkout reached two ways stages to one file.
 */
export function stagedPath(catalog, checkout = CHECKOUT) {
  const path = resolve(checkout);
  const key = createHash('sha256')
    .update(process.platform === 'win32' ? path.toLowerCase() : path)
    .digest('hex')
    .slice(0, 12);
  return join(tmpdir(), `astrarocketjs-${key}-${catalog}.staged.json`);
}

/** The parts catalog sync-components built, before its digests. */
export const STAGED_COMPONENTS = stagedPath('components');

/** The motor catalog sync-motors built, before its digests. */
export const STAGED_MOTORS = stagedPath('motors');

/**
 * Write `text` to `path` in one step: into a file beside it, then renamed over
 * it, so a run that stops partway leaves the previous file whole.
 */
export function writeFileAtomic(path, text) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}
