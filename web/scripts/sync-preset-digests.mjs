// Attach OpenRocket's own part digests to the component catalog.
//
//   npm run sync:preset-digests                     the installed OpenRocket
//   npm run sync:preset-digests -- --jar <path.jar>  a particular release
//   npm run sync:preset-digests -- --or <checkout>   a built source tree
//
// What a digest is for. A `.ork` names a catalog part with
// `<preset type=… manufacturer=… partno=… digest=…/>`, and the digest is how the
// desktop decides whether the part in its library today is still the part the
// file was built with. An element without one is rejected outright ("Invalid
// ComponentPreset for component Body Tube, no digest specified") and the
// component opens unlinked, so a catalog row with no digest is a row whose link
// we deliberately leave out of the file (see ork/exportParts.presetXml).
//
// Why it shells out to Java. The digest is an MD5 over the preset's properties
// as `ComponentPresetFactory` leaves them, not as the `.orc` states them: a
// tube's wall is derived from its two diameters, a material density from a
// stated mass, and an integer property contributes its name and no value. A
// JavaScript reimplementation is a second copy of that logic, and a wrong digest
// is worse than no digest: the desktop then reports the part as changed rather
// than missing. So `scripts/preset-digests/PresetDump.java` runs the real loader
// and asks each preset for its own digest, and this script only merges.
//
// Point it at the OpenRocket people actually run. A part whose `.orc` row states
// a mass has its material replaced by one looked up by density, so its digest
// depends on the material database that build ships. Measured on Estes PNC-50KA:
// the 24.12 release says b3b5899e… and the 26.xx source tree says d1a20a7d…,
// while the parts with no stated mass agree across both. A digest from the wrong
// build is a digest the desktop rejects, so `--jar` (a release, the usual case)
// is preferred over `--or` (a built source checkout, which also needs its test
// classes for the preferences bindings).
//
// Nothing here is part of the app build; this is a data step, run when the
// catalog is refreshed.
//
// Which databases it covers is whatever that build of OpenRocket ships on its
// classpath, because the dumper reads the application's own preset database
// rather than `.orc` files: the file loader and the app disagree for some types
// (Estes PK-12 came out cd19839d… from the files and e38b3873… from the app),
// and the app's value is the one the desktop compares against.
//
// It never regenerates the catalog, only adds `digest` to rows already in it,
// matched on type, maker, part number and description. The maker is compared
// the way `Manufacturer.matches` compares it, under every name the desktop
// knows the maker by ("LOC Precision" in a file is the desktop's "LOC/Precision").
// The part number is compared trimmed, and a matched row takes the desktop's
// spelling, trailing spaces included, because the desktop finds a saved part by
// that exact string. The library holds parts that share a part number and
// description and differ in size (a legacy file and the database both list
// it), and the desktop tells them apart by digest, so the row takes the preset
// whose sizes are its own, and two rows of one size take one preset each. A row
// whose description does not match falls back to type, maker and part number
// when only one part has those. A row that build does not contain has any
// digest removed, and is otherwise left alone.
//
// It also carries a stated mass the way the desktop applies it, with the mass
// read from the same loader. `ComponentPresetFactory` turns the mass of a tube,
// ring, bulkhead, engine block, nose cone or transition into its material's
// density (the mass spread over the part's volume), so the part weighs what the
// catalog says. The volume is measured in the app's own engine
// (lib/presetVolume.mjs), not taken from the desktop's density, because builds
// disagree on it; the result replaces the row's `materialDensity`, and the mass
// stays on the row as `mass`. `Parachute.loadPreset` instead takes the mass as
// a mass override, which the app applies from `mass`. A streamer's mass is not
// applied by the desktop and is not carried.
//
// A parachute row also takes what `Parachute.loadFromPreset` applies besides
// its canopy: the line count and length, the packed length and diameter, and
// the canopy and line materials as the desktop resolved them, so a part with
// no stated mass weighs what the desktop gives it.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PREVIOUS_CATALOG } from './lib/catalogStamp.mjs';
import { writeDataManifest } from './lib/dataManifest.mjs';
import { partProblems } from './lib/digestCoverage.mjs';
import { chooseBuild, runDumper } from './lib/openrocketJava.mjs';
import { presetVolumes } from './lib/presetVolume.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CATALOG = resolve(HERE, '../public/data/components.generated.json');
const JAVA_SRC = resolve(HERE, 'preset-digests/PresetDump.java');

