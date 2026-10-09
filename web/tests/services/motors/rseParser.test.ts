// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { MAX_RSE_ENGINES, MAX_RSE_SAMPLES, parseRse, removeDelay } from '../../../src/services/motors/rseParser';
import { parseEng, totalImpulse } from '../../../src/services/motors/engParser';
import { samplesToMotorSpec } from '../../../src/services/motors/thrustcurve';

/**
 * `.rse` import, held to `RockSimMotorLoader.java` rather than to itself.
 *
 * Every expectation below names the upstream rule it encodes, because the
 * failure mode this file exists to catch is a port that is internally
 * consistent and disagrees with the kernel: the numbers a `.rse` carries end up
 * as the mass the rocket flies, and nothing downstream would report a mass
 * curve that is merely plausible.
 *
 * jsdom, because the parser uses `DOMParser`: `.rse` is XML, unlike RASP's
 * fixed-column text.
 */

/** A minimal single-motor file, with the attributes upstream requires. */
const rse = (engineAttrs: string, data: string, extra = '') => `<?xml version="1.0" encoding="UTF-8"?>
<engine-database><engine-list>
  <engine ${engineAttrs}>
    ${extra}
    <data>
${data}
    </data>
  </engine>
</engine-list></engine-database>`;

const ATTRS =
  'mfg="Cesaroni" code="J350-14" Type="reloadable" dia="38" len="186" initWt="822" propWt="447" delays="6,8,10"' +
  // Upstream reads an absent auto-calc attribute as "recompute this column",
  // so a fixture that wants its own mass and CG used has to say so. See
  // "recomputes a column when the file does not say either way" below.
  ' auto-calc-mass="0" auto-calc-cg="0"';

/** Four points, thrust rising then falling, with a mass column. */
const DATA = `      <eng-data t="0" f="0" m="447" cg="93"/>
      <eng-data t="0.5" f="400" m="300" cg="90"/>
      <eng-data t="1.0" f="380" m="150" cg="88"/>
      <eng-data t="1.5" f="0" m="0" cg="85"/>`;

describe('removeDelay', () => {
  // AbstractMotorLoader.removeDelay: `.*-([0-9]+|[pP])$`.
  it('strips a trailing numeric or plugged delay, and nothing else', () => {
    expect(removeDelay('J350-14')).toBe('J350');
    expect(removeDelay('J350-P')).toBe('J350');
    expect(removeDelay('J350-p')).toBe('J350');
    expect(removeDelay('J350')).toBe('J350');
    // Not a delay: the hyphen is part of the name.
    expect(removeDelay('AT-J350W')).toBe('AT-J350W');
    expect(removeDelay('K1750-')).toBe('K1750-');
  });
});

describe('parseRse, the header attributes', () => {
  it('reads the specs in the file’s own units, which are the ones stored', () => {
    // Upstream divides all four by 1000 for the SI kernel; CustomMotor is mm
    // and grams, so they are kept as written and converted at the engine
    // boundary instead.
    const [m] = parseRse(rse(ATTRS, DATA));
    expect(m).toMatchObject({
      designation: 'J350',
      manufacturer: 'Cesaroni',
      diameter: 38,
      length: 186,
      totalWeightG: 822,
      propWeightG: 447,
      type: 'reload',
      source: 'rse',
    });
  });

  it('maps every motor type upstream recognizes, and leaves an unknown one absent', () => {
    const typed = (t: string) => parseRse(rse(ATTRS.replace('Type="reloadable"', `Type="${t}"`), DATA))[0]!.type;
    expect(typed('single-use')).toBe('SU');
    expect(typed('reloadable')).toBe('reload');
    // The whole reason this format is worth reading: `.eng` cannot say this.
    expect(typed('hybrid')).toBe('hybrid');
    expect(typed('Hybrid')).toBe('hybrid');
    expect(typed('unknown')).toBeUndefined();
    expect(typed('something else')).toBeUndefined();
  });

  it('classifies by the impulse it computes from the curve', () => {
    const [m] = parseRse(rse(ATTRS, DATA));
    expect(m!.class).toBe('I');
    expect(totalImpulse(m!.samples)).toBeCloseTo(390, 0);
  });

  it('refuses a file missing a required attribute, naming it', () => {
    expect(() => parseRse(rse(ATTRS.replace(' dia="38"', ''), DATA))).toThrow(/diameter/i);
    expect(() => parseRse(rse(ATTRS.replace('mfg="Cesaroni" ', ''), DATA))).toThrow(/manufacturer/i);
    expect(() => parseRse(rse(ATTRS.replace(' code="J350-14"', ''), DATA))).toThrow(/designation/i);
    expect(() => parseRse(rse(ATTRS.replace(' propWt="447"', ''), DATA))).toThrow(/propellant/i);
  });

  it('refuses more propellant than total mass, as upstream does', () => {
    // Otherwise the rocket gains mass as the motor burns, and nothing
    // downstream would report it.
    expect(() => parseRse(rse(ATTRS.replace('propWt="447"', 'propWt="900"'), DATA))).toThrow(/more propellant/i);
  });
});

