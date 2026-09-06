// Writes public/data/manifest.json — a content hash per runtime catalog, used
// by the app to cache-bust a replaced data file (see src/services/remoteData.ts).
// The hash fingerprints the DATA, so it's stable across a later prettier reformat
// of the JSON and changes only when the catalog content changes.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FILES = { motors: 'motors.generated.json', components: 'components.generated.json' };

/** Recompute manifest.json from whatever catalogs are present in `dir`. */
export function writeDataManifest(dir) {
  const manifest = {};
  for (const [key, file] of Object.entries(FILES)) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    // Hash the parsed→re-serialized data so formatting (compact vs prettier)
    // never changes the token; only a real data change does.
    const data = JSON.parse(readFileSync(path, 'utf8'));
    manifest[key] = createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 12);
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

// Runnable directly: `node scripts/lib/dataManifest.mjs [publicDataDir]`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2] || fileURLToPath(new URL('../../public/data', import.meta.url));
  console.log('manifest:', writeDataManifest(dir));
}
