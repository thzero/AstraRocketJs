// Open the files the app saves in a real OpenRocket and require every part to
// come back holding what the app's kernel flies.
//
//   npm run check:fields -- <samples dir>
//   npm run check:fields -- --jar <OpenRocket.jar> <samples dir>
//
// The samples come from tests/services/files/orkDesktopSamples.test.ts with
// ORK_SAMPLES_DIR set: each `.ork` and `.rkt` there has a `<file>.kernel.json`
// beside it, listing every part as the app's kernel built it, and each `.ork`
// a `<file>.app.json`, listing its flight configurations and simulations as the
// app wrote them. Under `source/` are the bundled examples as they ship, beside
// the same two files for what the app made of them on import. This opens each
// file in the pinned desktop release, reads every part back through the same
// getters (engine-java/src/api/java/api/ComponentFields.java, compiled against
// that release), and compares the two part by part in tree order, depth
// included. The getters cover the panel's fields plus what a file also
// carries: overrides, materials, the finish and a fin's planform area. Then it
// compares each configuration's motors, recovery, staging and grounded stages,
// and each simulation's launch conditions, with what desktop read.
//
// `check:ork` asks whether desktop accepts a file. This asks whether desktop
// reads the same rocket from it: a writer that emits a default the kernel does
// not fly, drops a field, or writes a stale automatic value fails here and
// nowhere else.
//
// A RockSim file restates some values (angles in degrees, a pod by its distance
// from the axis, a fin tab from the root's front, a packed part by either end);
// those are compared in the form desktop reads them. KNOWN lists the rest of the
// accepted differences, each with what 24.12 or RockSim cannot carry, or what a
// bundled example names as it ships, and each matches only the difference it
// names. The list is checked both ways: a new difference fails, and so does an
// entry that no longer occurs.
//
// `npm run audit` runs it after the `desktop` step. Needs a JDK and the pinned
// OpenRocket release, as `check:ork` does.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chooseBuild } from './lib/openrocketJava.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SOURCES = [
  resolve(HERE, 'ork-check/OrkFields.java'),
  resolve(HERE, '../../engine-java/src/api/java/api/ComponentFields.java'),
];

/**
 * Accepted differences. `rule` is `format:type.key`, with `*` for any type, or
 * `ork:config.<what>` and `ork:sim.<key>` for a configuration or a simulation.
 * `files`, when given, names the only files it applies to (a bundled example
 * as it ships is `source/<file>`). `when` gets the app's value, desktop's, and
 * both parts' fields (a configuration's motor: the app's motor), and says
 * whether this difference is the one the entry names; one that is not fails.
 */
