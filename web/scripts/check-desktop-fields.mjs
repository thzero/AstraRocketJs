// Open the files the app saves in a real OpenRocket and require every part to
// come back holding what the app's kernel flies.
//
//   npm run check:fields -- <samples dir>
//   npm run check:fields -- --jar <OpenRocket.jar> <samples dir>
//
// The samples come from tests/services/files/orkDesktopSamples.test.ts with
// ORK_SAMPLES_DIR set: each `.ork` and `.rkt` there has a `<file>.kernel.json`
// beside it, listing every part as the app's kernel built it. This opens each
// file in the pinned desktop release, reads every part back through the same
// getters (engine-java/src/api/java/api/ComponentFields.java, compiled against
// that release), and compares the two part by part in tree order, depth
// included. The getters cover the panel's fields plus what a file also
// carries: overrides, materials, the finish and a fin's planform area.
//
// `check:ork` asks whether desktop accepts a file. This asks whether desktop
// reads the same rocket from it: a writer that emits a default the kernel does
// not fly, drops a field, or writes a stale automatic value fails here and
// nowhere else.
//
// A RockSim file restates some values (angles in degrees, a pod by its distance
// from the axis, a fin tab from the root's front, a packed part by either end);
// those are compared in the form desktop reads them. KNOWN lists the rest of the
// accepted differences, each with the finding it is or what RockSim cannot carry,
// and each matches only the difference it names. The list is checked both ways:
// a new difference fails, and so does an entry that no longer occurs.
//
// `npm run audit` runs it after the `desktop` step. Needs a JDK and the pinned
// OpenRocket release, as `check:ork` does.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chooseBuild } from './lib/openrocketJava.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SOURCES = [
  resolve(HERE, 'ork-check/OrkFields.java'),
  resolve(HERE, '../../engine-java/src/api/java/api/ComponentFields.java'),
];

/**
 * Accepted differences. `rule` is `format:type.key`, with `*` for any type.
 * `when` gets the app's value, desktop's, and both parts' fields, and says
 * whether this difference is the one the entry names; one that is not fails.
 */
