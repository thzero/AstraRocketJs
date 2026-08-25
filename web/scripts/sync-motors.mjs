// Build-time motor catalog sync from the ThrustCurve.org API.
//
// Tier A: we ship only factual motor SPECS (total impulse, burn time, mass,
// dimensions) — the numbers the browser simulation needs. We do NOT ship the
// thrust-curve sample files (those carry per-file licenses; OpenRocket Core has
// its own curves). Scope: currently-available motors whose data is public,
// free, or unlicensed — motors whose only data files are explicitly restricted
// are dropped.
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

function isPublicLicense(license) {
  // include public domain, free, or unset/unknown; exclude explicit restrictions
  return !license || license === "PD" || license === "free";
}

async function main() {
  console.log("Fetching available motors…");
  const { results: motors = [] } = await post("search.json", { availability: "available", maxResults: 5000 });
  console.log(`  ${motors.length} available motors`);

  console.log("Checking data-file licenses…");
  const restricted = new Set(); // motorIds whose files are ALL restricted
  const licenseCounts = {};
  for (const ids of chunk(motors.map((m) => m.motorId), 150)) {
    const { results: files = [] } = await post("download.json", { motorIds: ids, data: "file", maxResults: 4000 });
    const byMotor = new Map();
    for (const f of files) {
      const key = f.license || "(unset)";
      licenseCounts[key] = (licenseCounts[key] ?? 0) + 1;
      if (!byMotor.has(f.motorId)) byMotor.set(f.motorId, []);
      byMotor.get(f.motorId).push(f.license);
    }
    for (const [motorId, licenses] of byMotor) {
      if (!licenses.some(isPublicLicense)) restricted.add(motorId);
    }
  }
  console.log("  file license distribution:", licenseCounts);
  console.log(`  ${restricted.size} motors dropped (restricted-only data)`);

  const catalog = motors
    .filter((m) => !restricted.has(m.motorId))
    .filter((m) => m.totImpulseNs > 0 && m.burnTimeS > 0)
    .map((m) => ({
      designation: m.commonName || m.designation,
      manufacturer: m.manufacturerAbbrev || m.manufacturer,
      class: m.impulseClass,
      diameter: round(m.diameter, 0),
      impulse: round(m.totImpulseNs, 3),
      burn: round(m.burnTimeS, 3),
      mass: round(m.totalWeightG, 2),
    }))
    .sort((a, b) => a.impulse - b.impulse || a.designation.localeCompare(b.designation));

  await writeFile(OUT, JSON.stringify(catalog, null, 0) + "\n");
  console.log(`\nWrote ${catalog.length} motors → app/motors.generated.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
