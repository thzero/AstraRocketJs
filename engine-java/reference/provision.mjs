/**
 * provision.mjs - make the pinned PRISTINE upstream OpenRocket core available
 * to the reference harness.
 *
 * The harness compiles upstream `core/src/main/java` UNMODIFIED - no extraction,
 * no patches - so that its flight results are an INDEPENDENT reference for the
 * engine we ship. `test/parity/` cannot serve that role: its JVM, JS and WASM
 * targets all compile from `src/java`, which is upstream PLUS `patches/`, so the
 * three agreeing proves only that TeaVM did not break anything.
 *
 * The upstream tree is the same cache `extract/extract.mjs` provisions
 * (`engine-java/.openrocket-src`), at the same ref, read from the same
 * `extract/UPSTREAM` - that file is deliberately the only copy of the pin and
 * this must not become a second one. Extraction only needs `core/src/main/java`;
 * compiling core also needs its resources (l10n, datafiles, build.properties),
 * its one vendored jar (`core/libs/script-api-1.0.jar`) and its `build.gradle`,
 * which is where the dependency list is read from. Widening a non-cone sparse
 * checkout is additive, so extraction is unaffected, and this re-adds the paths
 * on every run so a cache rebuilt by `extract --refresh` self-heals.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = join(here, '..');
const cache = join(engineRoot, '.openrocket-src');

/** Paths core needs to COMPILE, beyond the java the extractor already takes. */
// Leading slash on the single FILE, or git warns that a bare path could match at
// any depth (NON-CONE PROBLEMS in git-sparse-checkout(1)).
const SPARSE = ['core/src/main/java', 'core/src/main/resources', 'core/libs', '/core/build.gradle'];

const die = (m) => {
  console.error(`provision: ${m}`);
  process.exit(1);
};
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();
const firstLine = (e) => String(e && e.message ? e.message : e).split('\n')[0];

/** repo + ref, parsed out of extract/UPSTREAM - the single source of truth. */
const readPin = () => {
  const text = readFileSync(join(engineRoot, 'extract', 'UPSTREAM'), 'utf8');
  const field = (k) => {
    const m = text.match(new RegExp('^\\s*' + k + '\\s*=\\s*(\\S+)\\s*$', 'm'));
    return m ? m[1] : undefined;
  };
  const repo = field('repo');
  const ref = field('ref');
  if (!repo || !ref) die('extract/UPSTREAM is missing a repo or ref line');
  return { repo, ref };
};

export const provision = () => {
  const { repo, ref } = readPin();
  const at = () => {
    try {
      return git(cache, 'rev-parse', 'HEAD');
    } catch {
      return null;
    }
  };
  if (!existsSync(join(cache, '.git'))) {
    try {
      mkdirSync(cache, { recursive: true });
      git(cache, 'init', '-q');
      git(cache, 'remote', 'add', 'origin', repo);
      git(cache, 'config', 'core.sparseCheckout', 'true');
      git(cache, 'sparse-checkout', 'set', '--no-cone', ...SPARSE);
      console.log(`provision: fetching pinned upstream ${ref.slice(0, 9)} from ${repo}`);
      git(cache, 'fetch', '--depth', '1', '--filter=blob:none', 'origin', ref);
      git(cache, 'checkout', '-q', 'FETCH_HEAD');
    } catch (e) {
      die(
        `could not fetch the pinned upstream (${repo} @ ${ref.slice(0, 9)}).\n`
          + `  ${firstLine(e)}\n`
          + '  Needs git and network.',
      );
    }
  } else {
    // Cache exists (extraction made it, or we did). Widen it to what core needs
    // to compile; `add` is idempotent and leaves extraction's paths in place.
    try {
      git(cache, 'sparse-checkout', 'add', ...SPARSE);
    } catch (e) {
      die(`could not widen the upstream sparse checkout: ${firstLine(e)}`);
    }
  }
  const got = at();
  if (got !== ref) {
    die(
      `upstream cache is at ${got || '(nothing)'}, expected ${ref}.\n`
        + '  Run `node extract/extract.mjs --check` to re-point it at the pin.',
    );
  }
  for (const p of SPARSE) {
    if (!existsSync(join(cache, p))) die(`upstream cache is missing ${p} after provisioning`);
  }
  return { dir: cache, ref, repo };
};

const invokedDirectly = () => {
  const arg = process.argv[1];
  if (!arg) return false;
  return import.meta.url === new URL(`file://${arg.split('\\').join('/')}`).href;
};

if (invokedDirectly()) {
  const { dir, ref } = provision();
  console.log(`provision: pristine upstream ${ref.slice(0, 9)} ready at ${dir}`);
}