const KNOWN = [
  // Open findings in docs/AUDIT.md.
  {
    rule: 'ork:launchlug.instanceSeparation',
    why: 'C2: the kernel flies the constructor separation; the writer states 0',
    when: (a, d) => a > 0 && d === 0,
  },
  { rule: 'ork:railbutton.instanceSeparation', why: 'C2', when: (a, d) => a > 0 && d === 0 },
  {
    rule: 'rkt:*.cgOverridden',
    why: 'C42: a mass-only override is written with the known CG switch on and a CG of 0',
    when: (a, d, af) => a === false && d === true && af.massOverridden === true,
  },
  {
    rule: 'rkt:*.overrideCGX',
    why: 'C42',
    when: (a, d, af, df) => af.massOverridden === true && !af.cgOverridden && df.cgOverridden && d === 0,
  },
  {
    rule: 'ork:nosecone.shoulderThickness',
    why: 'C33: the kernel gives a new shoulder the part wall; the file states 0',
    when: (a, d) => a > 0 && d === 0,
  },
  { rule: 'ork:transition.foreShoulderThickness', why: 'C33', when: (a, d) => a > 0 && d === 0 },
  { rule: 'ork:transition.aftShoulderThickness', why: 'C33', when: (a, d) => a > 0 && d === 0 },
  {
    rule: 'ork:parachute.lineLength',
    why: 'C36: `auto` line length, which desktop 24.12 does not read',
    when: (a, d) => d === 0.3,
  },
  {
    rule: 'ork:shockcord.cordLength',
    why: 'C36: `auto` cord length, which desktop 24.12 does not read',
    when: (a, d) => a !== d,
  },
  {
    rule: 'rkt:shockcord.cordLength',
    why: 'C8: an automatic cord length is written as the stale stored number',
    when: (a, d, af) => a !== d && af.cordLength === a,
  },
  {
    rule: 'rkt:launchlug.outerRadius',
    why: 'C37: OD is written before ID, and desktop rebuilds the outer radius from the bore plus its 1 mm wall',
    when: (a, d) => d > a,
  },
  {
    rule: 'rkt:*.instanceCount',
    why: "C38: RockSim states no repeat count (desktop's own export drops it too), and the writer does not say so",
    when: (a, d) => a > 1 && d === 1,
  },
  {
    rule: 'rkt:bodytube.outerRadius',
    why: 'C44: two automatic ends that follow each other keep their stored radius in the app, which the writer emits',
    when: (a, d) => d < a,
  },
  // What RockSim cannot carry, or desktop's RockSim reader does not read.
  {
    rule: 'rkt:*.massOverridden',
    why: 'RockSim has no airfoil section, so an airfoil fin set goes out as its kernel mass and CG (CalcMass, CalcCG)',
    when: (a, d, af) => af.crossSection === 'airfoil' && d === true,
  },
  {
    rule: 'rkt:*.cgOverridden',
    why: 'an airfoil fin set goes out as its kernel mass and CG',
    when: (a, d, af) => af.crossSection === 'airfoil' && d === true,
  },
  {
    rule: 'rkt:masscomponent.massOverridden',
    why: "RockSim overrides mass and CG together, so a CG-only override goes out with the part's own mass, as desktop's own export writes it",
    when: (a, d, af) => af.cgOverridden === true && !af.massOverridden && d === true,
  },
  {
    rule: 'rkt:masscomponent.overrideCGX',
    why: "MassObjectHandler puts a mass object's CG at its front: a RockSim mass object is a point",
    when: (a, d) => d === 0,
  },
  {
    rule: 'rkt:*.finish',
    why: "RockSim's finish codes have no rough; it goes out as matt, which desktop reads as normal",
    when: (a, d) => a === 'rough' && d === 'normal',
  },
  {
    rule: 'rkt:launchlug.thickness',
    why: 'no element sets a lug wall; LaunchLugHandler keeps the 1 mm default',
    when: (a, d) => d === 0.001,
  },
  {
    rule: 'rkt:masscomponent.massComponentType',
    why: 'RockSim has no mass component type',
    when: (a, d) => d === 'masscomponent',
  },
  { rule: 'rkt:masscomponent.radius', why: 'MassObjectHandler does not read Dia', when: (a, d) => d === 0.0125 },
  { rule: 'rkt:nosecone.shoulderCapped', why: 'RockSim has no capped shoulder', when: (a, d) => d === false },
  {
    rule: 'rkt:*.deployEvent',
    why: "deployment is only in RockSim's simulation events, which desktop does not import",
    when: (a, d) => d === 'ejection',
  },
  {
    rule: 'rkt:*.deployAltitude',
    why: "deployment is only in RockSim's simulation events, which desktop does not import",
    when: (a, d) => d === 200,
  },
  {
    rule: 'rkt:stage.separationEvent',
    why: "separation is only in RockSim's simulation results, which desktop does not import",
    when: (a, d) => d === 'ejection',
  },
  { rule: 'rkt:*.cant', why: 'the 24.12 FinSetHandler does not read CantAngle', when: (a, d) => d === 0 },
  {
    rule: 'rkt:streamer.length',
    why: 'StreamerHandler reads no packed size; desktop keeps its default',
    when: (a, d) => d === 0.025,
  },
  {
    rule: 'rkt:streamer.radius',
    why: 'StreamerHandler reads no packed size; desktop keeps its default',
    when: (a, d) => d === 0.0125,
  },
  // What desktop's RockSim reader works out for itself.
  {
    rule: 'rkt:nosecone.shoulderThickness',
    why: 'NoseConeHandler takes the wall, or the shoulder radius when solid',
    when: (a, d, af, df) => d === df.thickness || d === df.shoulderRadius,
  },
  {
    rule: 'rkt:transition.foreShoulderThickness',
    why: 'TransitionHandler takes the wall, or the shoulder radius when solid',
    when: (a, d, af, df) => d === df.thickness || d === df.foreShoulderRadius,
  },
  {
    rule: 'rkt:parachute.length',
    why: 'ParachuteHandler sizes the pack from the airframe it sits in',
    when: (a, d, af, df) => d === df.radius,
  },
  {
    rule: 'rkt:parachute.radius',
    why: 'ParachuteHandler sizes the pack from the airframe it sits in',
    when: (a, d, af, df) => d === df.length,
  },
  {
    rule: 'rkt:shockcord.length',
    why: 'MassObjectHandler packs a cord at its length / 100',
    when: (a, d, af, df) => Math.abs(d - df.cordLength / 100) < 1e-9,
  },
  {
    rule: 'rkt:shockcord.radius',
    why: "MassObjectHandler sets a cord's radius to the parent's bore",
    when: (a, d) => d > 0,
  },
];

/** Relative tolerance, by format: a `.rkt` carries millimeters and grams to a few places. */
const TOLERANCE = { ork: 1e-6, rkt: 1e-3 };

const dir = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
if (!dir || !existsSync(dir)) {
  console.error('usage: npm run check:fields -- <samples dir>');
  process.exit(2);
}
const files = readdirSync(dir)
  .filter((f) => /\.(ork|rkt)$/.test(f) && existsSync(join(dir, `${f}.kernel.json`)))
  .map((f) => join(dir, f));
if (!files.length) {
  console.error(`no saved files with a .kernel.json beside them in ${dir}`);
  process.exit(2);
}

