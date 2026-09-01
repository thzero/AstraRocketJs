// Build-time motor catalog sync from the ThrustCurve.org API.
//
// Ships the full motor: factual specs (impulse, burn, mass, dimensions) AND the
// thrust-curve samples, plus the length + propellant weight needed to build a
// simulatable motor. Everything is bundled so a picked motor resolves OFFLINE
// and instantly — no runtime thrustcurve.org call.
//
// Run manually or in CI (never inside `vite build`):  node scripts/sync-motors.mjs
// Data © thrustcurve.org contributors and the certifying bodies (NAR/TRA/CAR).

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://www.thrustcurve.org/api/v1";
const OUT = resolve(fileURLToPath(new URL("../src/data", import.meta.url)), "motors.generated.json");

async function post(path, body) {
  const res = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

const round = (n, d) => (Number.isFinite(n) ? Number(n.toFixed(d)) : 0);
const chunk = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

// A motor can have several data files (cert vs user submissions, RASP/RockSim
// formats). Bundle them ALL, best-first, so the picker can offer a choice.
const SRC_RANK = { cert: 0, mfr: 1, user: 2 };
const sourceLabel = (s) => ({ cert: "Certified", mfr: "Manufacturer", user: "User" }[s] || (s || "Unknown"));

/** Fetch thrust-curve files for a batch of motorIds → Map<motorId, file[]>. */
async function fetchSamples(ids) {
  const out = new Map();
  const { results: files = [] } = await post("download.json", { motorIds: ids, data: "samples", maxResults: 4000 });
  for (const f of files) {
    if (!f.samples || f.samples.length < 2) continue;
    if (!out.has(f.motorId)) out.set(f.motorId, []);
    out.get(f.motorId).push({ source: f.source, format: f.format, samples: f.samples });
  }
  return out;
}

async function main() {
  console.log("Fetching available motors…");
  const { results: motors = [] } = await post("search.json", { availability: "available", maxResults: 5000 });
  console.log(`  ${motors.length} available motors`);

  console.log("Fetching thrust curves…");
  const sampleMap = new Map();
  const batches = chunk(motors.map((m) => m.motorId), 100);
  let done = 0;
  for (const ids of batches) {
    const got = await fetchSamples(ids);
    for (const [id, v] of got) sampleMap.set(id, v);
    done += ids.length;
    process.stdout.write(`\r  ${done}/${motors.length} motors, ${sampleMap.size} with curves`);
  }
  console.log("");

  const rankFiles = (files) => [...files].sort((a, b) =>
    (SRC_RANK[a.source] ?? 9) - (SRC_RANK[b.source] ?? 9) ||    // cert first
    (a.format === "RASP" ? 0 : 1) - (b.format === "RASP" ? 0 : 1) || // RASP first
    b.samples.length - a.samples.length);

  const catalog = motors
    .filter((m) => m.totImpulseNs > 0 && m.burnTimeS > 0)
    .map((m) => {
      const curve = sampleMap.get(m.motorId);
      const row = {
        designation: m.commonName || m.designation,
        manufacturer: m.manufacturerAbbrev || m.manufacturer,
        class: m.impulseClass,
        diameter: round(m.diameter, 0),
        impulse: round(m.totImpulseNs, 3),
        burn: round(m.burnTimeS, 3),
        mass: round(m.totalWeightG, 2),
      };
      // Descriptive metadata for the detail panel (kept on every motor).
      if (m.designation && m.designation !== row.designation) row.code = m.designation; // full mfr code
      if (m.type) row.type = m.type;                 // SU / reload / hybrid
      if (m.delays) row.delays = m.delays;           // "4,6,7,8,10"
      if (m.propInfo) row.propInfo = m.propInfo;     // propellant type
      if (m.sparky) row.sparky = true;
      if (Number.isFinite(m.avgThrustN)) row.avgThrust = round(m.avgThrustN, 2);
      if (Number.isFinite(m.maxThrustN)) row.maxThrust = round(m.maxThrustN, 2);
      if (Number.isFinite(m.length)) row.length = round(m.length, 2);          // mm
      if (Number.isFinite(m.propWeightG)) row.propWeightG = round(m.propWeightG, 2); // g
      // Bundled thrust curves (best-first), so a picked motor resolves with no
      // fetch and the picker can offer a choice when there are several.
      if (curve && Number.isFinite(m.length) && Number.isFinite(m.propWeightG)) {
        row.curves = rankFiles(curve).map((c) => ({
          src: `${sourceLabel(c.source)} · ${c.format}`,
          samples: c.samples.map((s) => [round(s.time, 4), round(s.thrust, 3)]),
        }));
      }
      return row;
    })
    .sort((a, b) => a.impulse - b.impulse || a.designation.localeCompare(b.designation));

  const withCurves = catalog.filter((m) => m.curves).length;
  await writeFile(OUT, JSON.stringify(catalog, null, 0) + "\n");
  console.log(`\nWrote ${catalog.length} motors (${withCurves} with bundled curves) → src/data/motors.generated.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
