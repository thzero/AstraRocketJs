import { describe, it, expect } from 'vitest';
import type { AeroSweep, ComponentMass } from '../../../src/engine/openRocketEngine';
import {
  altitudeField,
  chartDomain,
  columnMax,
  cpDivisor,
  cpModesFor,
  dragRows,
  dragTotals,
  machTicks,
  massIndex,
  nearestSampleIndex,
  rollRows,
  stabilityRows,
  stackedBands,
  unitDigits,
} from '../../../src/components/canvas/aeroTables';

/** A three-sample sweep with two parts, one of them a fin set. */
const sweep = (): AeroSweep =>
  ({
    machs: [0.1, 0.3, 0.5],
    hasNozzle: false,
    cp: [0.4, 0.42, 0.45],
    cna: [10, 11, 12],
    powerOff: { total: [0.5, 0.6, 0.7], friction: [0.2, 0.2, 0.2], pressure: [0.2, 0.3, 0.4], base: [0.1, 0.1, 0.1] },
    powerOn: { total: [0.5, 0.6, 0.7], friction: [0.2, 0.2, 0.2], pressure: [0.2, 0.3, 0.4], base: [0.1, 0.1, 0.1] },
    components: [
      {
        key: 'k-tube',
        name: '[BodyTube.Body tube]',
        cd: [0.1, 0.1, 0.1],
        cna: [2, 2, 2],
        cp: [0.3, 0.3, 0.3],
        type: 'BodyTube',
      },
      {
        key: 'k-fins',
        name: '[TrapezoidFinSet.Fins]',
        cd: [0.3, 0.4, 0.5],
        cdInstance: [0.1, 0.133, 0.166],
        instances: 3,
        friction: [0.1, 0.1, 0.1],
        pressure: [0.2, 0.3, 0.4],
        base: [0, 0, 0],
        cna: [8, 9, 10],
        cp: [0.5, 0.5, 0.5],
        rollForce: [0, 0, 0],
        rollDamp: [0.01, 0.02, 0.03],
        type: 'TrapezoidFinSet',
      },
      // No normal force: must be dropped from the stability table.
      { key: 'k-lug', name: '[LaunchLug.Lug]', cd: [0.01, 0.01, 0.01], cna: [0, 0, 0], type: 'LaunchLug' },
    ],
  }) as unknown as AeroSweep;

describe('nearestSampleIndex', () => {
  const machs = [0.1, 0.3, 0.5];
  it('snaps to the nearest computed sample', () => {
    expect(nearestSampleIndex(machs, 0.29)).toBe(1);
    expect(nearestSampleIndex(machs, 0.9)).toBe(2);
    expect(nearestSampleIndex(machs, -1)).toBe(0);
  });
  it('breaks a tie toward the lower index', () => {
    // Exact binary fractions, so the two distances really are equal.
    expect(nearestSampleIndex([0.25, 0.75], 0.5)).toBe(0);
  });
  it('is 0 for an empty grid', () => {
    expect(nearestSampleIndex([], 0.3)).toBe(0);
  });
});

describe('dragRows / dragTotals', () => {
  it('sorts the worst offender first and keys rows on the engine id', () => {
    const rows = dragRows(sweep(), 1);
    expect(rows.map((r) => r.key)).toEqual(['k-fins', 'k-tube', 'k-lug']);
    expect(rows[0]!.name).toBe('Fins');
    expect(rows[0]!.instances).toBe(3);
    expect(rows[0]!.cdInstance).toBeCloseTo(0.133);
  });
  it('falls back to the name when the kernel supplies no key', () => {
    const s = sweep();
    delete s.components[0]!.key;
    expect(dragRows(s, 0).find((r) => r.name === 'Body tube')!.key).toBe('[BodyTube.Body tube]');
  });
  it('reports the remainder the components do not account for', () => {
    const t = dragTotals(sweep(), 1);
    expect(t.totalCd).toBe(0.6);
    expect(t.attributed).toBeCloseTo(0.51);
    expect(t.unattributed).toBeCloseTo(0.09);
    expect(t.hasSplit).toBe(true);
    expect(t.hasInstances).toBe(true);
  });
  it('sees no split and no instances on a bare kernel result', () => {
    const s = sweep();
    s.components = [s.components[0]!];
    const t = dragTotals(s, 0);
    expect(t.hasSplit).toBe(false);
    expect(t.hasInstances).toBe(false);
  });
});