const { cp, label } = chooseBuild();
console.log(`reading ${files.length} files back in ${label}`);
const work = mkdtempSync(join(tmpdir(), 'or-fields-'));
let desktop;
try {
  execFileSync('javac', ['-cp', cp, '-d', work, ...SOURCES], { stdio: 'inherit' });
  const out = join(work, 'fields.json');
  execFileSync('java', ['-cp', `${cp}${delimiter}${work}`, 'OrkFields', out, ...files], { stdio: 'inherit' });
  desktop = JSON.parse(readFileSync(out, 'utf8'));
} finally {
  rmSync(work, { recursive: true, force: true });
}

const ANGLES = new Set(['angleOffset', 'rotation', 'cant', 'radialDirection', 'clusterRotation']);
const norm = (v) => (typeof v === 'string' ? v.toLowerCase().replace(/_/g, '') : v);
const turn = 2 * Math.PI;
const angleGap = (a, b) => Math.abs(((((a - b) % turn) + 1.5 * turn) % turn) - turn / 2);

function same(key, a, b, tol) {
  if (typeof a === 'number' && typeof b === 'number') {
    const d = ANGLES.has(key) ? angleGap(a, b) : Math.abs(a - b);
    return d <= 1e-9 + tol * Math.max(Math.abs(a), Math.abs(b));
  }
  return norm(a) === norm(b);
}

/** A desktop class for an app node type: the type is the class name lowercased, a stage aside. */
const sameKind = (type, cls) => (type === 'stage' ? cls === 'AxialStage' : cls.toLowerCase() === type);

/** Not compared: the position is compared as `positionX`, the station, however a file states it. */
const SKIP = new Set(['positionMethod', 'positionOffset']);

/**
 * RockSim restates these; the restated form is compared instead (a pod's
 * `instanceRadius`, a tab's `tabOffsetFromFront`).
 */
const RKT_RESTATED = new Set(['radiusOffset', 'radiusMethod', 'tabOffset', 'tabOffsetMethod']);

/** RockSim angles are written in degrees by design; desktop reads the number as radians. */
const asReadRadians = (a) => (a * 180) / Math.PI;
const RKT_ANGLE_SETTERS = {
  // LaunchLug.setAngleOffset clamps; the others reduce to (-pi, pi].
  angleOffset: (a, type) =>
    type === 'launchlug' ? Math.max(-Math.PI, Math.min(Math.PI, asReadRadians(a))) : asReadRadians(a),
  rotation: (a) => asReadRadians(a),
};

/** Placement the writer gives each copy of a split cluster or set; the rest of a copy is compared. */
const COPY_PLACEMENT = new Set([
  'radialPosition',
  'radialDirection',
  'cluster',
  'clusterScale',
  'clusterRotation',
  'instanceCount',
  'instanceRadius',
  'radiusOffset',
  'radiusMethod',
  'angleOffset',
]);

/** A flipped nose cone's keys on the transition the RockSim writer makes of it, base forward. */
const FLIPPED_NOSE_AS_TRANSITION = {
  aftRadius: 'foreRadius',
  shoulderLength: 'foreShoulderLength',
  shoulderRadius: 'foreShoulderRadius',
  shoulderThickness: 'foreShoulderThickness',
  shoulderCapped: 'foreShoulderCapped',
  flipped: null,
};

/** Fields the kernel reads only in some states of a part (as fieldReadback.kernel.test.ts). */
const hasTab = (f) => f.tabHeight > 0 && f.tabLength > 0;
const READ_ONLY_WHEN = {
  tabLength: hasTab,
  tabHeight: hasTab,
  tabOffset: hasTab,
  tabOffsetMethod: hasTab,
  tabOffsetFromFront: hasTab,
  deployAltitude: (f) => f.deployEvent === 'altitude',
  separationAltitude: (f) => String(f.separationEvent).startsWith('altitude'),
  overrideMass: (f) => f.massOverridden === true,
  overrideCGX: (f) => f.cgOverridden === true,
  overrideCD: (f) => f.cdOverridden === true,
};

/**
 * The parts a RockSim file holds for the app's tree. rktExport writes each
 * cluster tube and each pod or booster set member as a part of its own, as
 * desktop's own RockSim export does, writes a flipped nose cone as a transition,
 * puts a tube coupler's parts beside it in its parent, as desktop's
 * TubeCouplerDTO does, and leaves out rail buttons, which RockSim has no
 * element for.
 */
