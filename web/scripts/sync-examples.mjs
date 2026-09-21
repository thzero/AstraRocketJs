// Build-time importer for OpenRocket's own EXAMPLE ROCKETS.
//
// OpenRocket ships a folder of curated `.ork` files it opens from File → Open
// Example. They are the best starter designs that exist for this app: real,
// varied, authored by the people who wrote the physics, and already proven to
// load — everything one of ours would have to earn. This pulls them from the
// SAME upstream commit the engine was extracted from
// (engine-java/extract/UPSTREAM), so an example can never demonstrate a feature
// the bundled kernel does not have.
//
//   node scripts/sync-examples.mjs [--src <openrocket checkout>] [--ref <sha>]
//
// With no --src it reads the pinned repo/ref from UPSTREAM and fetches over
// HTTPS. --src points at a full OpenRocket checkout instead (the extractor's
// .openrocket-src is sparse to core/src/main/java, so it does NOT have these).
//
// WHAT IT STRIPS. Upstream's files carry the flight data of every simulation
// that was ever run in them: 96% of the bytes, 3.5 MB of the 3.6 MB across the
// set. It is dead weight here — `orkImport` never reads `<flightdata>`
// (`grep -rn flightdata src/services` is empty), because the app runs its own
// simulations and shows its own results. Stripping it takes the set to ~340 kB,
// which is small enough to sit in the build and be precached, so examples work
// on a first offline load like everything else. Verified byte-for-byte
// equivalent by exampleLibrary.test.ts, which builds every one through the real
// kernel and checks mass/CG/CP.
//
// WHY public/examples AND NOT public/data. The catalogs under public/data are
// refreshed on a schedule by .github/workflows/sync-catalogs.yml and served
// from the `data` branch so they can change without an app build. Examples are
// the opposite: they are pinned to the engine's upstream ref, so they change
// exactly when the app is rebuilt against a new OpenRocket. Routing them
// through the data branch would buy nothing and would cost the offline-first
// guarantee on first use.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const OUT_DIR = fileURLToPath(new URL('../public/examples', import.meta.url));
const UPSTREAM = fileURLToPath(new URL('../../engine-java/extract/UPSTREAM', import.meta.url));
const EXAMPLES_PATH = 'core/src/main/resources/datafiles/examples';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** repo + ref from engine-java/extract/UPSTREAM — the commit the engine is built from. */
function pinnedUpstream() {
  const text = readFileSync(UPSTREAM, 'utf8');
  const field = (k) => text.match(new RegExp(`^${k}\\s*=\\s*(\\S+)`, 'm'))?.[1];
  const repo = field('repo');
  const ref = arg('ref') ?? field('ref');
  if (!repo || !ref) throw new Error(`Could not read repo/ref from ${UPSTREAM}`);
  // https://github.com/owner/name.git → owner/name
  const slug = repo.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
  return { slug, ref };
}

