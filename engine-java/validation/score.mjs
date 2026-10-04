/**
 * Validation scoring harness — grades the JS engine against the measured
 * anchor datasets in validation/anchors.json (provenance and tolerances are in
 * its `_readme` and per-series fields).
 *
 * Usage:
 *   node validation/score.mjs               # classic model (flag off) scorecard to stdout
 *   node validation/score.mjs --supersonic  # score with the supersonicAero flag ON
 *   node validation/score.mjs --strict      # exit 1 if any gate point fails
 *   node validation/score.mjs --record-expect  # re-record each fixture's _expect.aero (deliberate only)
 *   node validation/score.mjs [--supersonic] --check-floors  # the CI ratchet, from validation/floors.json
 *
 * Requires the engine to be built first (`npm run build`, or
 * `npm run build -w @online-openrocket/engine`).
 *
 * Baseline expectation (classic Extended Barrowman, pre-supersonic-build):
 * supersonic CP series FAIL on every fixture — body CP is frozen at its
 * Mach-1 value in the kernel. That failure is the point of this harness;
 * each build phase should turn rows green without breaking the others.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Drive the vendored TeaVM engine directly (no TS wrapper build needed). Install the stdout
// sinks the kernel reads once at evaluation, then adapt the handful of facade calls score uses.
// stderr is COLLECTED, not discarded: a fixture that drives the kernel into a
// logged failure path would otherwise be scored as if nothing happened. A clean
// scoring run writes nothing to stderr at all (measured), so anything there
// fails the run, with what was logged.
let kernelStderr = '';
globalThis.$rt_putStdoutCustom ??= () => {};
globalThis.$rt_putStderrCustom = (chunk) => { kernelStderr += chunk; };
const engine = await import(
  pathToFileURL(join(here, '..', '..', 'web', 'src', 'engine', 'vendor', 'openrocket-engine.mjs')).href
);
const resetEngine = () => engine.reset();
class OrkRocket {
  #h;
  constructor(h) { this.#h = h; }
  static buildTree(tree) { return new OrkRocket(engine.buildRocket(JSON.stringify(tree))); }
  setSupersonicAero(on) { engine.setSupersonicAero(this.#h, on); }
  staticInfo() { return JSON.parse(engine.getStaticInfo(this.#h)); }
  aeroSweep(opts) { return JSON.parse(engine.getAeroSweep(this.#h, JSON.stringify(opts))); }
}

const anchors = JSON.parse(readFileSync(join(here, 'anchors.json'), 'utf8'));
const strict = process.argv.includes('--strict');
// A ratchet, so this can be wired into CI while the absolute score is still low.
// --min <n> fails if the gate score drops BELOW a recorded floor; --expect-gates
// <n> fails if the number of gated points is not exactly n, which is what
// catches a silently shrunken anchors.json (see the gateTotal check below).
const numArg = (flag) => {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  const v = Number(process.argv[i + 1]);
  if (!Number.isInteger(v) || v < 0) {
    console.error(`score: ${flag} needs a non-negative integer`);
    process.exit(2);
  }
  return v;
};
const supersonic = process.argv.includes('--supersonic');
// --check-floors takes the ratchet from validation/floors.json, the one place the
// floors live: they were written out in gates.yml with a second hand-kept copy
// in the README and nothing comparing the two. Explicit flags still override.
const floors = process.argv.includes('--check-floors')
  ? JSON.parse(readFileSync(join(here, 'floors.json'), 'utf8'))
  : null;
const minPass = numArg('--min') ?? (floors ? floors.min[supersonic ? 'supersonic' : 'classic'] : null);
const expectGates = numArg('--expect-gates') ?? (floors ? floors.gates : null);
// The IDENTITY of the gated set, not only its size: --expect-gates holds when
// nine hard points are switched off and nine easy ones switched on, or when a
// tolerance is widened, and the score rises with CI green. A sha256 over every
// gated point's series, Mach, anchor and tolerance pins all of it.
const gateHashAt = process.argv.indexOf('--expect-gate-hash');
const expectGateHash = gateHashAt < 0 ? (floors ? floors.gateHash : null) : process.argv[gateHashAt + 1];
if (expectGateHash != null && !/^[0-9a-f]{64}$/.test(expectGateHash)) {
  console.error('score: --expect-gate-hash needs a sha256 in hex');
  process.exit(2);
}
const recordExpect = process.argv.includes('--record-expect');

/**
 * What a fixture is pinned to beyond its size: drag, CNa and CP at a subsonic
 * and a supersonic Mach, under BOTH models whichever one is being scored.
 *
 * `length` and `refDiameter` are the two figures fin section, fin thickness and
 * finish cannot move, so a fixture could stop modeling its published rocket and
 * still pass them: renaming `crossSection` (drag +97% at Mach 0.5) scored 12 MORE
 * gate points with CI green. Both models, because `airfoilSection` is read only
 * on the supersonic path. 0.1% is far below any corruption measured (7% and up)
 * and leaves room for no physics change at all: a deliberate one re-records with
 * --record-expect, which says so in the diff.
 */
