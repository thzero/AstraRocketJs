import { describe, it, expect } from 'vitest';
// @ts-expect-error - a plain .mjs build script helper, no types
import { rankCurves } from '../../../scripts/lib/rankCurves.mjs';

interface File {
  simfileId: string;
  source: string;
  format: string;
  samples: unknown[];
}

const file = (simfileId: string, source: string, format: string, samples: number): File => ({
  simfileId,
  source,
  format,
  samples: Array.from({ length: samples }, () => [0, 0]),
});
const ids = (files: File[]) => (rankCurves(files) as File[]).map((f) => f.simfileId);

/** Every order of `files`, as thrustcurve.org's API might return them. */
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((p) => [x, ...p]));
}

/**
 * The first curve is the default for a flight and sets the motor's loaded mass,
 * so the ranking is the same whatever order the API returns the files in.
 */
describe('rankCurves', () => {
  it('ranks certified, then RASP, then more samples first', () => {
    expect(
      ids([
        file('u', 'user', 'RASP', 90),
        file('m', 'mfr', 'RASP', 10),
        file('cr', 'cert', 'RockSim', 99),
        file('c', 'cert', 'RASP', 20),
        file('c2', 'cert', 'RASP', 40),
      ]),
    ).toEqual(['c2', 'c', 'cr', 'm', 'u']);
  });

  it('breaks a full tie on the file id, so every API order gives one ranking', () => {
    const tied = [file('5f3a', 'cert', 'RASP', 30), file('1b07', 'cert', 'RASP', 30), file('9c11', 'cert', 'RASP', 30)];
    for (const order of permutations(tied)) expect(ids(order)).toEqual(['1b07', '5f3a', '9c11']);
  });

  it('leaves the input as it was', () => {
    const files = [file('b', 'cert', 'RASP', 1), file('a', 'cert', 'RASP', 1)];
    rankCurves(files);
    expect(files.map((f) => f.simfileId)).toEqual(['b', 'a']);
  });
});