describe('stabilityRows', () => {
  const masses: ComponentMass[] = [
    { key: 'k-fins', name: 'Fins', eachMass: 0.01, mass: 0.03, cg: 0.5 },
    // Same name as the tube row but a different key: must not be joined to it.
    { key: 'other', name: 'Body tube', eachMass: 1, mass: 1, cg: 0 },
  ] as ComponentMass[];
  it('joins mass on the stable key, drops parts with no normal force, sorts by CNa', () => {
    const rows = stabilityRows(sweep(), 2, massIndex(masses));
    expect(rows.map((r) => r.key)).toEqual(['k-fins', 'k-tube']);
    expect(rows[0]!.mass?.mass).toBe(0.03);
    expect(rows[1]!.mass).toBeUndefined();
  });
});

describe('rollRows', () => {
  it('keeps fin sets even at zero, and anything with a non-zero coefficient', () => {
    const s = sweep();
    // A tube that somehow damps roll: kept because the number is non-zero.
    s.components[0]!.rollDamp = [0, 0.5, 0];
    const rows = rollRows(s, 1);
    expect(rows.map((r) => r.key)).toEqual(['k-tube', 'k-fins']);
    expect(rollRows(s, 0).map((r) => r.key)).toEqual(['k-fins']);
  });
  it('columnMax is the largest magnitude, 0 when empty', () => {
    expect(columnMax([-3, 2])).toBe(3);
    expect(columnMax([])).toBe(0);
  });
});

describe('chartDomain', () => {
  const machs = [0, 1, 2];
  it('spans the finite extremes with 0 in range and 8% headroom', () => {
    const d = chartDomain([{ name: 'a', color: '#000', values: [1, 3, NaN] }], machs, false);
    expect(d.yMin).toBe(0);
    expect(d.yMax).toBeCloseTo(3 * 1.08);
  });
  it('stacks: the tallest column, negatives floored at 0', () => {
    const d = chartDomain(
      [
        { name: 'a', color: '#000', values: [1, 2, 3] },
        { name: 'b', color: '#111', values: [-5, 2, 1] },
      ],
      machs,
      true,
    );
    expect(d.yMax).toBeCloseTo(4 * 1.08);
  });
  it('gives a unit span to degenerate data', () => {
    const d = chartDomain([{ name: 'a', color: '#000', values: [NaN, NaN, NaN] }], machs, false);
    expect(d.yMax).toBeGreaterThan(d.yMin);
    expect(chartDomain([], machs, false).yMax).toBeGreaterThan(0);
  });
});

describe('stackedBands', () => {
  const id = (v: number) => v;
  it('builds one closed polygon per series on the running sum', () => {
    const bands = stackedBands(
      [
        { name: 'a', color: '#a', values: [1, 1] },
        { name: 'b', color: '#b', values: [2, -9] },
      ],
      [0, 1],
      id,
      id,
    );
    expect(bands).toHaveLength(2);
    expect(bands[0]!.fill).toBe('#a');
    // Top edge of the first band is its own values; the bottom edge is 0.
    expect(bands[0]!.d).toBe('M0.0,1.0 L1.0,1.0 L1.0,0.0 L0.0,0.0 Z');
    // The second band stacks on the first; its negative sample counts as 0.
    expect(bands[1]!.d).toBe('M0.0,3.0 L1.0,1.0 L1.0,1.0 L0.0,1.0 Z');
  });
});

describe('machTicks', () => {
  it('ticks a sweep that ends at 1 in fifths', () => {
    expect(machTicks(0.05, 1)).toEqual([0.05, 0.2, 0.4, 0.6, 0.8, 1]);
  });
  it('ticks whole Mach numbers above 1', () => {
    expect(machTicks(0.05, 3)).toEqual([0.05, 1, 2, 3]);
  });
});