const EXPECT_MACHS = [0.5, 2.0];
const EXPECT_REL_TOL = 1e-3;
const aeroPin = (tree) => {
  const pin = {};
  for (const model of ['classic', 'supersonic']) {
    engine.reset();
    const h = engine.buildRocket(JSON.stringify(tree));
    if (model === 'supersonic') engine.setSupersonicAero(h, true);
    const s = JSON.parse(
      engine.getAeroSweep(h, JSON.stringify({ machMin: EXPECT_MACHS[0], machMax: EXPECT_MACHS[1], machStep: EXPECT_MACHS[1] - EXPECT_MACHS[0], aoaDeg: 0 })),
    );
    EXPECT_MACHS.forEach((m, i) => {
      for (const [q, v] of [['cd', s.powerOff.total[i]], ['cna', s.cna[i]], ['cp', s.cp[i]]]) {
        pin[`${model}.${q}@${m}`] = Number(v.toPrecision(7));
      }
    });
  }
  return pin;
};
const gatedIds = [];

/** Linear interpolation of series y over grid xs at x (clamped to range). */
function interp(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let i = 1;
  while (xs[i] < x) i++;
  const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[i - 1] + t * (ys[i] - ys[i - 1]);
}

const DEG_PER_RAD = 57.29577951308232;
let gateTotal = 0;
let gatePass = 0;
const out = [];
out.push(`# Anchor scorecard — ${supersonic ? 'SUPERSONIC AERO model (flag on)' : 'classic Extended Barrowman (flag off)'}`);
out.push('');
out.push(`Generated by validation/score.mjs. Quantities: cd = drag coefficient (base included/excluded per series), cpPctL = CP as % of body length from nose, cpOverL = CP/length, cnaPerRad / cnaPerDeg = normal-force slope. gate=false rows are informational.`);
out.push('');

for (const [name, spec] of Object.entries(anchors)) {
  if (name.startsWith('_')) continue;
  resetEngine();
  const tree = JSON.parse(readFileSync(join(here, 'fixtures', spec.fixture), 'utf8'));
  const rocket = OrkRocket.buildTree(tree);
  if (supersonic) rocket.setSupersonicAero(true);
  const info = rocket.staticInfo();
  // The fixture says what it is, and the kernel has to agree before a single
  // anchor is scored. Without this a corrupt fixture (a nose length of "abc",
  // null, or 1e999) built a DIFFERENT rocket through the kernel's defaults and
  // scored it as the published model: indistinguishable from a one-gate
  // physics regression. 5e-4 m absorbs the 4-decimal rounding of the recorded
  // values and nothing else.
  const expect = tree._expect;
  if (!expect || !Number.isFinite(expect.length) || !Number.isFinite(expect.refDiameter)) {
    console.error(`score: fixture ${spec.fixture} carries no _expect {length, refDiameter}.`);
    console.error('score:   every fixture must say what the kernel should build from it.');
    process.exit(1);
  }
  for (const key of ['length', 'refDiameter']) {
    if (!(Math.abs(info[key] - expect[key]) <= 5e-4)) {
      console.error(`score: fixture ${spec.fixture} built ${key} = ${info[key]}, expected ${expect[key]}.`);
      console.error('score:   the fixture is corrupt, or the kernel no longer reads it the same way.');
      process.exit(1);
    }
  }
  const pin = aeroPin(tree);
  if (recordExpect) {
    const path = join(here, 'fixtures', spec.fixture);
    const text = readFileSync(path, 'utf8');
    const line = `"_expect": ${JSON.stringify({ length: expect.length, refDiameter: expect.refDiameter, aero: pin })}`;
    const next = text.replace(/"_expect": \{.*\}(?=,?\r?\n)/, line);
    if (next === text && !text.includes(line)) {
      console.error(`score: could not find a one-line _expect in ${spec.fixture} to re-record.`);
      process.exit(1);
    }
    writeFileSync(path, next);
    console.error(`score: re-recorded _expect.aero in ${spec.fixture}`);
  } else {
    if (!expect.aero) {
      console.error(`score: fixture ${spec.fixture} carries no _expect.aero. Record it with --record-expect.`);
      process.exit(1);
    }
    for (const [key, want] of Object.entries(pin)) {
      const was = expect.aero[key];
      if (!(Number.isFinite(was) && Math.abs(want - was) <= Math.abs(was) * EXPECT_REL_TOL)) {
        console.error(`score: fixture ${spec.fixture} gives ${key} = ${want}, expected ${was}.`);
        console.error('score:   the fixture no longer models what it did, or the aero model moved.');
        console.error('score:   If the model change is deliberate, re-record with --record-expect.');
        process.exit(1);
      }
    }
  }
  engine.reset();
  const rocketAgain = OrkRocket.buildTree(tree);
  if (supersonic) rocketAgain.setSupersonicAero(true);
  const sweep = rocketAgain.aeroSweep({
    machMin: 0.05, machMax: spec.maxMach ?? 10, machStep: 0.025,
    aoaDeg: spec.aoaDeg ?? 0, machAlt: spec.machAlt,
  });
  const scale = spec.refAreaScale ?? 1;

  out.push(`## ${name} — ${tree.name}`);
  out.push('');
  out.push(`Length ${info.length.toFixed(4)} m, kernel ref diameter ${info.refDiameter.toFixed(4)} m, dataset ref-area scale x${scale}.`);
  out.push('');

  const model = (series, mach) => {
    switch (series.quantity) {
      case 'cd': {
        let cd = interp(sweep.machs, sweep.powerOff.total, mach);
        if (series.base === 'excluded') cd -= interp(sweep.machs, sweep.powerOff.base, mach);
        return cd * scale;
      }
      case 'cpPctL':
        return (interp(sweep.machs, sweep.cp, mach) / info.length) * 100;
      case 'cpOverL':
        return interp(sweep.machs, sweep.cp, mach) / info.length;
      case 'cnaPerRad':
        return interp(sweep.machs, sweep.cna, mach) * scale;
      case 'cnaPerDeg':
        return (interp(sweep.machs, sweep.cna, mach) * scale) / DEG_PER_RAD;
      default:
        throw new Error(`unknown quantity ${series.quantity}`);
    }
  };

  for (const series of spec.series) {
    out.push(`### ${series.id} (${series.quantity}${series.base ? `, base ${series.base}` : ''})`);
    out.push('');
    out.push(`_${series.source}_`);
    out.push('');
    out.push('| Mach | anchor | model | delta | tol | result |');
    out.push('|---|---|---|---|---|---|');
    for (const [mach, anchor] of series.points) {
      const m = model(series, mach);
      const tol = series.relTol != null ? Math.abs(anchor) * series.relTol : series.tol;
      const delta = m - anchor;
      const inTol = Math.abs(delta) <= tol;
      const gated = series.gate
        && (series.gateMaxMach == null || mach <= series.gateMaxMach)
        && (series.gateMinMach == null || mach >= series.gateMinMach);
      if (gated) {
        gateTotal++;
        if (inTol) gatePass++;
        gatedIds.push([name, series.id, series.quantity, series.base ?? '', mach, anchor,
          series.relTol != null ? `rel ${series.relTol}` : `abs ${series.tol}`].join('|'));
      }
      const result = gated ? (inTol ? 'PASS' : '**FAIL**') : (inTol ? 'ok (info)' : 'off (info)');
      out.push(`| ${mach} | ${anchor} | ${m.toFixed(4)} | ${delta >= 0 ? '+' : ''}${delta.toFixed(4)} | ±${tol.toFixed(4)} | ${result} |`);
    }
    out.push('');
  }
}