const KNOWN = [
  // What RockSim cannot carry, or desktop's RockSim reader does not read.
  {
    rule: 'rkt:*.instanceCount',
    why: "RockSim has no repeat count (desktop's own export drops it too), so the writer names the part in its skipped list",
    when: (a, d) => a > 1 && d === 1,
  },
  {
    rule: 'rkt:launchlug.instanceSeparation',
    why: 'RockSim has no spacing element (LaunchLugDTO writes none), so LaunchLugHandler keeps the constructor spacing',
    when: (a, d) => d === 0.06,
  },
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
    rule: 'rkt:*.cgOverridden',
    why: "RockSim overrides mass and CG together, so a mass-only override goes out with the part's own CG, as desktop's own export writes it",
    when: (a, d, af) => af.massOverridden === true && !af.cgOverridden && d === true,
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
    rule: 'rkt:*.ignitionEvent',
    why: "RockSim has no mount ignition, and desktop's RockSim importer reads none, so the mount keeps the automatic default",
    when: (a, d) => d === 'automatic',
  },
  {
    rule: 'rkt:*.ignitionDelay',
    why: "RockSim has no mount ignition, and desktop's RockSim importer reads none, so the mount keeps no delay",
    when: (a, d) => d === 0,
  },
  {
    rule: 'rkt:masscomponent.massComponentType',
    why: 'RockSim has no mass component type',
    when: (a, d) => d === 'masscomponent',
  },
  { rule: 'rkt:masscomponent.radius', why: 'MassObjectHandler does not read Dia', when: (a, d) => d === 0.0125 },
  { rule: 'rkt:nosecone.shoulderCapped', why: 'RockSim has no capped shoulder', when: (a, d) => d === false },
  {
    rule: 'rkt:*.cdOverridden',
    why: 'RockSim has no drag coefficient override, so the writer names the part in its skipped list',
    when: (a, d) => a === true && d === false,
  },
  {
    rule: 'rkt:*.overrideCD',
    why: "RockSim has no drag coefficient override; desktop reports the part's own computed drag",
    when: (a, d, af) => af.cdOverridden === true,
  },
  {
    rule: 'rkt:*.deployDelay',
    why: "deployment is only in RockSim's simulation events, which desktop does not import",
    when: (a, d) => d === 0,
  },
  {
    rule: 'rkt:stage.separationDelay',
    why: "separation is only in RockSim's simulation results, which desktop does not import",
    when: (a, d) => d === 0,
  },
  {
    rule: 'rkt:transition.clipped',
    why: "RockSim has no clip flag; TransitionHandler keeps Transition()'s clipped shape",
    when: (a, d) => d === true,
  },
  {
    rule: 'rkt:*.filletRadius',
    why: 'RockSim has no fin fillet',
    when: (a, d) => d === 0,
  },
  {
    rule: 'rkt:freeformfinset.planformArea',
    why: 'a freeform outline on a tapered parent: FreeformFinSet.setPoints snaps the outline desktop reads from the point list to the root it computes, which moves the area by under 2 %',
    when: (a, d) => Math.abs(a - d) < 0.02 * Math.max(a, d),
  },
  {
    rule: 'rkt:shockcord.density',
    why: 'RockSim has no line material for a cord: MassObjectHandler leaves it weightless, and the app flies its default elastic cord',
    when: (a, d) => d === 0,
  },
  {
    rule: 'rkt:shockcord.materialName',
    why: 'RockSim has no line material for a cord: MassObjectHandler leaves it unnamed, and the app flies its default elastic cord',
    when: (a, d) => d === '',
  },
  // What RockSim carries as a number only, or not at all.
  {
    rule: 'rkt:*.outerRadiusAuto',
    why: 'RockSim carries the diameter, not the automatic setting; desktop reads a fixed one',
    when: (a, d) => a === true && d === false,
  },
  {
    rule: 'rkt:*.innerRadiusAuto',
    why: 'RockSim carries the diameter, not the automatic setting; desktop reads a fixed one',
    when: (a, d) => a === true && d === false,
  },
  {
    rule: 'rkt:*.radiusAuto',
    why: 'RockSim carries the packed diameter, not the automatic setting; desktop reads a fixed one',
    when: (a, d) => a === true && d === false,
  },
  {
    rule: 'rkt:*.cdAuto',
    why: 'RockSim carries the drag coefficient, not the automatic setting; desktop reads a fixed one',
    when: (a, d) => a === true && d === false,
  },
  { rule: 'rkt:*.comment', why: 'RockSim has no component comment', when: (a, d) => d === '' },
  {
    rule: 'rkt:*.filletDensity',
    why: "RockSim has no fin fillet, so desktop's fin set keeps the constructor's fillet material",
    when: (a, d) => d === 680,
  },
  {
    rule: 'rkt:*.filletMaterialName',
    why: "RockSim has no fin fillet, so desktop's fin set keeps the constructor's fillet material",
    when: (a, d) => d === 'Cardboard',
  },
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
  // What desktop's RockSim import does not create.
  {
    rule: 'ork:config',
    files: ['source/rocksim.rkt'],
    why: "desktop's RockSim import creates no flight configuration; the app mints one so the mounts have an id to key by",
  },
  {
    rule: 'ork:sims',
    files: ['source/rocksim.rkt'],
    why: "desktop's RockSim import creates no simulation; the app adds its default one",
  },
  // What 24.12 cannot carry in a .ork.
  {
    rule: 'ork:config.motor',
    why: '24.12 looks motors up in its own database only and does not read the curve the app embeds under thrustcurves/ (upstream OpenRocket does)',
    when: (a, d, am) => am.embedded === true && d === null,
  },
  // The bundled examples as they ship, written by an OpenRocket 26 build.
  {
    rule: 'ork:config.motor.digest',
    files: ['source/pods-powered-with-recovery-deployment.ork', 'source/two-stage-high-power-rocket.ork'],
    why: "the source file names motors by the OpenRocket 26 database's digests, which 24.12 does not hold, so it takes its own curve by name",
  },
  // The same examples saved again: the app keeps the curve each source file
  // carries and names it by that curve's digest, which 24.12 does not hold.
  {
    rule: 'ork:config.motor.digest',
    files: ['pods-powered-with-recovery-deployment.ork', 'two-stage-high-power-rocket.ork'],
    why: "the file carries the source file's OpenRocket 26 curve under its own digest, which 24.12 does not hold, so it takes its own curve by name",
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
    rule: 'rkt:transition.aftShoulderThickness',
    why: 'TransitionHandler takes the wall, or the shoulder radius when solid',
    when: (a, d, af, df) => d === df.thickness || d === df.aftShoulderRadius,
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
// The saved files, and under `source/` the bundled examples as they ship.
const samplesIn = (d) =>
  existsSync(d)
    ? readdirSync(d)
        .filter((f) => /\.(ork|rkt)$/.test(f) && existsSync(join(d, `${f}.kernel.json`)))
        .map((f) => join(d, f))
    : [];
const files = [...samplesIn(dir), ...samplesIn(join(dir, 'source'))];
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
  radialDirection: (a) => asReadRadians(a),
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

/**
 * Configurations and simulations: what the app wrote (`<file>.app.json`, from
 * tests/services/files/orkDesktopSamples.test.ts) against what desktop read
 * (`OrkFields`). Per configuration, by id: the motor in each mount (designation,
 * digest, ejection delay, ignition), each recovery device's deployment, each
 * lower stage's or booster's separation, and which stages fly. Per simulation,
 * in file order: its name, its configuration and every condition 24.12 keeps.
 * A key the app leaves out is not compared. A difference is reported under the
 * rule `ork:config.<what>` or `ork:sim.<key>`, with the KNOWN list the parts use.
 */
function compareFlights(name, app, read) {
  const miss = (rule, text, a, d, af) =>
    misses.push({ rule: `ork:${rule}`, file: name, app: a, desktop: d, appFields: af, text: `${name} ${text}` });
  const differ = (rule, where, a, d, key = '') => {
    if (a === undefined) return;
    if (a === null ? d === null || d === undefined : d !== undefined && d !== null && same(key, a, d, TOLERANCE.ork)) {
      return;
    }
    miss(rule, `${where}: app ${a}, desktop ${d}`, a, d);
  };
  const byPart = (list) => new Map(list.map((x) => [x.part, x]));
  for (const ac of app.configs) {
    const dc = read.configs.find((c) => c.id === ac.id);
    if (!dc) {
      miss('config', `configuration ${ac.id}: not read`);
      continue;
    }
    differ('config.default', ac.id, ac.default, dc.default);
    const dm = byPart(dc.motors);
    for (const m of ac.motors) {
      const d = dm.get(m.part);
      if (!d) {
        miss(
          'config.motor',
          `${ac.id} part #${m.part}: app ${m.designation}, desktop no motor`,
          m.designation,
          null,
          m,
        );
        continue;
      }
      // The app names a motor by its common name (F67), desktop's designation
      // is the full code (F67W): either is the same motor.
      if (!same('', m.designation, d.commonName, 0)) {
        differ('config.motor.designation', `${ac.id} part #${m.part}`, m.designation, d.designation);
      }
      for (const k of ['digest', 'delay', 'ignitionEvent', 'ignitionDelay']) {
        differ(`config.motor.${k}`, `${ac.id} part #${m.part}`, m[k], d[k]);
      }
    }
    for (const part of dm.keys()) {
      if (!ac.motors.some((m) => m.part === part)) {
        miss('config.motor', `${ac.id} part #${part}: app no motor, desktop ${dm.get(part).designation}`);
      }
    }
    for (const [list, what] of [
      ['deployments', 'deployment'],
      ['separations', 'separation'],
    ]) {
      const dd = byPart(dc[list]);
      for (const x of ac[list]) {
        const d = dd.get(x.part);
        if (!d) {
          miss(`config.${what}`, `${ac.id} part #${x.part}: not read`);
          continue;
        }
        for (const k of ['event', 'altitude', 'delay'])
          differ(`config.${what}.${k}`, `${ac.id} part #${x.part}`, x[k], d[k]);
      }
    }
    differ('config.stages', ac.id, JSON.stringify(ac.stages), JSON.stringify(dc.stages));
  }
  if (app.sims.length !== read.sims.length) {
    miss('sims', `app ${app.sims.length} simulations, desktop ${read.sims.length}`);
    return;
  }
  app.sims.forEach((as, i) => {
    const ds = read.sims[i];
    differ('sim.name', `simulation #${i}`, as.name, ds.name);
    differ('sim.configId', as.name, as.configId, ds.configId);
    for (const [key, a] of Object.entries(as.conditions)) {
      const d = ds.conditions[key];
      if (a === undefined) continue;
      if (key === 'windLevels') {
        differ('sim.windLevels', `${as.name} wind levels`, a.length, d.length);
        a.forEach((l, j) => {
          for (const k of Object.keys(l)) differ(`sim.windLevels.${k}`, `${as.name} wind level #${j}`, l[k], d[j]?.[k]);
        });
      } else {
        differ(`sim.${key}`, as.name, a, d, ANGLE_CONDITIONS.has(key) ? 'rotation' : key);
      }
    }
  });
}

/** Launch conditions that are angles, compared modulo a turn like the part angles. */
const ANGLE_CONDITIONS = new Set(['launchRodDirection', 'windDirection']);

const misses = [];
for (const file of files) {
  const name = basename(dirname(file)) === 'source' ? `source/${basename(file)}` : basename(file);
  const format = file.endsWith('.rkt') ? 'rkt' : 'ork';
  const saved = JSON.parse(readFileSync(`${file}.kernel.json`, 'utf8'));
  const kernel = format === 'rkt' ? asRockSim(saved) : saved;
  const read = desktop[file] ?? { parts: [], configs: [], sims: [] };
  if (existsSync(`${file}.app.json`)) {
    compareFlights(name, JSON.parse(readFileSync(`${file}.app.json`, 'utf8')), read);
  }
  const loaded = read.parts;
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
      (!e.files || e.files.includes(m.file)) &&
      (!e.when || e.when(m.app, m.desktop, m.appFields ?? {}, m.desktopFields ?? {})),
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
