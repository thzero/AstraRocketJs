// Build-time extractor for OpenRocket components (what OpenRocket calls
// "component presets"). Reads OpenRocket's own `.orc` files (XML) of real
// manufacturer parts, and writes an SI-normalized JSON catalog to a staging file;
// `sync-preset-digests.mjs` adds the digests and stated masses and writes the
// catalog the app loads from public/data. Local OpenRocket data only, no network.
//
// Desktop's parts library is two sets of files, and this reads both: the
// community database (`--src`, below) and the files OpenRocket ships inside its
// own jar under datafiles/components/internal: the legacy manufacturer files,
// several parachute makers and the rail button database. The internal set is
// read from the OpenRocket release jar (`--jar`, or an installed OpenRocket), the
// same build the digests come from, or from a directory of those files
// (`--internal`). Desktop's built-in materials are read from the jar either
// way (lib/builtInMaterials.mjs). The jar has to be the pinned release
// (lib/openrocketRelease.mjs), and the database has to match the copy that jar
// ships, file for file, so the catalog is the library of the release desktop
// users run. Desktop keeps every part from both, duplicates included, and
// tells them apart by digest, so this keeps them all too.
//
// Brings in every kind desktop's parts library offers: body tubes, nose cones,
// transitions, tube couplers, centering rings, bulkheads, engine blocks, launch
// lugs, rail buttons, parachutes and streamers. Run manually / in CI when
// refreshing the catalog:
//   node scripts/sync-components.mjs [--src <openrocket presets dir>] [--jar <OpenRocket.jar> | --internal <dir>]
//
// Then run `npm run sync:preset-digests`. This script cannot produce the part
// digest a `.ork` needs, because OpenRocket computes it at load time rather than
// storing it in the `.orc` (see sync-preset-digests.mjs). So it writes the
// catalog to a staging file (lib/catalogStaging.mjs), not to public/data: the
// digest step reads it from there, and only a catalog with its digests reaches
// public/data.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { STAGED_COMPONENTS } from './lib/catalogStaging.mjs';
import { nearestMaterial } from './lib/nearestMaterial.mjs';
import { arg } from './lib/args.mjs';
import { builtInMaterials } from './lib/builtInMaterials.mjs';
import { installedJar } from './lib/openrocketJava.mjs';
import { checkJar, RELEASE, UNPINNED } from './lib/openrocketRelease.mjs';
import { lenM, num, str, tag, xmlText } from './lib/orcText.mjs';
import { uniqueRows } from './lib/partRows.mjs';

// Source: the OpenRocket-Components DB (openrocket/openrocket-database), the
// parts database OpenRocket builds its own library from, cloned into
// web/openrocket-database by `npm run sync:database`. Override with --src /
// OPENROCKET_PRESETS to point at another `.orc` tree.
const DEFAULT_SRC = fileURLToPath(new URL('../openrocket-database/orc', import.meta.url));
const SRC = arg('src') ?? (process.env.OPENROCKET_PRESETS || DEFAULT_SRC);
// public/data is served as-is (not bundled) so the catalog can be refreshed
// without rebuilding the app; see src/services/app/remoteData.ts.
const DATA_DIR = fileURLToPath(new URL('../public/data', import.meta.url));
const OUT = resolve(DATA_DIR, 'components.generated.json');

// Unit → SI factors for a stated mass; lengths are read by lib/orcText.mjs.
const MASS = { g: 0.001, kg: 1, oz: 0.028349523125, lb: 0.45359237, '': 1 };

/** A part's material: its name and the `Type` attribute desktop looks it up by. */
const materialRef = (block) => {
  const m = [...block.matchAll(/<Material(\s+[^>]*)?>([^<]*)<\/Material>/g)].at(-1);
  const name = m && xmlText(m[2]).trim();
  if (!name) return null;
  const type = (m[1] || '').match(/Type="([^"]*)"/)?.[1] ?? 'BULK';
  // Some parts reference a material by "[material:Name]". The catalog shows the
  // name inside; the part's own file defines it under the whole string.
  const ref = name.match(/^\[material:(.+)\]$/);
  return { name: ref ? ref[1] : name, raw: name, type };
};

function blocks(text, name) {
  return text.match(new RegExp(`<${name}>[\\s\\S]*?</${name}>`, 'g')) ?? [];
}

const orcFiles = (dir) =>
  readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.orc'))
    .map((f) => ({ name: f, text: readFileSync(join(dir, f), 'utf8') }));