out.push('## Summary');
out.push('');
const pct = gateTotal ? `${((100 * gatePass) / gateTotal).toFixed(1)}%` : 'n/a';
out.push(`**Gate points: ${gatePass}/${gateTotal} within tolerance** (${pct}). Informational rows excluded.`);
out.push('');
const gateHash = createHash('sha256').update(gatedIds.sort().join('\n')).digest('hex');
out.push(`Gated set: sha256 ${gateHash}`);
out.push('');
console.log(out.join('\n'));

// An empty gate set is a BROKEN HARNESS, not a perfect score. `--strict` used to
// pass on it, because `gatePass < gateTotal` is `0 < 0`: a truncated or
// half-written anchors.json scored `0/0 (NaN%)` and exited 0. This runs
// unconditionally, not only under --strict, because a scorecard reporting
// success over nothing is wrong however it was invoked.
if (gateTotal === 0) {
  console.error('score: NO gated points were scored. anchors.json is empty, truncated, or');
  console.error('score:   has every `gate` flag off. That is a broken harness, not a pass.');
  process.exit(1);
}

let failed = false;
if (kernelStderr.trim()) {
  console.error('score: the kernel logged errors while the anchors were scored:');
  kernelStderr.trim().split(/\r?\n/).slice(0, 20).forEach((l) => console.error(`  ${l}`));
  failed = true;
}
// Silent shrinkage of the anchor set is the other way this fails open: the
// denominator just gets smaller and the scorecard reads normally. Pin it.
if (expectGates != null && gateTotal !== expectGates) {
  console.error(`score: expected ${expectGates} gated point(s), scored ${gateTotal}.`);
  console.error('score:   anchors.json changed shape. If deliberate, update gates in validation/floors.json.');
  failed = true;
}
if (expectGateHash != null && gateHash !== expectGateHash) {
  console.error(`score: the gated set changed: sha256 ${gateHash}, expected ${expectGateHash}.`);
  console.error('score:   a gate flag, Mach range, anchor or tolerance moved in anchors.json.');
  console.error('score:   If deliberate, update gateHash in validation/floors.json and say why in review.');
  failed = true;
}
if (minPass != null && gatePass < minPass) {
  console.error(`score: gate score ${gatePass}/${gateTotal} is below the recorded floor of ${minPass}.`);
  console.error('score:   the aero model regressed against the published anchors.');
  failed = true;
}
if (strict && gatePass < gateTotal) failed = true;
if (failed) process.exit(1);
