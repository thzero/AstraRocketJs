// How many catalog rows carry the digest desktop OpenRocket uses to find the
// same part or motor, and the floors a catalog has to meet before it is
// written or published.
//
// A parts catalog without digests makes every saved .ork drop its part links,
// and a motor catalog without them leaves desktop to choose among motors that
// share a name. Neither looks wrong in the app, and a refresh whose dumper
// returned nothing, or a workflow that skipped the digest step, would otherwise
// publish one with a green run. A relative check alone is not enough: its
// baseline is the copy on the data branch, which can itself have none.
//
// The floors sit under what a healthy refresh gives (parts about 98%, every type
// with many rows above 92%, motors about 89%: thrustcurve.org lists motors that
// desktop's library does not), and far above what a broken one gives (0%).
// A type with fewer than MIN_ROWS rows is reported but not held to a floor:
// rail buttons are a dozen rows, and one part more or less moves them by 8%.

import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * How many motors carried a digest before sync-motors rewrote the catalog
 * without any. sync-motor-digests compares against it; the parts catalog has
 * the same handoff in PREVIOUS_CATALOG (lib/catalogStamp.mjs).
 */
export const PREVIOUS_MOTOR_DIGESTS = join(tmpdir(), 'astrarocketjs-motors.previous-digests.json');

/** Share of all parts that must carry a digest. */
const PART_FLOOR = 0.9;
/** Share of each part type with at least MIN_ROWS rows that must carry one. */
const PART_TYPE_FLOOR = 0.8;
/** Share of motors that must carry at least one digest. */
const MOTOR_FLOOR = 0.8;
/** Below this many rows a part type is reported but not held to a floor. */
export const MIN_ROWS = 50;

const share = (n, of) => (of ? n / of : 0);
const pct = (x) => `${(x * 100).toFixed(1)}%`;

/** Rows and digested rows per part type, and in total. */
function partCoverage(components) {
  const byType = new Map();
  for (const row of components) {
    const t = byType.get(row.type) ?? { rows: 0, digests: 0 };
    t.rows++;
    if (row.digest) t.digests++;
    byType.set(row.type, t);
  }
  const digests = components.filter((c) => c.digest).length;
  return { rows: components.length, digests, byType };
}

/** Motors and motors with at least one digest. */
export function motorCoverage(motors) {
  return { rows: motors.length, digests: motors.filter((m) => m.digests?.length).length };
}

/** Why a parts catalog fails its floors; empty when it passes. */
export function partProblems(components) {
  const c = partCoverage(components);
  const problems = [];
  if (share(c.digests, c.rows) < PART_FLOOR)
    problems.push(
      `parts: ${c.digests} of ${c.rows} carry a digest (${pct(share(c.digests, c.rows))}, floor ${pct(PART_FLOOR)})`,
    );
  for (const [type, t] of c.byType) {
    if (t.rows >= MIN_ROWS && share(t.digests, t.rows) < PART_TYPE_FLOOR)
      problems.push(
        `${type}: ${t.digests} of ${t.rows} carry a digest (${pct(share(t.digests, t.rows))}, floor ${pct(PART_TYPE_FLOOR)})`,
      );
  }
  return problems;
}

/** Why a motor catalog fails its floor; empty when it passes. */
export function motorProblems(motors) {
  const c = motorCoverage(motors);
  return share(c.digests, c.rows) < MOTOR_FLOOR
    ? [`motors: ${c.digests} of ${c.rows} carry a digest (${pct(share(c.digests, c.rows))}, floor ${pct(MOTOR_FLOOR)})`]
    : [];
}

/** A Markdown table of the coverage, for the console and the workflow summary. */
export function coverageTable(components, motors) {
  const lines = ['| Catalog | Rows | With digest | Share |', '|---|---:|---:|---:|'];
  if (components) {
    const c = partCoverage(components);
    for (const [type, t] of [...c.byType].sort(([a], [b]) => (a < b ? -1 : 1)))
      lines.push(`| ${type} | ${t.rows} | ${t.digests} | ${pct(share(t.digests, t.rows))} |`);
    lines.push(`| **all parts** | ${c.rows} | ${c.digests} | ${pct(share(c.digests, c.rows))} |`);
  }
  if (motors) {
    const m = motorCoverage(motors);
    lines.push(`| **motors** | ${m.rows} | ${m.digests} | ${pct(share(m.digests, m.rows))} |`);
  }
  return lines.join('\n');
}
