// The OpenRocket release the catalogs are built against, pinned in one file
// (scripts/data/openrocket-release.json) that the scripts and the scheduled
// workflow both read.
//
// Desktop users run a release, and a part or motor digest is right only for the
// build it was computed with, so every catalog step reads that release's jar:
// the workflow downloads it from the pinned URL, and every jar a script is given
// or finds installed is checked against the pinned SHA-256. The parts database
// commit is pinned beside it. The release ships that database's `.orc` files
// inside its jar, and sync-components refuses a database whose files differ
// from the jar's copy, so the commit cannot move the catalog off the release.
//
// OPENROCKET_UNPINNED=1 lets a different jar, or a built source tree, through
// with a warning, for trying another build locally. Its digests are not the
// release's, so a catalog made that way is not one to commit or publish.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PIN = JSON.parse(readFileSync(new URL('../data/openrocket-release.json', import.meta.url), 'utf8'));

/** The pinned release, as its version: "24.12". */
export const RELEASE = PIN.release;

/** The parts database commit whose `.orc` files the release ships. */
export const DATABASE = { url: PIN.database.url, ref: PIN.database.ref };

/** Whether a jar other than the pinned release is allowed through. */
export const UNPINNED = process.env.OPENROCKET_UNPINNED === '1';

/**
 * Exit unless `jar` is the pinned release, byte for byte. A jar from another
 * release gives digests desktop users' OpenRocket rejects.
 */
export function checkJar(jar) {
  const sha = createHash('sha256').update(readFileSync(jar)).digest('hex');
  if (sha === PIN.jar.sha256) return;
  const msg = `${jar} is not the OpenRocket ${RELEASE} release jar (SHA-256 ${sha}, expected ${PIN.jar.sha256}).`;
  if (UNPINNED) {
    console.warn(`${msg}\nOPENROCKET_UNPINNED=1: using it anyway. Do not commit or publish what this run writes.`);
    return;
  }
  console.error(`${msg}\nPass --jar <OpenRocket-${RELEASE}.jar>, from ${PIN.jar.url}.`);
  process.exit(2);
}

/**
 * Exit unless OPENROCKET_UNPINNED=1 lets a built source tree through. A source
 * tree is never the pinned release: a part whose `.orc` row states a mass gets
 * its material from that tree's material database, so its digest differs from
 * the one desktop users' OpenRocket computes.
 */
export function checkSourceTree(dir) {
  const msg = `${dir} is a source tree, not the OpenRocket ${RELEASE} release jar, so its digests are not the release's.`;
  if (UNPINNED) {
    console.warn(`${msg}
OPENROCKET_UNPINNED=1: using it anyway. Do not commit or publish what this run writes.`);
    return;
  }
  console.error(
    `${msg}
Pass --jar <OpenRocket-${RELEASE}.jar>, from ${PIN.jar.url}, or set OPENROCKET_UNPINNED=1 to try it anyway.`,
  );
  process.exit(2);
}
