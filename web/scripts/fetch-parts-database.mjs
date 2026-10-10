// Fetch the community parts database the components sync reads.
//
//   npm run sync:database
//
// Clones openrocket/openrocket-database into web/openrocket-database, or
// updates the clone already there, and checks out the commit the scheduled
// catalog workflow pins (.github/workflows/sync-catalogs.yml), so a local
// refresh reads the same parts the published catalog is built from. It is the
// database OpenRocket itself builds from (its core/resources-src/datafiles
// submodule), and the commit is the one that submodule pins in the OpenRocket
// build the engine is extracted from (engine-java/extract/UPSTREAM). Bump REF and the
// workflow's `ref:` together. The folder is gitignored: it is a repository of
// its own, and this script is how it is made again.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const URL_ = 'https://github.com/openrocket/openrocket-database';
const REF = '1512874ace50917e25ccf7d7df1f616b5f39a8b5'; // master @ 2025-07-27
const DIR = fileURLToPath(new URL('../openrocket-database', import.meta.url));

const git = (...args) => execFileSync('git', args, { stdio: 'inherit' });

if (existsSync(DIR)) {
  // A clone made from another copy of the database fetches from here instead.
  git('-C', DIR, 'remote', 'set-url', 'origin', URL_);
  git('-C', DIR, 'fetch', 'origin');
} else {
  git('clone', URL_, DIR);
}
git('-C', DIR, 'checkout', '--quiet', REF);
console.log(`openrocket-database at ${REF.slice(0, 7)} in ${DIR}`);
