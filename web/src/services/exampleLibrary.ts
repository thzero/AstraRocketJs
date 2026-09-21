/**
 * OpenRocket's own example rockets, bundled with the app.
 *
 * Seventeen curated `.ork` files from the SAME upstream commit the engine was
 * extracted from (see scripts/sync-examples.mjs, which pulls and strips them).
 * They are a third way in beside "new" and "import": a first-time user has
 * something real to open, and every one of them exercises a feature worth
 * seeing — clusters, pods, tube fins, parallel and serial staging, dual deploy,
 * a payload section that separates.
 *
 * They live in `public/examples/`, copied verbatim into the build like the WASM
 * engine, NOT fetched through `remoteData` the way the motor and component
 * catalogs are. The catalogs are refreshed on a schedule from the `data` branch
 * because they change without the app; these change only when the app is
 * rebuilt against a newer OpenRocket, and they are precached, so opening one
 * works on a first offline load.
 *
 * An opened example is an IMPORT, not a library entry: it lands as an unsaved
 * working copy with no `activeDesignId`, so editing it can never write back
 * over the bundled file, and opening the same example twice gives two
 * independent designs.
 */

/** One entry of `examples.generated.json`. */
export interface ExampleMeta {
  /** Slug of the upstream filename; the id used in the UI and the file's stem. */
  id: string;
  /** File name under `public/examples/`. */
  file: string;
  /** Display name — upstream's FILE name, which is what its own menu shows. */
  name: string;
  /** The design's `<comment>`, or our own words where that was missing or
   *  would have promised a desktop feature this app does not have. */
  description: string | null;
  /** Size of the stripped `.ork`, for the picker. */
  bytes: number;
}

/** The shape `sync-examples.mjs` writes. */
interface ExampleIndex {
  generated: string;
  source: { repo: string; ref: string };
  examples: ExampleMeta[];
}

/** Under the deploy subpath, like every other public asset. */
const BASE = `${import.meta.env.BASE_URL}examples/`;

/** Read once per session: the index is a few kB and never changes at runtime. */
let cached: Promise<ExampleMeta[]> | undefined;

async function get(path: string): Promise<Response> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status} ${res.statusText}`);
  return res;
}

/** The bundled examples, newest generation first read wins. Rejects if absent. */
export function loadExampleIndex(): Promise<ExampleMeta[]> {
  cached ??= (async () => {
    const index = (await (await get('examples.generated.json')).json()) as ExampleIndex;
    if (!Array.isArray(index?.examples)) throw new Error('examples.generated.json has no examples');
    return index.examples;
  })().catch((e) => {
    // Do not cache a failure: a transient miss (a service worker mid-update, a
    // dev server started before the sync script ran) must not disable the
    // examples for the rest of the session.
    cached = undefined;
    throw e;
  });
  return cached;
}

/** One example's raw `.ork` bytes, ready for the normal import path. */
export async function fetchExample(file: string): Promise<ArrayBuffer> {
  return (await get(file)).arrayBuffer();
}
