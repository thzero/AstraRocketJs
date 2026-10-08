import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { finalizeCurve, finalizeSamples } from '../../../src/services/motors/curveFinalize';

/**
 * Desktop's AbstractMotorLoader.finalizeThrustCurve, plus the later-value rule
 * for a step at one instant: the shape ThrustCurveMotor.Builder.build() takes.
 */
describe('finalizeSamples', () => {
  it('adds a zero point at t = 0 when the curve starts later', () => {
    expect(
      finalizeSamples([
        [0.03, 5],
        [1, 0],
      ]),
    ).toEqual([
      [0, 0],
      [0.03, 5],
      [1, 0],
    ]);
  });

  it('drops the first of two points at t = 0', () => {
    expect(
      finalizeSamples([
        [0, 0],
        [0, 0.016],
        [1, 0],
      ]),
    ).toEqual([
      [0, 0.016],
      [1, 0],
    ]);
  });

  it('drops an exact repeat, and a zero beside the last point', () => {
    expect(
      finalizeSamples([
        [0, 0],
        [0.5, 9],
        [0.5, 9],
        [1, 3],
        [1, 0],
      ]),
    ).toEqual([
      [0, 0],
      [0.5, 9],
      [1, 3],
    ]);
  });

  it('keeps the later thrust of a step at one instant', () => {
    expect(
      finalizeSamples([
        [0, 0],
        [0.03, 40],
        [0.03, 120],
        [1, 0],
      ]),
    ).toEqual([
      [0, 0],
      [0.03, 120],
      [1, 0],
    ]);
  });

  it('carries an extra field with its point', () => {
    const out = finalizeCurve([
      { time: 0.1, thrust: 5, mass: 2 },
      { time: 1, thrust: 0, mass: 1 },
    ]);
    expect(out).toEqual([
      { time: 0, thrust: 0, mass: 2 },
      { time: 0.1, thrust: 5, mass: 2 },
      { time: 1, thrust: 0, mass: 1 },
    ]);
  });
});

describe('every curve in the shipped catalog', () => {
  it('comes out starting at 0 with each time after the last', () => {
    const catalog = JSON.parse(readFileSync(join(__dirname, '../../../public/data/motors.generated.json'), 'utf8')) as {
      manufacturer: string;
      designation: string;
      curves?: { samples: [number, number][] }[];
    }[];
    const bad: string[] = [];
    let n = 0;
    for (const m of catalog)
      for (const c of m.curves ?? []) {
        n++;
        const s = finalizeSamples(c.samples);
        const ok = s[0]![0] === 0 && s.every((p, i) => i === 0 || p[0] > s[i - 1]![0]);
        if (!ok) bad.push(`${m.manufacturer} ${m.designation}`);
      }
    expect(n).toBeGreaterThan(1500);
    expect(bad).toEqual([]);
  });
});
