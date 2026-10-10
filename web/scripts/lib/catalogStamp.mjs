// The parts catalog's `generated` stamp is kept when its parts did not change.
//
// Nothing reads the stamp, but it is part of the file, and the manifest hashes
// the whole file (lib/dataManifest.mjs), so a new stamp on unchanged parts makes
// every browser download the catalog again. The catalog is written in two steps,
// sync-components and then sync-preset-digests, and only the second knows the
// finished parts, so the first leaves the previous catalog here for the second to
// compare against.
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Where sync-components leaves the previous catalog's stamp and parts. */
export const PREVIOUS_CATALOG = join(tmpdir(), 'astrarocketjs-components.previous.json');