/** Every example as { name, bytes }, from a local checkout or from GitHub. */
async function fetchExamples() {
  const src = arg('src') ?? process.env.OPENROCKET_SRC;
  if (src) {
    const dir = resolve(src, EXAMPLES_PATH);
    if (!existsSync(dir)) throw new Error(`No examples under ${dir} — is --src a full OpenRocket checkout?`);
    return readdirSync(dir)
      .filter((n) => n.toLowerCase().endsWith('.ork'))
      .map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(dir, name))) }));
  }

  const { slug, ref } = pinnedUpstream();
  console.log(`examples: ${slug} @ ${ref.slice(0, 12)}`);
  const listing = await fetch(`https://api.github.com/repos/${slug}/contents/${EXAMPLES_PATH}?ref=${ref}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'astrarocketjs-sync-examples' },
  });
  if (!listing.ok) throw new Error(`GitHub listing failed: ${listing.status} ${listing.statusText}`);
  const entries = (await listing.json()).filter((e) => e.type === 'file' && e.name.toLowerCase().endsWith('.ork'));

  const out = [];
  for (const e of entries) {
    const res = await fetch(e.download_url, { headers: { 'user-agent': 'astrarocketjs-sync-examples' } });
    if (!res.ok) throw new Error(`Download failed for ${e.name}: ${res.status}`);
    out.push({ name: e.name, bytes: new Uint8Array(await res.arrayBuffer()) });
  }
  return out;
}

/** "Pods--airframes and winglets.ork" → "pods-airframes-and-winglets". */
const slugify = (filename) =>
  filename
    .replace(/\.ork$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** One tag's text out of the rocket element's own header (not a descendant's). */
function headerTag(xml, tag) {
  const head = xml.match(/<rocket>[\s\S]*?<subcomponents>/)?.[0] ?? '';
  const raw = head.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1];
  if (raw == null) return null;
  const text = raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

// Descriptions we write ourselves, keyed by slug.
//
// Upstream's <comment> is the description everywhere it exists, because it is
// the author's own words about the design. These fill the gaps:
//   - three files carry no comment at all;
//   - the two "simulation extension" examples demonstrate a DESKTOP PLUGIN
//     (roll control and airstart via OpenRocket's extension API, one of them in
//     JavaScript). The airframes load and fly here, but the extension does not
//     run, so upstream's description would promise behavior this app does not
//     have. They are still worth shipping as designs; they are not worth
//     shipping under a description that is false.
const DESCRIPTIONS = {
  'a-simple-model-rocket': 'A three-fin, one-motor beginner design. The smallest complete rocket in the set.',
  'parallel-booster-staging': 'Strap-on boosters that separate in flight, built as parallel stages.',
  'tube-fin-rocket': 'Tube fins instead of flat ones: six body tubes around the airframe in place of a fin set.',
  'simulation-extensions':
    'A roll-control airframe from OpenRocket, with canards and an airstart. Upstream flies it with a desktop simulation extension that steers the canards; that extension does not run here, so it flies as the plain airframe.',
  'simulation-scripting':
    'The roll-control airframe again, scripted in JavaScript upstream. As above, the script does not run here and it flies as the plain airframe.',
};

/** Drop every stored simulation result, keeping the design and its decals. */
function stripFlightData(bytes) {
  const files = unzipSync(bytes);
  const out = {};
  for (const [name, content] of Object.entries(files)) {
    if (!name.toLowerCase().endsWith('.ork')) {
      out[name] = content;
      continue;
    }
    const xml = strFromU8(content)
      .replace(/<flightdata\b[^>]*\/>/g, '')
      .replace(/<flightdata\b[\s\S]*?<\/flightdata>/g, '');
    out[name] = strToU8(xml);
  }
  return { zip: zipSync(out, { level: 9 }), xml: strFromU8(out[Object.keys(out).find((n) => n.endsWith('.ork'))]) };
}

const sources = await fetchExamples();
if (sources.length === 0) {
  // Same floor as sync-motors / sync-components: never publish an empty set
  // over a good one just because a path or a listing went wrong.
  console.error('Refusing to write examples: none found upstream.');
  process.exit(1);
}

// Rewritten from scratch every run, so an example REMOVED upstream is removed
// here too rather than lingering as a file nothing indexes.
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const examples = [];
let before = 0;
for (const { name, bytes } of sources.sort((a, b) => a.name.localeCompare(b.name))) {
  before += bytes.length;
  const { zip, xml } = stripFlightData(bytes);
  const id = slugify(name);
  writeFileSync(join(OUT_DIR, `${id}.ork`), zip);
  examples.push({
    id,
    file: `${id}.ork`,
    // The FILENAME, not the design's <name>: upstream's menu labels these by
    // file, and at least one ("Two stage high power rocket") is called plain
    // "Rocket" inside.
    name: name.replace(/\.ork$/i, ''),
    description: DESCRIPTIONS[id] ?? headerTag(xml, 'comment'),
    bytes: zip.length,
  });
}

const { slug, ref } = arg('src') ? { slug: 'local', ref: arg('src') } : pinnedUpstream();
writeFileSync(
  join(OUT_DIR, 'examples.generated.json'),
  JSON.stringify({ generated: new Date().toISOString(), source: { repo: slug, ref }, examples }, null, 2) + '\n',
);

const after = examples.reduce((n, e) => n + e.bytes, 0);
console.log(
  `Wrote ${examples.length} examples → public/examples/ ` +
    `(${(before / 1024 / 1024).toFixed(2)} MB upstream → ${(after / 1024).toFixed(0)} kB stripped)`,
);
