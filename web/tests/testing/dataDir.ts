import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Where `public/data` is on disk, for tests that read the shipped catalogs.
 *
 * Not `import.meta.url`: under the jsdom environment that resolves to an http
 * URL, and `readFileSync` refuses it ("The URL must be of scheme file"). Not
 * bare `process.cwd()` either, since that is wherever vitest was invoked from.
 * Walking up for the directory itself works from both.
 */
function findDataDir(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    const candidate = join(dir, 'public', 'data');
    if (existsSync(join(candidate, 'materials.generated.json'))) return candidate;
    const up = dirname(dir);
    if (up === dir) throw new Error('could not find public/data - run `npm run sync:materials`');
    dir = up;
  }
}

export const DATA_DIR = findDataDir();

/** One shipped data file, parsed. */
export function readData<T>(file: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')) as T;
}