function asRockSim(parts) {
  const out = [];
  for (let i = 0; i < parts.length;) {
    const p = parts[i];
    let end = i + 1;
    while (end < parts.length && parts[end].depth > p.depth) end++;
    if (p.type === 'railbutton') {
      i = end;
    } else if (p.rktCopies > 1) {
      const subtree = asRockSim(parts.slice(i + 1, end));
      for (let c = 0; c < p.rktCopies; c++) out.push({ ...p, copy: true }, ...subtree);
      i = end;
    } else if (p.type === 'tubecoupler') {
      out.push(p, ...asRockSim(parts.slice(i + 1, end)).map((kid) => ({ ...kid, depth: kid.depth - 1 })));
      i = end;
    } else if (p.type === 'nosecone' && p.fields.flipped) {
      const fields = {};
      for (const [k, v] of Object.entries(p.fields)) {
        const to = k in FLIPPED_NOSE_AS_TRANSITION ? FLIPPED_NOSE_AS_TRANSITION[k] : k;
        if (to) fields[to] = v;
      }
      out.push({ ...p, type: 'transition', fields });
      i++;
    } else {
      out.push(p);
      i++;
    }
  }
  return out;
}

/** Whether a RockSim restatement accounts for the difference. */
function rktRestatement(key, k, d) {
  const a = k.fields[key];
  const b = d.fields[key];
  if (key in RKT_ANGLE_SETTERS) return angleGap(RKT_ANGLE_SETTERS[key](a, k.type), b) <= 1e-6;
  // A packed recovery part is placed by whichever end RockSim states, and desktop
  // sizes the pack itself, so the stated end is the one that has to agree.
  if (key === 'positionX' && (k.type === 'parachute' || k.type === 'streamer')) {
    return Math.abs(a + k.fields.length - (b + d.fields.length)) <= 1e-6;
  }
  return false;
}

const misses = [];
for (const file of files) {
  const name = basename(file);
  const format = file.endsWith('.rkt') ? 'rkt' : 'ork';
  const saved = JSON.parse(readFileSync(`${file}.kernel.json`, 'utf8'));
  const kernel = format === 'rkt' ? asRockSim(saved) : saved;
  const loaded = desktop[file] ?? [];
  // Parts are matched by their place in the tree, so once desktop has built a
  // different tree there is nothing to compare them with: report the structure
  // and stop.
  const apart = kernel.findIndex(
    (k, i) => !loaded[i] || !sameKind(k.type, loaded[i].class) || k.depth !== loaded[i].depth,
  );
  if (apart >= 0 || loaded.length !== kernel.length) {
    const at = apart >= 0 ? apart : kernel.length;
    misses.push({
      rule: `${format}:part tree`,
      text: `${name}: app ${kernel.length} parts, desktop ${loaded.length}; first apart at #${at}`,
    });
    continue;
  }
  for (let i = 0; i < kernel.length; i++) {
    const k = kernel[i];
    const d = loaded[i];
    for (const [key, value] of Object.entries(k.fields)) {
      if (SKIP.has(key) || !(key in d.fields)) continue;
      if (k.copy && COPY_PLACEMENT.has(key)) continue;
      if (format === 'rkt' && RKT_RESTATED.has(key)) continue;
      if (READ_ONLY_WHEN[key] && !READ_ONLY_WHEN[key](k.fields) && !READ_ONLY_WHEN[key](d.fields)) continue;
      if (same(key, value, d.fields[key], TOLERANCE[format])) continue;
      if (format === 'rkt' && rktRestatement(key, k, d)) continue;
      misses.push({
        rule: `${format}:${k.type}.${key}`,
        anyType: `${format}:*.${key}`,
        app: value,
        desktop: d.fields[key],
        appFields: k.fields,
        desktopFields: d.fields,
        text: `${name} ${k.name || k.type}: app ${value}, desktop ${d.fields[key]}`,
      });
    }
  }
}

const matched = new Set();
const unknown = new Map();
for (const m of misses) {
  const entry = KNOWN.find(
    (e) =>
      (e.rule === m.rule || e.rule === m.anyType) &&
      (!e.when || (m.appFields && e.when(m.app, m.desktop, m.appFields, m.desktopFields))),
  );
  if (entry) matched.add(entry);
  else unknown.set(m.rule, [...(unknown.get(m.rule) ?? []), m.text]);
}
const stale = KNOWN.filter((e) => !matched.has(e));
for (const [rule, lines] of [...unknown.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`DIFFERS ${rule}`);
  for (const l of lines.slice(0, 3)) console.log(`  ${l}`);
  if (lines.length > 3) console.log(`  and ${lines.length - 3} more`);
}
for (const e of stale) console.log(`NO LONGER DIFFERS ${e.rule} (${e.why}): remove it from KNOWN`);
console.log(`${unknown.size} new differences, ${matched.size} known, ${stale.length} stale entries`);
process.exit(unknown.size || stale.length ? 1 : 0);
