import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';
import { DATA_DIR } from './dataDir';

/**
 * Serves `public/data/` over a stubbed `fetch`, so a test can use the REAL
 * catalogs.
 *
 * The data files are runtime files now, not imports, which means a component
 * that wants a material list does a fetch — and in a test there is no server to
 * answer it. Rather than mock the loader and test around it, this answers with
 * the bytes that actually ship: the same `materials.generated.json` the app
 * downloads, the same shape guard, the same merge with the user's custom
 * materials. A row committed wrong therefore fails here too.
 *
 * The reply has no `body`, only `json()`. `readJson` in remoteData.ts falls
 * back to `res.json()` when there is no stream, which is the path it documents
 * as "a stubbed Response in tests"; the streaming/progress path belongs to the
 * megabyte catalogs and is exercised in `remoteData.test.ts` with its own stub.
 *
 * Call it in `beforeAll`. `vi.unstubAllGlobals()` (or `restoreMocks`) undoes it.
 */
export function serveData(): void {
  vi.stubGlobal('fetch', (input: unknown) => {
    const url = String(typeof input === 'object' && input && 'url' in input ? (input as { url: string }).url : input);
    // Strip the ?v=<hash> cache-buster, and take the last segment: the app
    // resolves these against BASE_URL, which is not a real origin here.
    const file = url.split('?')[0]!.split('/').pop()!;
    let text: string;
    try {
      text = readFileSync(join(DATA_DIR, file), 'utf8');
    } catch {
      // A missing manifest.json is not an error to the loader (it just means no
      // cache-buster), and this is how it says so.
      return Promise.resolve({ ok: false, status: 404, headers: new Headers(), json: () => Promise.resolve({}) });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.resolve(JSON.parse(text)),
    });
  });
}
