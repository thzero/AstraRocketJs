// Fetch the community parts database the components sync reads.
//
//   npm run sync:database
//
// Clones openrocket/openrocket-database into web/openrocket-database, or
// updates the clone already there, and checks out the commit pinned with the
// OpenRocket release in scripts/data/openrocket-release.json, which the
// scheduled catalog workflow (.github/workflows/sync-catalogs.yml) reads too.
// That commit's `.orc` files are the ones the release ships inside its jar, and
// sync-components refuses a database that differs from them, so a bump of the
// commit has to come with the release whose jar carries it. The folder is
// gitignored: it is a repository of its own, and this script is how it is made
// again.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DATABASE } from './lib/openrocketRelease.mjs';

const DIR = fileURLToPath(new URL('../openrocket-database', import.meta.url));

const git = (...args) => execFileSync('git', args, { stdio: 'inherit' });

if (existsSync(DIR)) {
  // A clone made from another copy of the database fetches from here instead.
  git('-C', DIR, 'remote', 'set-url', 'origin', DATABASE.url);
  git('-C', DIR, 'fetch', 'origin');
} else {
  git('clone', DATABASE.url, DIR);
}
git('-C', DIR, 'checkout', '--quiet', DATABASE.ref);
console.log(`openrocket-database at ${DATABASE.ref.slice(0, 7)} in ${DIR}`);
