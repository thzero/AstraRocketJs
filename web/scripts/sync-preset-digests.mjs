// Attach OpenRocket's own part digests to the component catalog.
//
//   npm run sync:preset-digests                     the installed OpenRocket
//   npm run sync:preset-digests -- --jar <path.jar>  a particular release
//   npm run sync:preset-digests -- --or <checkout>   a built source tree, with OPENROCKET_UNPINNED=1
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
// depends on the material database that build ships: a release and a source
// checkout give such a part different digests, while the parts with no stated
// mass agree across both. A digest from the wrong build is a digest the desktop
// rejects, so `--jar` (a release, the usual case) is the one to commit from. `--or` (a built source checkout, which also needs
// its test classes for the preferences bindings) runs only with
// OPENROCKET_UNPINNED=1, and what it writes is not for committing.
//
// Nothing here is part of the app build; this is a data step, run when the
// catalog is refreshed.
//
// Which databases it covers is whatever that build of OpenRocket ships on its
// classpath: the dumper reads the release's own `.orc` files, as the desktop's
// system preset pass does, under the application's module so they are built
// against the materials the desktop boots with. A bare file load disagrees for
// some types, and the application module's value is the one the desktop
// compares against.
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
// when only one part has those. A row whose type, maker and part number that
// build does not hold at all is a part desktop's library does not offer (the
// loader drops some `.orc` rows), and is removed from the catalog. A row the
// build holds but no preset matches keeps no digest.
//
// It reads the catalog sync-components staged (lib/catalogStaging.mjs), or, with
// none staged, the catalog in public/data, and writes the finished catalog to
// public/data.
//
// It also carries a stated mass the way the desktop applies it, with the mass
// read from the same loader. `ComponentPresetFactory` turns the mass of a tube,
// ring, bulkhead, engine block, nose cone, transition or rail button into its
// material's density (the mass spread over the part's volume), so the part
// weighs what the catalog says. A rail button's stated mass is the button's
// own; the mass override it flies with adds its screw and nut, and comes from
// sync-components. The volume is measured in the app's own engine
// (lib/presetVolume.mjs), not taken from the desktop's density, because builds
// disagree on it; the result replaces the row's `materialDensity`, and the mass
// stays on the row as `mass` (lib/statedMass.mjs). A part the engine gives no
// volume refuses the run, unless the desktop gives it none either (the dumper
// reports an infinite density): then the mass applies in neither build, the row
// keeps its material's density and no `mass`, and the run lists it.
// `Parachute.loadPreset` instead takes the mass as a mass override, which the
// app applies from `mass`. A streamer's mass is not applied by the desktop and
// is not carried.
//
// A row from one of the library's legacy files is marked `legacy`
// (`ComponentPreset.LEGACY`, which the dumper reads), so the picker can hide it
// by default as desktop's chooser does.
//
// A parachute row also takes what `Parachute.loadFromPreset` applies besides
// its canopy: the line count and length, the packed length and diameter, and
// the canopy and line materials as the desktop resolved them, so a part with
// no stated mass weighs what the desktop gives it, except a canopy desktop
// weighs at 0, which takes the nearest built-in material (lib/nearestMaterial).
import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGED_COMPONENTS, writeFileAtomic } from './lib/catalogStaging.mjs';
import { writeDataManifest } from './lib/dataManifest.mjs';
import { digestChanges, goneSection, partProblems } from './lib/digestCoverage.mjs';
import { builtInMaterials } from './lib/builtInMaterials.mjs';
import { chooseBuild, runDumper } from './lib/openrocketJava.mjs';
import { presetVolumes } from './lib/presetVolume.mjs';
import { statedMassTally } from './lib/statedMass.mjs';
import { nearestMaterial } from './lib/nearestMaterial.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CATALOG = resolve(HERE, '../public/data/components.generated.json');
const JAVA_SRC = resolve(HERE, 'preset-digests/PresetDump.java');

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
 * (a part without one gets the default material). A canopy desktop weighs at 0
 * takes the nearest built-in material (lib/nearestMaterial), looked up with
 * `builtIn(type, name)` (lib/builtInMaterials).
 */
