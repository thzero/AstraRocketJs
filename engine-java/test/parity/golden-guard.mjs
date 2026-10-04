#!/usr/bin/env node
/**
 * Reports which golden values a pull request moved. It never fails.
 *
 * `npm run parity:golden` re-records every reference value, and parity.mjs says
 * how many moved, but only on the machine that ran it. This puts the same list
 * where the change is reviewed: the job summary of the pull request. Only the
 * VALUES are compared, never the header, so a re-record that moved nothing (a new
 * timestamp or platform line) reports nothing.
 *
 *   node test/parity/golden-guard.mjs <base-ref>
 *
 * The base comes from the pull request (github.base_ref). The checkout needs the
 * full history (fetch-depth: 0) so the base copy can be read.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

// Relative to the repository root, which is where both reads below resolve it.
const GOLDEN = 'engine-java/test/parity/golden.txt';

const [base] = process.argv.slice(2);
if (!base) {
  console.error('usage: node test/parity/golden-guard.mjs <base-ref>');
  process.exit(2);
}

const values = (text) => text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l && !l.startsWith('#'));

let before = [];
try {
  before = values(execFileSync('git', ['show', `origin/${base}:${GOLDEN}`], { encoding: 'utf8' }));
} catch {
  console.log('golden: no golden.txt on the base to compare against.');
  process.exit(0);
}
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const after = values(readFileSync(`${root}/${GOLDEN}`, 'utf8'));

const key = (l) => l.split('|')[0];
const was = new Map(before.map((l) => [key(l), l]));
const now = new Map(after.map((l) => [key(l), l]));
const moved = after.filter((l) => was.has(key(l)) && was.get(key(l)) !== l);
const added = after.filter((l) => !was.has(key(l)));
const removed = before.filter((l) => !now.has(key(l)));

if (!moved.length && !added.length && !removed.length) {
  console.log('golden: no reference value changed.');
  process.exit(0);
}

const lines = [
  `### Golden values changed: ${moved.length} moved, ${added.length} added, ${removed.length} removed`,
  '',
  ...moved.map((l) => `- moved \`${key(l)}\``),
  ...added.map((l) => `- added \`${key(l)}\``),
  ...removed.map((l) => `- removed \`${key(l)}\``),
  '',
];
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