/** Catalog types whose stated mass the desktop turns into a material density. */
const DENSITY_FROM_MASS = new Set([
  'bodytube',
  'launchlug',
  'tubecoupler',
  'centeringring',
  'engineblock',
  'bulkhead',
  'nosecone',
  'transition',
]);

/** `ComponentPreset.Type` as the catalog spells it: `NOSE_CONE` → `nosecone`. */
const appType = (kernelType) => kernelType.toLowerCase().replace(/_/g, '');

/**
 * A maker's name as `Manufacturer.matches` compares it: lower case, every run
 * of other characters one space. "LOC Precision" and "LOC/Precision" are one.
 */
const makerKey = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const descKey = (desc) => desc.replace(/\s+/g, ' ').trim();

/** `Key=value;Key=value` as the dumper writes geometry and parachute fields. */
function pairs(field) {
  const out = {};
  for (const pair of field ? field.split(';') : []) {
    const at = pair.indexOf('=');
    if (at > 0) out[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return out;
}

const positive = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
/** A material's density, which the library can state as zero (a weightless line). */
const density = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);

/** The row field each preset size is stated in, per catalog type. */
const SIZE_FIELDS = {
  OuterDiameter: ['outerDiameter'],
  InnerDiameter: ['innerDiameter'],
  Length: ['length', 'stripLength'],
  Diameter: ['diameter'],
  ForeOuterDiameter: ['foreOuterDiameter'],
  AftOuterDiameter: ['aftOuterDiameter'],
  Width: ['stripWidth'],
  Height: ['height'],
};

/**
 * How far a row's sizes are from a preset's: the sum of relative differences
 * over every size both state. Zero is the same part.
 */
function sizeGap(row, geometry) {
  let gap = 0;
  for (const [key, value] of Object.entries(geometry)) {
    const field = SIZE_FIELDS[key]?.find((f) => typeof row[f] === 'number');
    if (!field) continue;
    const a = row[field];
    const b = Number(value);
    gap += Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
  }
  return gap;
}

/** The catalog fields {@link parachuteFields} writes on a parachute row. */
const PARACHUTE_FIELDS = [
  'lineCount',
  'lineLength',
  'packedLength',
  'packedDiameter',
  'material',
  'materialDensity',
  'lineMaterial',
  'lineMaterialDensity',
];

/**
 * What `Parachute.loadFromPreset` applies, as catalog fields: the line count
 * and length, the packed length and diameter where the preset states them, and
 * the canopy and line materials where the desktop takes them from the preset
 * (a part without one gets the default material).
 */
function parachuteFields(field) {
  const f = pairs(field);
  const out = {};
  const lineCount = positive(f.LineCount);
  const lineLength = positive(f.LineLength);
  if (lineCount != null) out.lineCount = lineCount;
  if (lineLength != null) out.lineLength = lineLength;
  const packedLength = positive(f.PackedLength);
  const packedDiameter = positive(f.PackedDiameter);
  if (packedLength != null) out.packedLength = packedLength;
  if (packedDiameter != null) out.packedDiameter = packedDiameter;
  if (f.Material && density(f.MaterialDensity) != null) {
    out.material = f.Material;
    out.materialDensity = Number(f.MaterialDensity);
  }
  if (f.LineMaterial && density(f.LineMaterialDensity) != null) {
    out.lineMaterial = f.LineMaterial;
    out.lineMaterialDensity = Number(f.LineMaterialDensity);
  }
  return out;
}

/**
 * Every preset that build holds, and a function that finds the one a catalog
 * row is.
 *
 * A row is found among the presets of its type whose maker goes by the row's
 * maker name and whose part number is the row's. The catalog's part numbers are
 * trimmed and the desktop's are not, so they are compared trimmed; the row then
 * takes the desktop's spelling, because `ComponentPresetDatabase.find` looks a
 * saved part up by that exact string. Of those, the ones whose description
 * matches are the candidates; when none matches, a single preset with that
 * maker and part number still is. Among several candidates the row takes the
 * one whose sizes are its own, and a preset already taken by an earlier row
 * only when no other is as close: two parts that share a part number and
 * description and differ in size each get their own digest.
 */
function dump(cp) {
  const byPart = new Map();
  for (const [type, names, partNo, digest, mass, geometry, chute, desc = ''] of runDumper({
    cp,
    javaSrc: JAVA_SRC,
    className: 'PresetDump',
  })) {
    const preset = {
      partNo,
      digest,
      mass: positive(mass),
      desc: descKey(desc),
      geometry: pairs(geometry),
      chute: chute ? parachuteFields(chute) : null,
    };
    for (const maker of new Set(names.split('|').map(makerKey))) {
      const key = JSON.stringify([appType(type), maker, partNo.trim()]);
      if (!byPart.has(key)) byPart.set(key, []);
      byPart.get(key).push(preset);
    }
  }
  const taken = new Set();
  return (row) => {
    const all = byPart.get(JSON.stringify([row.type, makerKey(row.mfr), row.partNo.trim()])) ?? [];
    const described = all.filter((p) => p.desc === descKey(row.desc));
    const candidates = described.length ? described : all.length === 1 ? all : [];
    let best;
    let bestGap = Infinity;
    for (const p of candidates) {
      const gap = sizeGap(row, p.geometry);
      // Closer in size wins; at the same size, a preset no row has taken yet.
      const tie = Math.abs(gap - bestGap) < 1e-9;
      if ((!tie && gap < bestGap) || (tie && taken.has(best) && !taken.has(p))) [best, bestGap] = [p, gap];
    }
    if (best) taken.add(best);
    return best;
  };
}

async function main() {
  const { cp, label } = chooseBuild();
  console.log(`reading presets from ${label}`);
  console.log('dumping presets:');
  const presetFor = dump(cp);
  const volumeOf = await presetVolumes();

  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
  // sync-components has just rewritten the catalog without digests, so the
  // count to hold to is the previous catalog's, which it left in
  // PREVIOUS_CATALOG; run on its own, this step compares against the catalog as
  // it finds it.
  const previous = existsSync(PREVIOUS_CATALOG) ? JSON.parse(readFileSync(PREVIOUS_CATALOG, 'utf8')) : null;
  const before = Math.max(
    catalog.components.filter((c) => c.digest).length,
    (previous?.components ?? []).filter((c) => c.digest).length,
  );
  let hit = 0;
  let massed = 0;
  for (const row of catalog.components) {
    const p = presetFor(row);
    if (p?.digest) {
      row.digest = p.digest;
      row.partNo = p.partNo;
      hit++;
    } else {
      delete row.digest;
    }
    if (row.type === 'parachute') {
      for (const k of PARACHUTE_FIELDS) delete row[k];
      Object.assign(row, p?.chute ?? {});
    }
    // A rail button's mass is the button, screw and nut, which sync-components
    // reads from the part file itself; every other stated mass is set here.
    if (row.type !== 'railbutton') delete row.mass;
    const volume = p?.mass && DENSITY_FROM_MASS.has(row.type) ? volumeOf(row) : null;
    if (p?.mass && volume) {
      row.materialDensity = p.mass / volume;
      row.mass = p.mass;
      massed++;
    } else if (p?.mass && row.type === 'parachute') {
      row.mass = p.mass;
      massed++;
    }
  }
  // A run that silently loses coverage is a broken classpath, not a smaller
  // database: refuse a drop from the previous catalog, and a catalog under the
  // floor however it got there.
  if (hit < before) {
    throw new Error(`refusing to write: digests fell from ${before} to ${hit}. Nothing written.`);
  }
  const problems = partProblems(catalog.components);
  if (problems.length) throw new Error(`refusing to write: ${problems.join('; ')}. Nothing written.`);
  // Unchanged parts keep the previous stamp (lib/catalogStamp.mjs).
  if (previous && JSON.stringify(previous.components) === JSON.stringify(catalog.components)) {
    catalog.generated = previous.generated;
  }
  rmSync(PREVIOUS_CATALOG, { force: true });
  // Compact, as sync-components writes it: browsers download this file and keep
  // it for offline use, and indentation would more than double its size.
  writeFileSync(CATALOG, `${JSON.stringify(catalog)}\n`);
  // The catalog changed, so its cache-bust hash has to as well.
  writeDataManifest(dirname(CATALOG));
  console.log(`digests: ${hit} of ${catalog.count} catalog rows (was ${before}); stated masses applied: ${massed}`);
}

await main();