describe('parseRse, the delays', () => {
  const delaysOf = (raw: string) =>
    parseRse(rse(ATTRS.replace('delays="6,8,10"', `delays="${raw}"`), DATA))[0]!.delayList;

  it('keeps the numeric delays as the catalog spells them', () => {
    expect(delaysOf('6,8,10')).toBe('6,8,10');
  });

  it('reads a delay at or past 90 s as plugged, not as a 90-second delay', () => {
    // RockSimMotorLoader.DELAY_LIMIT.
    expect(delaysOf('90')).toBe('P');
    expect(delaysOf('6,99')).toBe('6,P');
    expect(delaysOf('89')).toBe('89');
  });

  it('reads the written forms of plugged too', () => {
    expect(delaysOf('P')).toBe('P');
    expect(delaysOf('plugged')).toBe('P');
  });

  it('has no delays at all when the file lists none', () => {
    expect(parseRse(rse(ATTRS.replace(' delays="6,8,10"', ''), DATA))[0]!.delayList).toBeUndefined();
  });
});

describe('parseRse, the mass and CG columns', () => {
  it('keeps the measured mass curve, which is why this format is worth reading', () => {
    const [m] = parseRse(rse(ATTRS, DATA));
    expect(m!.massesG).toEqual([447, 300, 150, 0]);
    expect(m!.cgMm).toBe(93);
  });

  it('refuses a negative sample mass, as ThrustCurveMotor does', () => {
    expect(() => parseRse(rse(ATTRS, DATA.replace('m="150"', 'm="-5"')))).toThrow(/negative mass/);
    // A recomputed column is never used, so its values do not matter.
    const auto = ATTRS.replace('auto-calc-mass="0"', 'auto-calc-mass="1"');
    expect(parseRse(rse(auto, DATA.replace('m="150"', 'm="-5"')))[0]!.massesG).toBeUndefined();
  });

  it('drops a column the file asks to have recomputed', () => {
    const auto = parseRse(
      rse(
        ATTRS.replace('auto-calc-mass="0"', 'auto-calc-mass="1"').replace('auto-calc-cg="0"', 'auto-calc-cg="1"'),
        DATA,
      ),
    )[0]!;
    expect(auto.massesG).toBeUndefined();
    expect(auto.cgMm).toBeUndefined();
    // "false" turns it off as well as "0", as upstream.
    const off = parseRse(rse(ATTRS.replace('auto-calc-mass="0"', 'auto-calc-mass="false"'), DATA))[0]!;
    expect(off.massesG).toEqual([447, 300, 150, 0]);
  });

  it('recomputes a column when the file does not say either way', () => {
    // Upstream's default, and a surprising one: `auto-calc-mass` absent means
    // recompute, not "use what is here". A file carrying an `m` column and no
    // flag has that column ignored, by OpenRocket and so by this.
    const silent = parseRse(rse(ATTRS.replace(' auto-calc-mass="0"', '').replace(' auto-calc-cg="0"', ''), DATA))[0]!;
    expect(silent.massesG).toBeUndefined();
    expect(silent.cgMm).toBeUndefined();
  });

  it('drops a HALF-filled column rather than interpolating it', () => {
    const partial = DATA.replace(' m="150"', '');
    const m = parseRse(rse(ATTRS, partial))[0]!;
    expect(m.massesG).toBeUndefined();
    // The CG column is untouched and survives on its own.
    expect(m.cgMm).toBe(93);
  });
});

