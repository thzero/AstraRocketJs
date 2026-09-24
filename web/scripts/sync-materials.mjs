// Build-time generator for the material catalog.
//
// Writes public/data/materials.generated.json — the runtime catalog the editor
// offers, fetched at run time like motors and components (see
// src/services/remoteData.ts) rather than compiled into the JS bundle.
//
//   node scripts/sync-materials.mjs
//   node scripts/sync-materials.mjs --src <openrocket checkout>
//
// With no --src it uses the upstream checkout the engine extraction already
// keeps at the pinned ref (engine-java/.openrocket-src, gitignored). Run
// `npm --prefix ../engine-java run extract:check` once to populate it.
//
// It has TWO inputs, and only one of them is a file a person edits:
//
//   upstream   every material desktop OpenRocket ships, read straight out of
//              its `database/Databases.java`. Never typed by hand.
//   app        scripts/data/materials.app.json, hand-maintained: the adhesives
//              (upstream has none at all, and a fin fillet is made of nothing
//              else) and corrections to upstream values that are wrong. Each
//              entry carries the document its density came from.
//
// Each output row keeps a `kind` saying which input it came from, so
// `engine-java/extract/extract.mjs --check` can hold the upstream rows to
// upstream and leave ours alone. The maintainer-facing fields (`source`,
// `note`, `corrects`) stay in the hand-maintained file and are NOT shipped:
// they are for whoever edits that file, and the browser has no use for them.
//
// WHY THIS EXISTS. The list used to be typed by hand into a .ts file, and it
// had drifted: 20 of upstream's 42 line materials, missing every Kevlar
// 12-strand above 5/16 in, all five nylon flat webbings, both rubber bands,
// all seven braided elastics and the Paraline. Nothing showed it, because a
// missing material is just one the picker does not offer. Hand-copying a
// table of 82 numbers out of someone else's source is not a thing to do twice.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { writeDataManifest } from './lib/dataManifest.mjs';

const DATA_DIR = fileURLToPath(new URL('../public/data', import.meta.url));
const OUT = join(DATA_DIR, 'materials.generated.json');
const APP_JSON = fileURLToPath(new URL('./data/materials.app.json', import.meta.url));
const ENGINE = fileURLToPath(new URL('../../engine-java/', import.meta.url));
const REL_JAVA = join('core', 'src', 'main', 'java', 'info', 'openrocket', 'core', 'database', 'Databases.java');

const die = (msg) => {
  console.error(`sync-materials: ${msg}`);
  process.exit(1);
};

const argSrc = process.argv.indexOf('--src');
const src = argSrc >= 0 ? process.argv[argSrc + 1] : join(ENGINE, '.openrocket-src');
const javaPath = [join(src, REL_JAVA), join(src, 'info', 'openrocket', 'core', 'database', 'Databases.java')].find(
  existsSync,
);
if (!javaPath) {
  die(
    `could not find Databases.java under ${src}\n` +
      '  Pass --src <openrocket checkout>, or populate the engine extraction cache with\n' +
      '  `npm --prefix ../engine-java run extract:check`.',
  );
}

// A quoted Java literal, with \" allowed inside it: upstream has
// Styrofoam \"Blue foam\" (XPS), and a naive [^"]* silently drops that row.
const MATERIAL =
  /newMaterial\(Type\.(BULK|SURFACE|LINE),\s*"((?:[^"\\]|\\.)*)",\s*([0-9.eE+-]+)[^)]*?MaterialGroup\.(\w+)/g;
// Java escapes non-ASCII in a literal ("Cr\u00eape paper"); JSON carries the
// character itself.
const unescapeJava = (t) =>
  t.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\(["'\\])/g, '$1');
// Upstream's MaterialGroup enum is upper case; the app renders the group as
// a heading, so it is title-cased here rather than at every call site.
const group = (g) => g.charAt(0) + g.slice(1).toLowerCase().replace(/_/g, ' ');

const java = readFileSync(javaPath, 'utf8');
const rows = [];
for (const m of java.matchAll(MATERIAL)) {
  rows.push({
    name: unescapeJava(m[2]),
    type: m[1].toLowerCase(),
    density: Number(m[3]),
    group: group(m[4]),
    kind: 'upstream',
  });
}

// Every call has to have been read. A regex that quietly skips a row would
// produce a short list that looks complete, which is the exact failure this
// script was written to end.
const calls = java.split('newMaterial(Type.').length - 1;
if (rows.length !== calls) die(`parsed ${rows.length} materials but the file makes ${calls} newMaterial calls`);
if (!rows.length) die(`no materials found in ${javaPath}`);
const upstreamCount = rows.length;

let app;
try {
  app = JSON.parse(readFileSync(APP_JSON, 'utf8')).materials;
} catch (e) {
  die(`cannot read ${APP_JSON}: ${e.message}`);
}
if (!Array.isArray(app)) die(`${APP_JSON} has no "materials" array`);

const key = (r) => `${r.type}\u0000${r.name}`;
const seen = new Set(rows.map(key));
for (const r of app) {
  for (const f of ['name', 'type', 'density', 'group', 'kind']) {
    if (r[f] === undefined) die(`app material ${JSON.stringify(r.name ?? r)} has no "${f}"`);
  }
  // A density with no document behind it is a guess that weighs someone's
  // rocket, and the file's own header says so. Refusing here is what keeps
  // that from being advice.
  if (!r.source) die(`app material ${JSON.stringify(r.name)} has no "source"`);
  if (!(r.density > 0)) die(`app material ${JSON.stringify(r.name)} has a non-positive density`);
  // A name upstream already uses would SHADOW it in the picker, silently
  // re-weighing every design that names it. A correction gets its own name
  // (`Elastic cord, corrected (...)`) precisely so both can be read back.
  if (seen.has(key(r))) die(`app material ${JSON.stringify(r.name)} (${r.type}) collides with an upstream material`);
  seen.add(key(r));
  rows.push({ name: r.name, type: r.type, density: r.density, group: r.group, kind: r.kind });
}

const byType = (t) => rows.filter((r) => r.type === t).length;
writeFileSync(OUT, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
const manifest = writeDataManifest(DATA_DIR);
console.log(
  `sync-materials: wrote ${rows.length} materials (${byType('bulk')} bulk, ${byType('surface')} surface, ` +
    `${byType('line')} line) to public/data/materials.generated.json`,
);
console.log(`sync-materials:   ${upstreamCount} from ${javaPath}`);
console.log(`sync-materials:   ${rows.length - upstreamCount} from ${APP_JSON}`);
console.log(`sync-materials:   manifest hash ${manifest.materials}`);