/** The `.orc` files under one folder of the jar, as `{ name, text }`. */
function jarFiles(entries, prefix) {
  return Object.entries(entries)
    .filter(([name]) => name.startsWith(prefix))
    .map(([name, bytes]) => ({ name: name.slice(prefix.length), text: new TextDecoder().decode(bytes) }));
}

/** The pinned release's jar: `--jar`, `OPENROCKET_JAR`, or the installed OpenRocket. */
function releaseJar() {
  const jar = arg('jar') ?? process.env.OPENROCKET_JAR ?? installedJar();
  if (!jar) {
    console.error(`No OpenRocket jar. Pass --jar <OpenRocket-${RELEASE}.jar>.`);
    process.exit(2);
  }
  checkJar(jar);
  return jar;
}

/**
 * The part files OpenRocket ships, as `{ name, text }`: the internal set, and
 * the jar's copy of the database (null when they come from `--internal`).
 */
function shippedFiles() {
  const dir = arg('internal') ?? process.env.OPENROCKET_INTERNAL_PRESETS;
  if (dir) return { internal: orcFiles(dir), database: null, jar: null };
  const jar = releaseJar();
  const entries = unzipSync(readFileSync(jar), {
    filter: (f) => f.name.startsWith('datafiles/components/') && f.name.toLowerCase().endsWith('.orc'),
  });
  return {
    internal: jarFiles(entries, 'datafiles/components/internal/'),
    database: jarFiles(entries, 'datafiles/components/database/'),
    jar,
  };
}

const database = orcFiles(SRC);
const shipped = shippedFiles();

// The database has to be the one the release ships. Line endings differ between
// the repository and the jar, and nothing else may.
if (shipped.database) {
  const lf = (s) => s.replace(/\r\n?/g, '\n');
  const ours = new Map(database.map((f) => [f.name, lf(f.text)]));
  const theirs = new Map(shipped.database.map((f) => [f.name, lf(f.text)]));
  const differ = [...new Set([...ours.keys(), ...theirs.keys()])]
    .filter((name) => ours.get(name) !== theirs.get(name))
    .sort();
  if (differ.length) {
    const msg = `${SRC} is not the parts database OpenRocket ${RELEASE} ships; these files differ: ${differ.join(', ')}`;
    if (!UNPINNED) {
      console.error(`${msg}\nRun \`npm run sync:database\` for the pinned commit.`);
      process.exit(1);
    }
    console.warn(`${msg}\nOPENROCKET_UNPINNED=1: using it anyway.`);
  }
} else {
  console.warn('Read the internal files from --internal, so the database is not compared with the release.');
}

// The database first, then the internal files, the order desktop loads them.
const sources = [...database, ...shipped.internal];

// Desktop's built-in materials come from the release jar even when the part
// files come from `--internal`.
const builtIn = builtInMaterials(shipped.jar ?? releaseJar());

// Pass 1: each file's own materials, by type and name. A part looks its
// material up the way `BaseComponentDTO.find` does: in its own file first (the
// legacy files define materials under names the database also uses, at other
// densities), then among desktop's built-in materials. With neither, desktop
// weighs the part at nothing, and `withMaterial` gives it the nearest built-in
// material instead.
const fileMaterials = new Map();
for (const { name: file, text } of sources) {
  const own = new Map();
  fileMaterials.set(file, own);
  const section = text.match(/<Materials>([\s\S]*?)<\/Materials>/);
  if (!section) continue;
  for (const b of section[1].match(/<Material\b[^>]*>[\s\S]*?<\/Material>/g) ?? []) {
    const name = xmlText(b.match(/<Name>([^<]*)<\/Name>/)?.[1] ?? '').trim();
    const type = b.match(/<Type>([^<]*)<\/Type>/)?.[1]?.trim();
    const density = Number(b.match(/<Density>([^<]*)<\/Density>/)?.[1]);
    if (!name || !type || !Number.isFinite(density)) continue;
    // The first definition of a name, as the lookup walks the file's list.
    const key = `${type}\u0000${name}`;
    if (!own.has(key)) own.set(key, density);
  }
}