describe('parseRse, finalizeThrustCurve', () => {
  const timesOf = (data: string) => parseRse(rse(ATTRS, data))[0]!.samples.map((s) => s.time);

  it('prepends a zero-thrust point when the curve does not start at t=0', () => {
    const times = timesOf(`      <eng-data t="0.1" f="100" m="400" cg="90"/>
      <eng-data t="0.5" f="200" m="300" cg="90"/>
      <eng-data t="1.0" f="0" m="0" cg="90"/>`);
    expect(times[0]).toBe(0);
    expect(times).toEqual([0, 0.1, 0.5, 1]);
  });

  it('sorts samples by time, carrying the mass column with them', () => {
    const m = parseRse(
      rse(
        ATTRS,
        `      <eng-data t="1.0" f="380" m="150" cg="88"/>
      <eng-data t="0" f="0" m="447" cg="93"/>
      <eng-data t="0.5" f="400" m="300" cg="90"/>`,
      ),
    )[0]!;
    expect(m.samples.map((s) => s.time)).toEqual([0, 0.5, 1]);
    // The mass that belongs with each time, not the file's original order.
    expect(m.massesG).toEqual([447, 300, 150]);
  });

  it('drops the zero-thrust point when two share t=0', () => {
    expect(
      timesOf(`      <eng-data t="0" f="0" m="447" cg="90"/>
      <eng-data t="0" f="120" m="440" cg="90"/>
      <eng-data t="1.0" f="0" m="0" cg="90"/>`),
    ).toEqual([0, 1]);
  });

  it('drops a point duplicated in BOTH time and thrust (the KBA K1750 case)', () => {
    expect(
      timesOf(`      <eng-data t="0" f="0" m="447" cg="90"/>
      <eng-data t="0.5" f="400" m="300" cg="90"/>
      <eng-data t="0.5" f="400" m="300" cg="90"/>
      <eng-data t="1.0" f="0" m="0" cg="90"/>`),
    ).toEqual([0, 0.5, 1]);
  });

  it('drops the zero of two final points sharing a time', () => {
    const m = parseRse(
      rse(
        ATTRS,
        `      <eng-data t="0" f="0" m="447" cg="90"/>
      <eng-data t="0.5" f="400" m="300" cg="90"/>
      <eng-data t="1.0" f="0" m="10" cg="90"/>
      <eng-data t="1.0" f="50" m="0" cg="90"/>`,
      ),
    )[0]!;
    // Two points at the same time break the interpolation that reads them.
    expect(m.samples.map((s) => s.time)).toEqual([0, 0.5, 1]);
    expect(m.samples[2]!.thrust).toBe(50);
  });
});

describe('parseRse, the file as a whole', () => {
  it('returns every motor in an engine-database file', () => {
    const two = `<?xml version="1.0"?><engine-database><engine-list>
      <engine mfg="A" code="X1" dia="29" len="100" initWt="100" propWt="50"><data>
        <eng-data t="0" f="0"/><eng-data t="1" f="100"/><eng-data t="2" f="0"/>
      </data></engine>
      <engine mfg="A" code="X2" dia="38" len="200" initWt="200" propWt="100"><data>
        <eng-data t="0" f="0"/><eng-data t="1" f="200"/><eng-data t="2" f="0"/>
      </data></engine>
    </engine-list></engine-database>`;
    expect(parseRse(two).map((m) => m.designation)).toEqual(['X1', 'X2']);
  });

  it('refuses text that is not a motor file', () => {
    expect(() => parseRse('<html><body>nope</body></html>')).toThrow(/no <engine>/i);
    expect(() => parseRse('not xml at all')).toThrow(/\.rse/);
  });

  it('refuses a data point with no time or thrust', () => {
    expect(() => parseRse(rse(ATTRS, '      <eng-data f="100" m="1" cg="1"/>'))).toThrow(/time or thrust/i);
  });

  it('refuses a motor with no usable curve', () => {
    expect(() => parseRse(rse(ATTRS, '      <eng-data t="0" f="0" m="1" cg="1"/>'))).toThrow(/no thrust-curve/i);
  });
});

