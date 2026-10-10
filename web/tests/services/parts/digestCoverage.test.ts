import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-expect-error - a plain .mjs build script helper, no types
import { motorProblems, partProblems, MIN_ROWS } from '../../../scripts/lib/digestCoverage.mjs';

/**
 * The floors a parts or motor catalog has to meet before the sync scripts write
 * it or the workflow publishes it. A catalog without digests looks fine in the
 * app and breaks every part and motor link a saved .ork carries into desktop
 * OpenRocket, so it has to fail loudly instead.
 */
type Row = { type: string; digest?: string };
type Motor = { digests?: unknown[] };

const parts = (type: string, rows: number, digested: number): Row[] =>
  Array.from({ length: rows }, (_, i) => ({ type, ...(i < digested ? { digest: `d${i}` } : {}) }));
const motors = (rows: number, digested: number): Motor[] =>
  Array.from({ length: rows }, (_, i) => (i < digested ? { digests: [{}] } : {}));

const data = (file: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../public/data/${file}`, import.meta.url)), 'utf8'));

describe('the digest floors', () => {
  it('pass the committed catalogs', () => {
    expect(partProblems((data('components.generated.json') as { components: Row[] }).components)).toEqual([]);
    expect(motorProblems(data('motors.generated.json') as Motor[])).toEqual([]);
  });

  it('refuse a catalog with no digests, as a skipped digest step leaves it', () => {
    expect(partProblems([...parts('bodytube', 500, 0), ...parts('nosecone', 400, 0)]).length).toBeGreaterThan(0);
    expect(motorProblems(motors(1000, 0))).toHaveLength(1);
  });

  it('refuse one large type that lost its digests while the total still passes', () => {
    const rows = [...parts('bodytube', 1000, 1000), ...parts('launchlug', 100, 10)];
    const problems = partProblems(rows) as string[];
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^launchlug/);
  });

  it('do not hold a type with few rows to the per-type floor', () => {
    expect(partProblems([...parts('bodytube', 1000, 1000), ...parts('railbutton', MIN_ROWS - 1, 0)])).toEqual([]);
  });
});