function parachuteFields(field, builtIn) {
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
    // A canopy desktop could not weigh takes the nearest built-in material.
    const nearest = Number(f.MaterialDensity) > 0 ? undefined : nearestMaterial('SURFACE', f.Material, builtIn);
    out.material = nearest?.material ?? f.Material;
    out.materialDensity = nearest?.materialDensity ?? Number(f.MaterialDensity);
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
  const builtIn = builtInMaterials(cp);
  const byPart = new Map();
  for (const [type, names, partNo, digest, mass, geometry, chute, legacy, massDensity, desc = ''] of runDumper({
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
      chute: chute ? parachuteFields(chute, builtIn) : null,
      legacy: legacy === 'true',
      // Whether that build gives a part stating a mass a volume to spread it over.
      massHasVolume: massDensity === '' || Number.isFinite(Number(massDensity)),
    };
    for (const maker of new Set(names.split('|').map(makerKey))) {
      const key = JSON.stringify([appType(type), maker, partNo.trim()]);
      if (!byPart.has(key)) byPart.set(key, []);
      byPart.get(key).push(preset);
    }
  }
  const taken = new Set();
  const keyOf = (row) => JSON.stringify([row.type, makerKey(row.mfr), row.partNo.trim()]);
  /** Whether the build holds any part of the row's type, maker and part number. */
  const holds = (row) => byPart.has(keyOf(row));
  const presetFor = (row) => {
    const all = byPart.get(keyOf(row)) ?? [];
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
  return { holds, presetFor };
}

/** A part's row key and whether it carries a digest, for `digestChanges`. */
const digestState = (row) => ({ key: `${row.type}|${row.mfr}|${row.partNo.trim()}`, digested: Boolean(row.digest) });

async function main() {
  const { cp, label } = chooseBuild();
  console.log(`reading presets from ${label}`);
  console.log('dumping presets:');
  const { holds, presetFor } = dump(cp);
  const volumeOf = await presetVolumes();

  // The finished catalog now in public/data is the one this run is held to, and
  // whose stamp it keeps when the parts come out the same.
  const previous = existsSync(CATALOG) ? JSON.parse(readFileSync(CATALOG, 'utf8')) : null;
  const staged = existsSync(STAGED_COMPONENTS);
  const catalog = staged ? JSON.parse(readFileSync(STAGED_COMPONENTS, 'utf8')) : structuredClone(previous);
  if (!catalog) throw new Error(`nothing to add digests to: no ${STAGED_COMPONENTS} and no ${CATALOG}`);
  console.log(`catalog: ${staged ? `staged by sync-components (${catalog.generated})` : CATALOG}`);
  const baseline = (previous?.components ?? catalog.components).map(digestState);
  const before = baseline.filter((c) => c.digested).length;

  const absent = catalog.components.filter((row) => !holds(row));
  if (absent.length) {
    console.log(
      `not in this build's library, removed: ${absent.map((r) => `${r.type} ${r.mfr} ${r.partNo}`).join(', ')}`,
    );
    catalog.components = catalog.components.filter((row) => holds(row));
    catalog.count = catalog.components.length;
  }
  let hit = 0;
  // A stated mass with no volume to spread it over refuses the run (statedMassTally).
  const masses = statedMassTally();
  for (const row of catalog.components) {
    const p = presetFor(row);
    if (p?.digest) {
      row.digest = p.digest;
      row.partNo = p.partNo;
      hit++;
    } else {
      delete row.digest;
    }
    if (p?.legacy) row.legacy = true;
    else delete row.legacy;
    if (row.type === 'parachute') {
      for (const k of PARACHUTE_FIELDS) delete row[k];
      Object.assign(row, p?.chute ?? {});
    }
    masses.apply(row, p?.mass, volumeOf, p?.massHasVolume ?? true);
  }
  const refusal = masses.refusal();
  if (refusal) throw new Error(refusal);
  if (masses.degenerate.length) {
    console.log(`stated masses the desktop gives no volume either, not applied: ${masses.degenerate.join(', ')}`);
  }
  // A part that kept its row and lost its digest is a broken classpath or a
  // changed matcher: refuse it, and a catalog under the floor however it got
  // there. A part the database dropped took its digest with it, which is
  // reported and not refused.
  const { lost, gone } = digestChanges(baseline, catalog.components.map(digestState));
  const goneText = goneSection('Parts', gone);
  if (goneText) {
    console.log(goneText);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${goneText}\n`);
  }
  if (lost.length) {
    throw new Error(
      `refusing to write: ${lost.length} parts still in the catalog lost their digests (${lost.join(', ')}). Nothing written.`,
    );
  }
  const problems = partProblems(catalog.components);
  if (problems.length) throw new Error(`refusing to write: ${problems.join('; ')}. Nothing written.`);
  // Unchanged parts keep the previous `generated` stamp. Nothing reads it, but
  // the manifest hashes the whole file (lib/dataManifest.mjs), so a new stamp on
  // the same parts would make every browser download the catalog again.
  if (previous && JSON.stringify(previous.components) === JSON.stringify(catalog.components)) {
    catalog.generated = previous.generated;
  }
  // Compact, as sync-components writes it: browsers download this file and keep
  // it for offline use, and indentation would more than double its size.
  writeFileAtomic(CATALOG, `${JSON.stringify(catalog)}\n`);
  // The catalog changed, so its cache-bust hash has to as well.
  writeDataManifest(dirname(CATALOG));
  rmSync(STAGED_COMPONENTS, { force: true });
  console.log(
    `digests: ${hit} of ${catalog.count} catalog rows (was ${before}); stated masses applied: ${masses.massed}`,
  );
}

await main();
