// Command-line flags for the build-time scripts.

/**
 * The value after `--name` on the command line, or undefined when the flag is
 * not given. A flag with no value after it (last on the line, or followed by
 * another flag) stops the script: falling back to a default would run against
 * a build or a tree nobody asked for.
 */
export function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const value = process.argv[i + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(`--${name} needs a value`);
    process.exit(2);
  }
  return value;
}