// Pass 2: parts. A row that repeats an earlier one in every field is dropped
// and every other row is kept, as desktop keeps every preset and tells them
// apart by digest (lib/partRows.mjs has the key).
const { rows: components, push } = uniqueRows();
// The part number is trimmed here, and the desktop keeps trailing spaces;
// sync-preset-digests gives a row it matches the desktop's own spelling, which
// is the string a saved `.ork` has to carry for the desktop to find the part.
const common = (b) => ({
  mfr: str(b, 'Manufacturer') || '?',
  partNo: str(b, 'PartNumber') || '',
  desc: str(b, 'Description') || '',
});
let currentFile = '';
const withMaterial = (b) => {
  const ref = materialRef(b);
  if (!ref) return { material: undefined, materialDensity: 0 };
  // Its own file by exact name; the built-in materials ignoring case, as
  // `Databases.findMaterial` compares them. A name with no density there, or
  // defined at 0, takes the nearest built-in material (lib/nearestMaterial).
  const density = fileMaterials.get(currentFile)?.get(`${ref.type}\u0000${ref.raw}`) ?? builtIn(ref.type, ref.name);
  if (density > 0) return { material: ref.name, materialDensity: density };
  return nearestMaterial(ref.type, ref.name, builtIn) ?? { material: ref.name, materialDensity: density ?? 0 };
};
const massKg = (block, name) => {
  const t = tag(block, name);
  if (!t || t.value === '') return null;
  const n = Number(t.value);
  return Number.isFinite(n) && n > 0 ? n * (MASS[t.unit] ?? 1) : null;
};

for (const { name: f, text } of sources) {
  currentFile = f;

  for (const b of blocks(text, 'BodyTube')) {
    const outerDiameter = lenM(b, 'OutsideDiameter');
    const length = lenM(b, 'Length');
    if (!outerDiameter || !length) continue;
    push({
      type: 'bodytube',
      ...common(b),
      ...withMaterial(b),
      outerDiameter,
      innerDiameter: lenM(b, 'InsideDiameter'),
      length,
    });
  }

  for (const b of blocks(text, 'NoseCone')) {
    const outerDiameter = lenM(b, 'OutsideDiameter');
    const length = lenM(b, 'Length');
    if (!outerDiameter || !length) continue;
    push({
      type: 'nosecone',
      ...common(b),
      ...withMaterial(b),
      shape: (str(b, 'Shape') || 'OGIVE').toLowerCase(),
      filled: str(b, 'Filled') === 'true',
      // The wall and the shoulder, as NoseCone.loadFromPreset reads them. A
      // stated mass is spread over this whole volume, shoulder included.
      thickness: lenM(b, 'Thickness'),
      outerDiameter,
      length,
      shoulderDiameter: lenM(b, 'ShoulderDiameter'),
      shoulderLength: lenM(b, 'ShoulderLength'),
    });
  }

  // The canopy only. Its lines, packed size and materials are what the
  // desktop's loader resolves, and sync-preset-digests adds them from there.
  // The element goes with the row so a part that differs from an earlier one
  // only in those keeps its row (lib/partRows.mjs).
  for (const b of blocks(text, 'Parachute')) {
    const diameter = lenM(b, 'Diameter');
    if (!diameter) continue;
    push({ type: 'parachute', ...common(b), diameter, cd: num(b, 'DragCoefficient') }, b);
  }

  // Inner structural parts (placed inside a body tube by the component-tree
  // editor): tube coupler + centering ring share the tube schema; bulkhead is a
  // solid disc (no inner diameter).
  for (const b of blocks(text, 'TubeCoupler')) {
    const outerDiameter = lenM(b, 'OutsideDiameter');
    const length = lenM(b, 'Length');
    if (!outerDiameter || !length) continue;
    push({
      type: 'tubecoupler',
      ...common(b),
      ...withMaterial(b),
      outerDiameter,
      innerDiameter: lenM(b, 'InsideDiameter'),
      length,
    });
  }

  for (const b of blocks(text, 'CenteringRing')) {
    const outerDiameter = lenM(b, 'OutsideDiameter');
    const length = lenM(b, 'Length');
    if (!outerDiameter || !length) continue;
    push({
      type: 'centeringring',
      ...common(b),
      ...withMaterial(b),
      outerDiameter,
      innerDiameter: lenM(b, 'InsideDiameter'),
      length,
    });
  }

  // Transition: both ends and both shoulders, as Transition.loadFromPreset
  // reads them. A stated wall is kept; most rows state Filled instead. One end
  // may be 0 (a reversed nose cone sold as a transition), as desktop allows.
  for (const b of blocks(text, 'Transition')) {
    const foreOuterDiameter = lenM(b, 'ForeOutsideDiameter');
    const aftOuterDiameter = lenM(b, 'AftOutsideDiameter');
    const length = lenM(b, 'Length');
    if (foreOuterDiameter == null || aftOuterDiameter == null || !(length > 0)) continue;
    if (!(foreOuterDiameter > 0 || aftOuterDiameter > 0)) continue;
    push({
      type: 'transition',
      ...common(b),
      ...withMaterial(b),
      shape: (str(b, 'Shape') || 'CONICAL').toLowerCase(),
      filled: str(b, 'Filled') === 'true',
      thickness: lenM(b, 'Thickness'),
      length,
      foreOuterDiameter,
      foreShoulderDiameter: lenM(b, 'ForeShoulderDiameter'),
      foreShoulderLength: lenM(b, 'ForeShoulderLength'),
      aftOuterDiameter,
      aftShoulderDiameter: lenM(b, 'AftShoulderDiameter'),
      aftShoulderLength: lenM(b, 'AftShoulderLength'),
    });
  }

  // Engine blocks and launch lugs share the tube schema (OD/ID/length).
  for (const [tag, type] of [
    ['EngineBlock', 'engineblock'],
    ['LaunchLug', 'launchlug'],
  ]) {
    for (const b of blocks(text, tag)) {
      const outerDiameter = lenM(b, 'OutsideDiameter');
      const length = lenM(b, 'Length');
      if (!outerDiameter || !length) continue;
      push({
        type,
        ...common(b),
        ...withMaterial(b),
        outerDiameter,
        innerDiameter: lenM(b, 'InsideDiameter'),
        length,
      });
    }
  }

  // Streamer: the strip's length and width, and its surface material, whose
  // density is per square meter.
  for (const b of blocks(text, 'Streamer')) {
    const stripLength = lenM(b, 'Length');
    const stripWidth = lenM(b, 'Width');
    if (!stripLength || !stripWidth) continue;
    push({ type: 'streamer', ...common(b), ...withMaterial(b), stripLength, stripWidth });
  }

  // Rail buttons: the geometry RailButton.loadFromPreset reads, and the
  // button, screw and nut masses it adds together into a mass override.
  for (const b of blocks(text, 'RailButton')) {
    const outerDiameter = lenM(b, 'OuterDiameter');
    const height = lenM(b, 'Height');
    if (!outerDiameter || !height) continue;
    const parts = ['Mass', 'ScrewMass', 'NutMass'].map((m) => massKg(b, m));
    const mass = parts.some((m) => m != null) ? parts.reduce((s, m) => s + (m ?? 0), 0) : undefined;
    const cd = num(b, 'DragCoefficient');
    push({
      type: 'railbutton',
      ...common(b),
      ...withMaterial(b),
      outerDiameter,
      innerDiameter: lenM(b, 'InnerDiameter'),
      height,
      baseHeight: lenM(b, 'BaseHeight'),
      flangeHeight: lenM(b, 'FlangeHeight'),
      screwHeight: lenM(b, 'ScrewHeight'),
      cd: cd != null && cd > 0 ? cd : null,
      ...(mass != null ? { mass } : {}),
    });
  }

  for (const b of blocks(text, 'BulkHead')) {
    const outerDiameter = lenM(b, 'OutsideDiameter');
    const length = lenM(b, 'Length');
    if (!outerDiameter || !length) continue;
    push({
      type: 'bulkhead',
      ...common(b),
      ...withMaterial(b),
      outerDiameter,
      length,
      filled: str(b, 'Filled') === 'true',
    });
  }
}

