// Fetch the community parts database the components sync reads.
//
//   npm run sync:database
//
// Clones dbcook/openrocket-database into web/openrocket-database, or updates
// the clone already there, and checks out the commit the scheduled catalog
// workflow pins (.github/workflows/sync-catalogs.yml), so a local refresh reads
// the same parts the published catalog is built from. Bump REF and the
// workflow's `ref:` together. The folder is gitignored: it is a repository of
// its own, and this script is how it is made again.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const URL_ = 'https://github.com/dbcook/openrocket-database';
const REF = '772db251b5cb989ac1a0bca4921dcf91d3bc54de'; // master @ 2024-03-18
const DIR = fileURLToPath(new URL('../openrocket-database', import.meta.url));

const git = (...args) => execFileSync('git', args, { stdio: 'inherit' });

if (existsSync(DIR)) {
  git('-C', DIR, 'fetch', 'origin');
} else {
  git('clone', URL_, DIR);
}
git('-C', DIR, 'checkout', '--quiet', REF);
console.log(`openrocket-database at ${REF.slice(0, 7)} in ${DIR}`);