describe('cpModesFor', () => {
  it('offers both percentages when both lengths are positive', () => {
    expect(cpModesFor(1.2, 1.1)).toEqual(['len', 'body', 'aero']);
  });

  it('leaves out a percentage whose denominator is not positive', () => {
    // A mode with no denominator would render meters under a "%" axis label,
    // which is an inert control rather than a disabled one.
    expect(cpModesFor(1.2, 0)).toEqual(['len', 'body']);
    expect(cpModesFor(0, 1.1)).toEqual(['len', 'aero']);
    expect(cpModesFor(0, 0)).toEqual(['len']);
  });

  it('ignores a negative or non-finite length', () => {
    expect(cpModesFor(-1, Number.NaN)).toEqual(['len']);
    expect(cpModesFor(Number.POSITIVE_INFINITY, -0)).toEqual(['len', 'body']);
  });
});

describe('cpDivisor', () => {
  // The two percentages must not share a denominator: `aero` is the
  // aerodynamic length, which is what OpenRocket's PercentageOfLengthUnit
  // divides by, and `body` is the whole airframe. A design with an overhanging
  // part has both, and they differ.
  it('divides by the aerodynamic length for aero and the overall length for body', () => {
    expect(cpDivisor('body', 1.2, 1.1)).toBe(1.2);
    expect(cpDivisor('aero', 1.2, 1.1)).toBe(1.1);
  });

  it('is 0 for the length-unit mode, so the axis stays in length units', () => {
    expect(cpDivisor('len', 1.2, 1.1)).toBe(0);
  });

  it('is 0 when the selected mode has no usable denominator', () => {
    // Falling back beats dividing by zero: a stale selection must not leave the
    // axis claiming a percentage it is not drawing.
    expect(cpDivisor('aero', 1.2, 0)).toBe(0);
    expect(cpDivisor('body', 0, 1.1)).toBe(0);
    expect(cpDivisor('aero', 1.2, Number.NaN)).toBe(0);
  });

  it('turns a CP position into the percentage each mode promises', () => {
    const cp = 0.84;
    expect((cp / cpDivisor('body', 1.2, 1.1)) * 100).toBeCloseTo(70, 6);
    expect((cp / cpDivisor('aero', 1.2, 1.1)) * 100).toBeCloseTo(76.3636, 4);
  });
});

/**
 * The sweep altitude box shows the altitude the sweep is flown at, in every
 * distance unit, and steps by a valid amount.
 */
describe('altitudeField', () => {
  const KM = 1 / 1000;
  const MI = 1 / 1609.344;

  it('shows 1.5 km as 1.5, and flies it at 1500 m', () => {
    const f = altitudeField(KM);
    expect(f.toUi(f.toSi(1.5))).toBe(1.5);
    expect(f.toSi(1.5)).toBeCloseTo(1500, 6);
  });

  it('stores what it shows, so the box and the sweep agree', () => {
    for (const factor of [1, 3.28084, KM, MI]) {
      const f = altitudeField(factor);
      const typed = 1.2345;
      expect(f.toSi(typed) * factor).toBeCloseTo(f.toUi(f.toSi(typed)), 9);
    }
  });

  it('never steps by zero', () => {
    for (const factor of [1, 3.28084, 1.0936, KM, MI]) expect(altitudeField(factor).step).toBeGreaterThan(0);
  });

  it('keeps whole numbers for meters and feet', () => {
    expect(altitudeField(1).toUi(1234.4)).toBe(1234);
    expect(altitudeField(1).step).toBe(500);
  });
});

describe('unitDigits', () => {
  it('resolves 0.1 mm in every length unit', () => {
    expect(unitDigits(1000, 1e-4)).toBe(1); // mm
    expect(unitDigits(100, 1e-4)).toBe(2); // cm
    expect(unitDigits(1, 1e-4)).toBe(4); // m
    expect(unitDigits(1 / 0.0254, 1e-4)).toBe(3); // in
  });
});