const byType = components.reduce((m, p) => ((m[p.type] = (m[p.type] ?? 0) + 1), m), {});
if (components.length === 0) {
  // Same floor as sync-motors: this runs on a schedule with write access to
  // the branch the live app reads, and an empty source tree (a bad --src, a
  // renamed upstream directory) must not publish an empty picker.
  console.error(`Refusing to write components.generated.json: no components parsed from ${SRC}`);
  process.exit(1);
}
if (existsSync(OUT)) {
  let prev = null;
  try {
    prev = JSON.parse(readFileSync(OUT, 'utf8'));
  } catch {
    // Unreadable or corrupt previous catalog: nothing to hold this one to.
  }
  if (Array.isArray(prev?.components) && components.length < 0.9 * prev.components.length) {
    console.error(
      `Refusing to write components.generated.json: catalog shrank from ${prev.components.length} to ${components.length}`,
    );
    process.exit(1);
  }
}
// The stamp is provisional: sync-preset-digests keeps the previous one when the
// finished parts are unchanged.
const generated = new Date().toISOString();
writeFileSync(STAGED_COMPONENTS, JSON.stringify({ generated, count: components.length, components }) + '\n');
console.log(`Staged ${components.length} components in ${STAGED_COMPONENTS}`, byType);
console.log('Run `npm run sync:preset-digests` to add their digests and write public/data/components.generated.json.');
