/**
 * Run the Gradle wrapper WITHOUT a shell.
 *
 * Both scripts here used to call `execFileSync(gradlew.bat, args, { shell:
 * process.platform === 'win32' })`, because `execFile` cannot launch a `.bat`
 * directly. Node deprecated that combination (DEP0190) for a good reason: with
 * `shell: true` the argument array is CONCATENATED into a command line rather
 * than escaped, so any argument carrying a space or a shell metacharacter is a
 * quoting bug waiting for the first path with a space in it.
 *
 * `gradlew` and `gradlew.bat` both end in the same call, so we make it
 * ourselves: `java -jar gradle/wrapper/gradle-wrapper.jar <args>`. No shell on
 * any platform, no `.bat`, and the arguments stay an array the whole way.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

/**
 * The `java` to launch the wrapper with: the caller's JAVA_HOME when it really
 * exists, otherwise whatever is on PATH. Same rule the shell scripts apply, and
 * the same one `build-engine.mjs` already used to decide whether to pass
 * JAVA_HOME through to Gradle at all.
 */
export function javaExe(env = process.env) {
  const home = env.JAVA_HOME;
  if (home && existsSync(home)) {
    return join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  }
  return process.platform === 'win32' ? 'java.exe' : 'java';
}

/**
 * The full argv for `java`, given the Gradle arguments to run.
 *
 * JAVA_OPTS and GRADLE_OPTS are forwarded because the wrapper scripts forward
 * them and someone's environment may be counting on it. They are split on
 * whitespace, which is what the shell scripts effectively do too -- an option
 * containing a space was never expressible through them either.
 *
 * DEFAULT_JVM_OPTS (`-Xmx64m -Xms64m` in the generated wrapper) is deliberately
 * NOT forwarded: it sizes the little launcher JVM, and leaving it to the JVM
 * default only ever gives that process more headroom.
 */
export function gradleArgv(engineRoot, args, env = process.env) {
  const opts = [env.JAVA_OPTS, env.GRADLE_OPTS]
    .filter(Boolean)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean);
  return [
    ...opts,
    // Only cosmetic: it is what Gradle prints as the command name in its own
    // usage and error messages, and `gradlew` is what a reader would type.
    '-Dorg.gradle.appname=gradlew',
    '-jar',
    join(engineRoot, 'gradle', 'wrapper', 'gradle-wrapper.jar'),
    ...args,
  ];
}
