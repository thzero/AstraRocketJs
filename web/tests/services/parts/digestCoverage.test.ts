import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  digestChanges,
  goneSection,
  motorProblems,
  partProblems,
  MIN_ROWS,
  // @ts-expect-error - a plain .mjs build script helper, no types
} from '../../../scripts/lib/digestCoverage.mjs';

/**
 * The floors a parts or motor catalog has to meet before the sync scripts write
 * it or the workflow publishes it. A catalog without digests looks fine in the
 * app and breaks every part and motor link a saved .ork carries into desktop
 * OpenRocket, so it has to fail loudly instead.
 */
type Row = { type: string; mfr?: string; partNo?: string; desc?: string; digest?: string };
type Motor = { digests?: unknown[] };

// Each digest names one desktop preset, so every digested row gets its own.
const parts = (type: string, rows: number, digested: number): Row[] =>
  Array.from({ length: rows }, (_, i) => ({ type, ...(i < digested ? { digest: `${type}-${i}` } : {}) }));
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

  // A digest names one desktop preset (ComponentPreset.getDigest, one checksum
  // over one preset's fields). Two rows under one digest make a saved .ork link
  // the second row to the first row's preset, and desktop loads that preset's
  // dimensions over the part. Coverage is full here, so the floors pass; the
  // shared digest alone has to refuse the catalog.
  it('refuse a digest carried by more than one row, however full the coverage', () => {
    const rows = parts('bodytube', 100, 100);
    const shared: Row = { type: 'bodytube', mfr: 'BMS', partNo: 'T5Plus-34', digest: 'bodytube-7' };
    rows[8] = { ...rows[8]!, mfr: 'BMS', partNo: 'T5Plus-34', digest: 'bodytube-7' };
    const problems = partProblems([...rows, shared]) as string[];
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^digest bodytube-7 is carried by 3 rows/);
    expect(problems[0]).toContain('bodytube BMS T5Plus-34');
  });

  it('do not count rows with no digest as sharing one', () => {
    expect(partProblems(parts('bodytube', 100, 95))).toEqual([]);
  });
});

/**
 * The run-to-run guard. The catalogs follow sources we do not control, so a row
 * that went away upstream takes its digest with it and the run goes on; a row
 * that is still there and lost its digest is a broken run and is refused.
 */
describe('the digest comparison with the previous catalog', () => {
  const row = (key: string, digested = true) => ({ key, digested });

  it('passes a digested row removed upstream, and reports it as gone', () => {
    const previous = [row('Estes|C6'), row('Estes|D12'), row('AT|H128')];
    const current = [row('Estes|C6'), row('Estes|D12')];
    expect(digestChanges(previous, current)).toEqual({ lost: [], gone: ['AT|H128'] });
  });

  it('refuses a surviving row that lost its digest', () => {
    const previous = [row('Estes|C6'), row('Estes|D12')];
    const current = [row('Estes|C6'), row('Estes|D12', false)];
    expect(digestChanges(previous, current)).toEqual({ lost: ['Estes|D12'], gone: [] });
  });

  it('passes new rows with or without a digest, and a row that gained one', () => {
    const previous = [row('Estes|C6', false)];
    const current = [row('Estes|C6'), row('Estes|E9', false), row('AT|H128')];
    expect(digestChanges(previous, current)).toEqual({ lost: [], gone: [] });
  });

  it('counts rows per key, so one of two same-key rows going away is not a loss', () => {
    const previous = [row('bodytube|LOC|BT-1'), row('bodytube|LOC|BT-1')];
    expect(digestChanges(previous, [row('bodytube|LOC|BT-1')])).toEqual({ lost: [], gone: ['bodytube|LOC|BT-1'] });
    expect(digestChanges(previous, [row('bodytube|LOC|BT-1'), row('bodytube|LOC|BT-1', false)])).toEqual({
      lost: ['bodytube|LOC|BT-1'],
      gone: [],
    });
  });

  it('lists the gone rows for the job summary, and nothing when none went', () => {
    expect(goneSection('Motors', [])).toBe('');
    const text = goneSection('Motors', ['AT|H128']);
    expect(text).toContain('### Motors no longer in the source');
    expect(text).toContain('- `AT|H128`');
  });
});
