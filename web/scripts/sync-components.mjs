// Build-time extractor for OpenRocket components (what OpenRocket calls
// "component presets"). Reads OpenRocket's own `.orc` files (XML) of real
// manufacturer parts, and writes an SI-normalized JSON catalog the app loads at
// run time from public/data (like sync-motors.mjs, but from local OpenRocket data instead of the
// thrustcurve API; no network).
//
// Desktop's parts library is two sets of files, and this reads both: the
// community database (`--src`, below) and the files OpenRocket ships inside its
// own jar under datafiles/components/internal: the legacy manufacturer files,
// several parachute makers and the rail button database. The internal set is
// read from the OpenRocket release jar (`--jar`, or an installed OpenRocket), the
// same build the digests come from, or from a directory of those files
// (`--internal`). Desktop keeps every part from both, duplicates included, and
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
// storing it in the `.orc` (see sync-preset-digests.mjs). A catalog refreshed
// without that second step carries no digests, and every part link then stays
// out of saved files, silently: `defaultRocketParts.test.ts` fails when that
// happens, which is the alarm.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { writeDataManifest } from './lib/dataManifest.mjs';
import { installedJar } from './lib/openrocketJava.mjs';
import { PREVIOUS_CATALOG } from './lib/catalogStamp.mjs';

// Source: the OpenRocket-Components DB (openrocket/openrocket-database), the
// parts database OpenRocket builds its own library from,
// cloned into web/openrocket-database by `npm run sync:database`. Override with
// --src / OPENROCKET_PRESETS to point at another `.orc` tree.
const DEFAULT_SRC = fileURLToPath(new URL('../openrocket-database/orc', import.meta.url));
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const SRC = arg('src') ?? (process.env.OPENROCKET_PRESETS || DEFAULT_SRC);
// public/data is served as-is (not bundled) so the catalog can be refreshed
// without rebuilding the app; see src/services/app/remoteData.ts.
const DATA_DIR = fileURLToPath(new URL('../public/data', import.meta.url));
const OUT = resolve(DATA_DIR, 'components.generated.json');

