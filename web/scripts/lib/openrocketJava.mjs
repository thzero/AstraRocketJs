// Run a small Java program against an installed OpenRocket, and read its output.
//
// Every step that reads desktop OpenRocket goes through here: the sync steps
// that copy its checksums and materials, and the checks that hold the app to
// it. A dumper is compiled against the release jar, run, and its TSV read. The
// classpath hunting and the release discovery live here so the steps cannot
// drift into pointing at different builds, which would make the digests and
// the checks disagree with each other.
//
// Nothing here is part of the app build. These are data steps, run when a
// catalog is refreshed.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { arg } from './args.mjs';
import { checkJar, checkSourceTree } from './openrocketRelease.mjs';

/** The Gradle-cached jars a `--or` checkout needs, by artifact name. */
const JARS = [
  'angus-activation',
  'aopalliance',
  'caffeine',
  'checker-qual',
  'classgraph',
  'commonmark',
  'commons-io',
  'commons-lang3',
  'error_prone_annotations',
  'failureaccess',
  'guava',
  'guice',
  'istack-commons-runtime',
  'jackson-annotations',
  'jackson-core',
  'jackson-databind',
  'jakarta.activation',
  'jakarta.inject-api',
  'jakarta.xml.bind-api',
  'jaxb-core',
  'jaxb-runtime',
  'logback-classic',
  'logback-core',
  'opencsv',
  'slf4j-api',
  'txw2',
];

/** Every jar under the Gradle cache whose file name starts with a wanted artifact. */
function cachedJars() {
  const gradleHome = process.env.GRADLE_USER_HOME ?? join(homedir(), '.gradle');
  const root = join(gradleHome, 'caches/modules-2/files-2.1');
  if (!existsSync(root)) throw new Error(`no Gradle cache at ${root}; build the OpenRocket checkout first`);
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 5) return;
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, name.name);
      if (name.isDirectory()) walk(p, depth + 1);
      else if (
        name.name.endsWith('.jar') &&
        !name.name.includes('-sources') &&
        !name.name.includes('-javadoc') &&
        JARS.some((j) => name.name.startsWith(`${j}-`))
      ) {
        out.push(p);
      }
    }
  };
  walk(root, 0);
  if (!out.length) throw new Error('found no dependency jars in the Gradle cache');
  return out;
}

/**
 * The installed OpenRocket, when neither flag is given.
 *
 * The usual case is a release install. The jar found is checked against the
 * pinned release where it is used (lib/openrocketRelease.mjs), because an
 * install of another release gives digests the desktop rejects. A path that is
 * not there is skipped, and finding none is reported by the caller.
 */
export function installedJar() {
  const roots = [
    'C:/Program Files/OpenRocket/jar',
    'C:/Program Files (x86)/OpenRocket/jar',
    '/Applications/OpenRocket.app/Contents/app',
    // The Linux installer's system-wide and per-user defaults.
    '/opt/OpenRocket/jar',
    '/opt/openrocket/jar',
    join(homedir(), 'OpenRocket/jar'),
  ];
  for (const dir of roots) {
    if (!existsSync(dir)) continue;
    const jar = readdirSync(dir).find((f) => /^OpenRocket.*\.jar$/i.test(f));
    if (jar) return join(dir, jar);
  }
  return null;
}

function classpath(orDir, jar) {
  // A release jar is self-contained: it carries the classes, the dependencies
  // and the databases.
  if (jar) {
    if (!existsSync(jar)) throw new Error(`no such jar: ${jar}`);
    checkJar(jar);
    return jar;
  }
  checkSourceTree(orDir);
  const main = join(orDir, 'core/build/classes/java/main');
  const test = join(orDir, 'core/build/classes/java/test');
  for (const d of [main, test]) {
    if (!existsSync(d)) {
      throw new Error(`missing ${d}\nBuild the checkout first: cd ${orDir} && ./gradlew build`);
    }
  }
  // `delimiter` is the platform's class path separator: `;` on Windows, `:` elsewhere.
  return [...cachedJars(), main, test, join(orDir, 'core/build/resources/main')].join(delimiter);
}

/**
 * Which OpenRocket to read, from `--jar`, `--or`, or whatever is installed.
 * Exits rather than guessing: a digest from the wrong build is a digest the
 * desktop rejects.
 */
export function chooseBuild() {
  const orDir = arg('or');
  const jar = arg('jar') ?? (orDir ? null : installedJar());
  if (!orDir && !jar) {
    console.error(
      'No installed OpenRocket found. Pass one:\n' +
        '  --jar <OpenRocket-NN.NN.jar>   a release\n' +
        '  --or  <openrocket checkout>    a built source tree (needs OPENROCKET_UNPINNED=1)',
    );
    process.exit(2);
  }
  return { cp: classpath(orDir, jar), label: jar ?? orDir };
}

/**
 * Compile `javaSrc` against that build, run `className <out.tsv>`, and return
 * the rows as arrays of fields.
 */
export function runDumper({ cp, javaSrc, className }) {
  const work = mkdtempSync(join(tmpdir(), 'or-digests-'));
  try {
    execFileSync('javac', ['-cp', cp, '-d', work, javaSrc], { stdio: 'inherit' });
    const out = join(work, 'dump.tsv');
    const log = execFileSync('java', ['-cp', `${cp}${delimiter}${work}`, className, out], { encoding: 'utf8' });
    process.stdout.write(`  ${log.trim()}\n`);
    // Split on either ending: the Java writer emits platform line separators,
    // and on Windows a stray carriage return otherwise rides into the last
    // field, which is the digest, and is then written out as a wrong checksum.
    return readFileSync(out, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((l) => l.split('\t'));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