describe('the mass curve that reaches the kernel', () => {
  const tc = {
    motorId: 'x',
    designation: 'J350',
    commonName: 'J350',
    manufacturerAbbrev: 'Cesaroni',
    diameter: 38,
    length: 186,
    totalWeightG: 822,
    propWeightG: 447,
    availability: 'custom' as const,
  };

  it('is the file’s own when it has one', () => {
    const m = parseRse(rse(ATTRS, DATA))[0]!;
    const spec = samplesToMotorSpec(
      tc,
      m.samples,
      0,
      m.cgMm === undefined ? undefined : [[0, m.cgMm / 1000]],
      m.massesG!.map((g) => g / 1000),
    );
    // Grams in the file, kilograms at the boundary.
    expect(spec.masses).toEqual([0.447, 0.3, 0.15, 0]);
    // And the launch CG is the file's, not half the length (0.093 m).
    expect(spec.cgX).toBeCloseTo(0.093, 9);
  });

  it('falls back to half the motor length for CG, as OpenRocket does without one', () => {
    const m = parseRse(rse(ATTRS.replace('auto-calc-cg="0"', 'auto-calc-cg="1"'), DATA))[0]!;
    const spec = samplesToMotorSpec(tc, m.samples, 0, undefined, undefined);
    expect(spec.cgX).toBeCloseTo(0.186 / 2, 9);
  });

  /**
   * The reason `AbstractMotorLoader.calculateMass` is not ported.
   *
   * Upstream reconstructs the mass curve from thrust for a `.rse` that asks
   * for it; `samplesToMotorSpec` already does that for every motor without a
   * mass column. This holds the two descriptions of the same arithmetic to
   * each other, so the omission stays correct if either one moves.
   */
  it('matches upstream’s calculateMass when the file gives no masses', () => {
    const m = parseRse(rse(ATTRS.replace('auto-calc-mass="0"', 'auto-calc-mass="1"'), DATA))[0]!;
    expect(m.massesG).toBeUndefined();
    const spec = samplesToMotorSpec(tc, m.samples, 0);

    // AbstractMotorLoader.calculateMass, transcribed: mass falls from the
    // loaded mass by each interval's impulse, scaled so the whole burn
    // consumes exactly the propellant mass.
    const total = 0.822;
    const prop = 0.447;
    const deltas: number[] = [];
    for (let i = 1; i < m.samples.length; i++) {
      const a = m.samples[i - 1]!;
      const b = m.samples[i]!;
      deltas.push(0.5 * (a.thrust + b.thrust) * (b.time - a.time));
    }
    const scale = prop / deltas.reduce((x, y) => x + y, 0);
    const expected = [total];
    let running = total;
    for (const d of deltas) {
      running = Math.max(0, running - d * scale);
      expected.push(running);
    }

    expect(spec.masses.length).toBe(expected.length);
    spec.masses.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 12));
  });

  it('ignores a mass column that does not match the samples one for one', () => {
    // A column that has to be stretched to fit is a guess wearing the clothes
    // of a measurement, so the reconstruction is used instead.
    const m = parseRse(rse(ATTRS, DATA))[0]!;
    const spec = samplesToMotorSpec(tc, m.samples, 0, undefined, [0.447, 0.3]);
    expect(spec.masses[0]).toBeCloseTo(0.822, 9);
  });
});

describe('.eng import still behaves', () => {
  it('reads a RASP file and marks its source', () => {
    const eng = parseEng('; a comment\nC6 18 70 0-3-5-7 0.0108 0.0242 Estes\n0.0 0.0\n0.5 6.0\n1.0 0.0\n');
    expect(eng).toMatchObject({ designation: 'C6', manufacturer: 'Estes', source: 'eng' });
    // The fields only `.rse` can fill stay empty rather than being invented.
    expect(eng.type).toBeUndefined();
    expect(eng.massesG).toBeUndefined();
    expect(eng.cgMm).toBeUndefined();
  });
});

/**
 * Hostile `.rse`, because this parser is reached with no file picker: `loadOrk`
 * runs it over every `.rse` member an imported `.ork` carried, and that member
 * may be up to the archive's 64 MiB per-entry ceiling. The `.ork` reader caps
 * fin points and shroud lines for exactly this reason; this path needs caps
 * too, or merely opening a shared design could freeze the tab.
 */
describe('the hostile-input caps fire', () => {
  it('refuses a file declaring more motors than MAX_RSE_ENGINES', () => {
    const one = `<engine mfg="A" code="X" dia="29" len="100" initWt="100" propWt="50"><data>
      <eng-data t="0" f="0" m="50" cg="50"/><eng-data t="1" f="10" m="0" cg="50"/>
    </data></engine>`;
    const xml = `<?xml version="1.0"?><engine-database><engine-list>${one.repeat(
      MAX_RSE_ENGINES + 10,
    )}</engine-list></engine-database>`;
    expect(() => parseRse(xml)).toThrow(/more than .* motors/i);
  });

  it('refuses one motor with more data points than MAX_RSE_SAMPLES', () => {
    const rows = '<eng-data t="0" f="1" m="50" cg="50"/>'.repeat(MAX_RSE_SAMPLES + 10);
    expect(() => parseRse(rse(ATTRS, rows))).toThrow(/more than .* data points/i);
  });

  it('still accepts a manufacturer-range file and a long curve', () => {
    const one = `<engine mfg="A" code="X" dia="29" len="100" initWt="100" propWt="50"><data>
      <eng-data t="0" f="0" m="50" cg="50"/><eng-data t="1" f="10" m="0" cg="50"/>
    </data></engine>`;
    const xml = `<?xml version="1.0"?><engine-database><engine-list>${one.repeat(200)}</engine-list></engine-database>`;
    expect(parseRse(xml)).toHaveLength(200);
    // A real curve runs to a few thousand samples; that must still import.
    const rows = Array.from(
      { length: 3000 },
      (_, i) => `<eng-data t="${(i / 1000).toFixed(3)}" f="10" m="${447 - i / 10}" cg="90"/>`,
    ).join('');
    expect(() => parseRse(rse(ATTRS, rows))).not.toThrow();
  });
});