// Unit → SI factors.
const LEN = { in: 0.0254, mm: 0.001, cm: 0.01, m: 1, ft: 0.3048, '': 1 };
const MASS = { g: 0.001, kg: 1, oz: 0.028349523125, lb: 0.45359237, '': 1 };

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(\\s+[^>]*)?>([^<]*)</${name}>`));
  if (!m) return null;
  const unit = (m[1] || '').match(/Unit="([^"]*)"/)?.[1] ?? '';
  return { value: m[2].trim(), unit };
}
const lenM = (block, name) => {
  const t = tag(block, name);
  if (!t || t.value === '') return null;
  const n = Number(t.value);
  return Number.isFinite(n) ? n * (LEN[t.unit] ?? 1) : null;
};
const num = (block, name) => {
  const t = tag(block, name);
  const n = t ? Number(t.value) : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (block, name) => tag(block, name)?.value ?? null;
const materialRef = (block) => {
  let m = block.match(/<Material(\s+[^>]*)?>([^<]*)<\/Material>/)?.[2]?.trim() ?? null;
  // Some parts reference a material by "[material:Name]"; unwrap to the name.
  const ref = m?.match(/^\[material:(.+)\]$/);
  return ref ? ref[1] : m;
};

function blocks(text, name) {
  return text.match(new RegExp(`<${name}>[\\s\\S]*?</${name}>`, 'g')) ?? [];
}

/** The internal part files OpenRocket ships, as `{ name, text }`. */
function internalFiles() {
  const dir = arg('internal') ?? process.env.OPENROCKET_INTERNAL_PRESETS;
  if (dir) {
    return readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.orc'))
      .map((f) => ({ name: f, text: readFileSync(join(dir, f), 'utf8') }));
  }
  const jar = arg('jar') ?? process.env.OPENROCKET_JAR ?? installedJar();
  if (!jar) {
    console.error('No OpenRocket jar for the internal part files. Pass --jar <OpenRocket.jar> or --internal <dir>.');
    process.exit(2);
  }
  const PREFIX = 'datafiles/components/internal/';
  const entries = unzipSync(readFileSync(jar), {
    filter: (f) => f.name.startsWith(PREFIX) && f.name.toLowerCase().endsWith('.orc'),
  });
  return Object.entries(entries).map(([name, bytes]) => ({
    name: name.slice(PREFIX.length),
    text: new TextDecoder().decode(bytes),
  }));
}

// The database first, then the internal files, the order desktop loads them.
const sources = [
  ...readdirSync(SRC)
    .filter((f) => f.toLowerCase().endsWith('.orc'))
    .map((f) => ({ name: f, text: readFileSync(join(SRC, f), 'utf8') })),
  ...internalFiles(),
];

// Pass 1: material name → bulk density (kg/m^3), per file and across all files.
// A part looks its material up in its own file first: the legacy files define
// materials under names the database also uses, at other densities. A name its
// file does not define is looked up across all files (parts often reference
// materials defined in generic_materials.orc).
const materialDensity = new Map();
const fileMaterials = new Map();
for (const { name: file, text } of sources) {
  const own = new Map();
  fileMaterials.set(file, own);
  const section = text.match(/<Materials>([\s\S]*?)<\/Materials>/);
  if (!section) continue;
  for (const b of section[1].match(/<Material\b[^>]*>[\s\S]*?<\/Material>/g) ?? []) {
    const name = b.match(/<Name>([^<]*)<\/Name>/)?.[1]?.trim();
    const density = Number(b.match(/<Density>([^<]*)<\/Density>/)?.[1]);
    if (!name || !Number.isFinite(density)) continue;
    own.set(name, density);
    if (!materialDensity.has(name)) materialDensity.set(name, density);
  }
}

// Pass 2: parts.
const components = [];
const seen = new Set();
// Only a row identical in every field is dropped: desktop keeps two parts that
// share a part number but differ in size, and tells them apart by digest.
const push = (p) => {
  const k = JSON.stringify(p);
  if (seen.has(k)) return;
  seen.add(k);
  components.push(p);
};
const common = (b) => ({
  mfr: str(b, 'Manufacturer') || '?',
  partNo: str(b, 'PartNumber') || '',
  desc: str(b, 'Description') || '',
});
let currentFile = '';
const withMaterial = (b) => {
  const material = materialRef(b);
  const density = material
    ? (fileMaterials.get(currentFile)?.get(material) ?? materialDensity.get(material))
    : undefined;
  return { material: material || undefined, materialDensity: density ?? 0 };
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

  for (const b of blocks(text, 'Parachute')) {
    const diameter = lenM(b, 'Diameter');
    if (!diameter) continue;
    push({ type: 'parachute', ...common(b), diameter, cd: num(b, 'DragCoefficient') });
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
  // reads them. A stated wall is kept; most rows state Filled instead.
  for (const b of blocks(text, 'Transition')) {
    const foreOuterDiameter = lenM(b, 'ForeOutsideDiameter');
    const aftOuterDiameter = lenM(b, 'AftOutsideDiameter');
    const length = lenM(b, 'Length');
    if (!foreOuterDiameter || !aftOuterDiameter || !length) continue;
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
// Reuse the previous `generated` stamp when the parts themselves are unchanged.
// Nothing reads the stamp, but rewriting it changes the file, which flips its
// manifest hash (lib/dataManifest.mjs hashes the whole document), re-busting
// every client's cached copy of a megabyte-scale catalog that did not change,
// and making a no-op refresh show up as a repo diff.
let generated = new Date().toISOString();
if (components.length === 0) {
  // Same floor as sync-motors: this runs on a schedule with write access to
  // the branch the live app reads, and an empty source tree (a bad --src, a
  // renamed upstream directory) must not publish an empty picker.
  console.error(`Refusing to write components.generated.json: no components parsed from ${SRC}`);
  process.exit(1);
}
if (existsSync(OUT)) {
  try {
    const prev = JSON.parse(readFileSync(OUT, 'utf8'));
    // sync-preset-digests runs next and adds fields this script cannot know, so
    // the catalog it finishes, not this one, is what gets compared with the
    // previous one. It reads the previous stamp and parts from here.
    writeFileSync(PREVIOUS_CATALOG, JSON.stringify({ generated: prev.generated, components: prev.components }));
    if (JSON.stringify(prev.components) === JSON.stringify(components)) generated = prev.generated;
    else if (Array.isArray(prev.components) && components.length < 0.9 * prev.components.length) {
      console.error(
        `Refusing to write components.generated.json: catalog shrank from ${prev.components.length} to ${components.length}`,
      );
      process.exit(1);
    }
  } catch {
    // Unreadable/corrupt previous catalog: fall through and stamp it now.
  }
}
writeFileSync(OUT, JSON.stringify({ generated, count: components.length, components }) + '\n');
writeDataManifest(DATA_DIR); // refresh the cache-bust hashes
console.log(`Wrote ${components.length} components → public/data/components.generated.json`, byType);
