// Build-time extractor for OpenRocket components (what OpenRocket calls
// "component presets"). Reads OpenRocket's own bundled `.orc` files (XML) — real
// manufacturer parts — and writes an SI-normalized JSON catalog the app bundles
// (like sync-motors.mjs, but from local OpenRocket data instead of the
// thrustcurve API; no network).
//
// Brings in the three types the current editor uses: body tubes, nose cones,
// and parachutes (recovery). Run manually / in CI when refreshing the catalog:
//   node scripts/sync-components.mjs [--src <openrocket presets dir>]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Source: the OpenRocket-Components DB (dbcook/openrocket-database), the
// community-maintained parts database OpenRocket's component data comes from.
// Override with --src / OPENROCKET_PRESETS to point at another `.orc` tree.
const DEFAULT_SRC = 'D:/programming/java/openrocket/openrocket-database/orc';
const argSrc = process.argv.indexOf('--src');
const SRC = argSrc >= 0 ? process.argv[argSrc + 1] : (process.env.OPENROCKET_PRESETS || DEFAULT_SRC);
const OUT = resolve(fileURLToPath(new URL('../src/data', import.meta.url)), 'components.generated.json');

// Unit → SI factors.
const LEN = { in: 0.0254, mm: 0.001, cm: 0.01, m: 1, ft: 0.3048, '': 1 };

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
  // Some parts reference a material by "[material:Name]" — unwrap to the name.
  const ref = m?.match(/^\[material:(.+)\]$/);
  return ref ? ref[1] : m;
};

function blocks(text, name) {
  return text.match(new RegExp(`<${name}>[\\s\\S]*?</${name}>`, 'g')) ?? [];
}

const files = readdirSync(SRC).filter((f) => f.toLowerCase().endsWith('.orc'));

// Pass 1: global material name → bulk density (kg/m^3), across all files
// (parts often reference materials defined in generic_materials.orc).
const materialDensity = new Map();
for (const f of files) {
  const text = readFileSync(join(SRC, f), 'utf8');
  const section = text.match(/<Materials>([\s\S]*?)<\/Materials>/);
  if (!section) continue;
  for (const b of section[1].match(/<Material\b[^>]*>[\s\S]*?<\/Material>/g) ?? []) {
    const name = b.match(/<Name>([^<]*)<\/Name>/)?.[1]?.trim();
    const density = Number(b.match(/<Density>([^<]*)<\/Density>/)?.[1]);
    if (name && Number.isFinite(density)) materialDensity.set(name, density);
  }
}

// Pass 2: parts.
const components = [];
const seen = new Set();
const push = (p) => {
  const k = `${p.type}|${p.mfr}|${p.partNo}|${p.desc}`;
  if (seen.has(k)) return;
  seen.add(k);
  components.push(p);
};
const common = (b) => ({
  mfr: str(b, 'Manufacturer') || '?',
  partNo: str(b, 'PartNumber') || '',
  desc: str(b, 'Description') || '',
});
const withMaterial = (b) => {
  const material = materialRef(b);
  return { material: material || undefined, materialDensity: material ? (materialDensity.get(material) ?? 0) : 0 };
};

for (const f of files) {
  const text = readFileSync(join(SRC, f), 'utf8');

  for (const b of blocks(text, 'BodyTube')) {
    const outerDiameter = lenM(b, 'OutsideDiameter');
    const length = lenM(b, 'Length');
    if (!outerDiameter || !length) continue;
    push({ type: 'bodytube', ...common(b), ...withMaterial(b), outerDiameter, innerDiameter: lenM(b, 'InsideDiameter'), length });
  }

  for (const b of blocks(text, 'NoseCone')) {
    const outerDiameter = lenM(b, 'OutsideDiameter');
    const length = lenM(b, 'Length');
    if (!outerDiameter || !length) continue;
    push({
      type: 'nosecone', ...common(b), ...withMaterial(b),
      shape: (str(b, 'Shape') || 'OGIVE').toLowerCase(),
      filled: str(b, 'Filled') === 'true',
      outerDiameter, length,
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
    push({ type: 'tubecoupler', ...common(b), ...withMaterial(b), outerDiameter, innerDiameter: lenM(b, 'InsideDiameter'), length });
  }

  for (const b of blocks(text, 'CenteringRing')) {
    const outerDiameter = lenM(b, 'OutsideDiameter');
    const length = lenM(b, 'Length');
    if (!outerDiameter || !length) continue;
    push({ type: 'centeringring', ...common(b), ...withMaterial(b), outerDiameter, innerDiameter: lenM(b, 'InsideDiameter'), length });
  }

  for (const b of blocks(text, 'BulkHead')) {
    const outerDiameter = lenM(b, 'OutsideDiameter');
    const length = lenM(b, 'Length');
    if (!outerDiameter || !length) continue;
    push({ type: 'bulkhead', ...common(b), ...withMaterial(b), outerDiameter, length, filled: str(b, 'Filled') === 'true' });
  }
}

const byType = components.reduce((m, p) => ((m[p.type] = (m[p.type] ?? 0) + 1), m), {});
writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), count: components.length, components }) + '\n');
console.log(`Wrote ${components.length} components → src/data/components.generated.json`, byType);
