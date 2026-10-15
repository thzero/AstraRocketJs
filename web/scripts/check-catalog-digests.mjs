// Refuses a parts or motor catalog without the digests desktop OpenRocket uses
// to find the same part or motor (lib/digestCoverage.mjs has the floors and why).
//
// The sync workflow runs this before it publishes, so a run that skipped or
// broke a digest step fails instead of publishing. It checks the motor and the
// parts catalog in public/data, refreshed this run or seeded from the data
// branch: those two are what the publish step copies.
//
//   npm run check:digests
//
// Prints the coverage per type, and appends it to the GitHub job summary when
// GITHUB_STEP_SUMMARY is set.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { coverageTable, motorProblems, partProblems } from './lib/digestCoverage.mjs';

const DATA = fileURLToPath(new URL('../public/data/', import.meta.url));
const read = (file) => (existsSync(DATA + file) ? JSON.parse(readFileSync(DATA + file, 'utf8')) : null);

const parts = read('components.generated.json')?.components ?? null;
const motors = read('motors.generated.json');

const problems = [];
if (!parts) problems.push('components.generated.json is missing');
else problems.push(...partProblems(parts));
if (!motors) problems.push('motors.generated.json is missing');
else problems.push(...motorProblems(motors));

const table = coverageTable(parts, motors);
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Catalog digests\n\n${table}\n\n`);
}
if (problems.length) {
  console.error(`\nRefusing these catalogs:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('\nDigest coverage is above every floor.');
