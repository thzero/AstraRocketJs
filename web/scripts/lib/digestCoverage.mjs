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
// The floors sit under what a healthy refresh gives (every part, motors about
// 89%: thrustcurve.org lists motors that desktop's library does not), and far
// above what a broken one gives (0%).
// A type with fewer than MIN_ROWS rows is reported but not held to a floor:
// rail buttons are eight rows, and one part more or less moves them by 12%.

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
function motorCoverage(motors) {
  return { rows: motors.length, digests: motors.filter((m) => m.digests?.length).length };
}

/**
 * Every digest carried by more than one row, with the rows that carry it.
 *
 * A digest names one desktop preset. Two rows of different sizes under one
 * digest make a saved .ork link the second part to the first preset, and
 * desktop then loads that preset's dimensions over the part. The digest step
 * can produce this when its matcher keys two rows to one preset, so it is
 * refused here rather than published.
 */
function sharedDigests(components) {
  const rows = new Map();
  for (const row of components) {
    if (!row.digest) continue;
    if (!rows.has(row.digest)) rows.set(row.digest, []);
    rows.get(row.digest).push(row);
  }
  return [...rows].filter(([, r]) => r.length > 1);
}

const rowName = (row) => [row.type, row.mfr, row.partNo ?? row.desc].filter(Boolean).join(' ');

/** Why a parts catalog fails its floors; empty when it passes. */
export function partProblems(components) {
  const c = partCoverage(components);
  const problems = [];
  for (const [digest, rows] of sharedDigests(components))
    problems.push(`digest ${digest} is carried by ${rows.length} rows (${rows.map(rowName).join('; ')})`);
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

/**
 * How this run's digests compare with the previous catalog's, row by row.
 *
 * The catalogs follow sources we do not control: thrustcurve.org deletes and
 * merges motors, and a database release drops parts. A row that is gone took its
 * digest with it, and that is not a broken run, so only rows present in both
 * catalogs are compared: one that had a digest and still exists must still have
 * one. The floors above stay the absolute protection.
 *
 * Each catalog is given as its rows' keys and whether each row carries a
 * digest, taken before the run edits the rows. A key can be carried by more than
 * one row (parts that share a part number and differ in size), so rows are
 * counted per key: a key keeps as many digests as it had, up to the rows it
 * still has.
 *
 * `lost` names each surviving key that has fewer digests than before, and is
 * what a sync refuses. `gone` names each key whose digested rows went away with
 * the rows themselves, and is reported, not refused.
 *
 * @param {{ key: string, digested: boolean }[]} previous the catalog this run is held to
 * @param {{ key: string, digested: boolean }[]} current the catalog this run would write
 * @returns {{ lost: string[], gone: string[] }}
 */
export function digestChanges(previous, current) {
  const tally = (rows) => {
    const byKey = new Map();
    for (const { key, digested } of rows) {
      const t = byKey.get(key) ?? { rows: 0, digests: 0 };
      t.rows++;
      if (digested) t.digests++;
      byKey.set(key, t);
    }
    return byKey;
  };
  const before = tally(previous);
  const after = tally(current);
  const lost = [];
  const gone = [];
  for (const [k, b] of before) {
    if (!b.digests) continue;
    const a = after.get(k) ?? { rows: 0, digests: 0 };
    // Rows that are gone account for up to that many of the missing digests.
    const kept = Math.min(b.digests, a.rows);
    if (a.digests < kept) lost.push(k);
    if (kept < b.digests) gone.push(k);
  }
  return { lost: lost.sort(), gone: gone.sort() };
}

/**
 * A Markdown section listing the digested rows that went away upstream, for the
 * console and the workflow summary; empty when none did.
 *
 * @param {string} title what the rows are ("Motors", "Parts")
 * @param {string[]} gone row keys, as `digestChanges` returns them
 */
export function goneSection(title, gone) {
  if (!gone.length) return '';
  return [
    `### ${title} no longer in the source`,
    '',
    `${gone.length} row keys carried a digest in the previous catalog and are not in this one:`,
    '',
    ...gone.map((k) => `- \`${k}\``),
    '',
  ].join('\n');
}
