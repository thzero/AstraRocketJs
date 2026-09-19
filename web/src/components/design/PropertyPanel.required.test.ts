import { describe, it, expect } from 'vitest';
import { FIELDS } from './PropertyPanel';

const req = (type: string) =>
  (FIELDS[type] ?? [])
    .filter((f) => f.required)
    .map((f) => f.key)
    .sort();

const keys = (type: string) => (FIELDS[type] ?? []).map((f) => f.key);

/**
 * Which component dimensions a zero makes nonsense of.
 *
 * Marked conservatively on purpose: a wrong mark is a red box on a design that
 * is actually fine, which is worse than no mark at all. This test pins the
 * judgment so a later edit to the field table has to be deliberate about it.
 */
describe('required component fields', () => {
  it('marks the dimensions that define each airframe part', () => {
    expect(req('nosecone')).toEqual(['aftRadius', 'length', 'thickness']);
    expect(req('bodytube')).toEqual(['length', 'outerRadius', 'thickness']);
    expect(req('transition')).toEqual(['aftRadius', 'foreRadius', 'length', 'thickness']);
    // An inner tube is the one piece of inner structure with no automatic
    // radius: it is the motor mount, so its size is the thing being stated.
    expect(req('innertube')).toEqual(['length', 'outerRadius', 'thickness']);
    // The rest take their outer radius from whatever they sit in, so a blank is
    // "the tube I am in" rather than a hole in the design. See below.
    expect(req('tubecoupler')).toEqual(['length', 'thickness']);
    expect(req('engineblock')).toEqual(['length', 'thickness']);
    expect(req('bulkhead')).toEqual(['length']);
  });

  it('marks fin sets by what gives a fin its area', () => {
    expect(req('trapezoidfinset')).toEqual(['finCount', 'height', 'rootChord', 'thickness']);
    expect(req('ellipticalfinset')).toEqual(['finCount', 'height', 'rootChord', 'thickness']);
    // A freeform fin's outline comes from its points, not from chord/height.
    expect(req('freeformfinset')).toEqual(['finCount', 'thickness']);
    expect(req('tubefinset')).toEqual(['finCount', 'length', 'outerRadius', 'thickness']);
  });

  it('marks recovery devices by what makes them slow the rocket', () => {
    expect(req('parachute')).toEqual(['cd', 'diameter']);
    expect(req('streamer')).toEqual(['cd', 'stripLength', 'stripWidth']);
  });

  it('marks the rest', () => {
    expect(req('launchlug')).toEqual(['length', 'outerRadius']);
    expect(req('railbutton')).toEqual(['outerDiameter']);
    expect(req('masscomponent')).toEqual(['mass']);
    expect(req('centeringring')).toEqual(['length']);
    expect(req('podset')).toEqual(['instanceCount']);
    expect(req('parallelstage')).toEqual(['instanceCount']);
  });

  /**
   * The other half of the judgment, and the half a regression would hide: these
   * are all legitimately zero, so marking one would put a red box on a correct
   * design.
   */
  it('leaves the legitimately-zero dimensions alone', () => {
    const optional: [string, string][] = [
      ['trapezoidfinset', 'tipChord'], // 0 is a delta fin
      ['trapezoidfinset', 'sweep'], // 0 is an unswept fin
      ['trapezoidfinset', 'cant'], // 0 is an uncanted fin
      ['trapezoidfinset', 'tabLength'], // 0 is no through-the-wall tab
      ['trapezoidfinset', 'tabHeight'],
      ['trapezoidfinset', 'tabOffset'],
      ['nosecone', 'shoulderLength'], // 0 is no shoulder
      ['nosecone', 'shoulderRadius'],
      ['nosecone', 'shoulderThickness'],
      ['transition', 'foreShoulderLength'],
      ['transition', 'aftShoulderLength'],
      ['bodytube', 'motorOverhang'], // 0 is flush
      ['innertube', 'motorOverhang'],
      ['centeringring', 'innerRadius'], // 0 is a solid disc, which is valid geometry
      ['masscomponent', 'length'], // 0 is a point mass
      ['parachute', 'lineCount'], // 0 declines to model the shroud lines
      ['parachute', 'lineLength'],
      ['parachute', 'deployAltitude'], // 0 unless the trigger is an altitude one
      ['parachute', 'deployDelay'], // 0 is immediate
      ['streamer', 'deployDelay'],
      ['launchlug', 'angleOffset'], // 0 is straight up the side
      ['railbutton', 'angleOffset'],
      ['podset', 'radiusOffset'], // 0 is flush against the parent
      ['podset', 'angleOffset'],
      ['stage', 'separationDelay'], // 0 is immediate
      ['stage', 'separationAltitude'],
    ];
    for (const [type, key] of optional) {
      expect(keys(type), `${type} should still have ${key}`).toContain(key);
      expect(req(type), `${type}.${key} must NOT be required`).not.toContain(key);
    }
  });

  /**
   * The radii OpenRocket derives.
   *
   * Blank does not mean missing on these: inner structure takes its outer radius
   * from the component it sits in, and a centering ring takes its inner radius
   * from the motor mount through it — which is what the `.ork` spells `auto` and
   * what `ComponentFactory` leaves the kernel to compute. Marking them would
   * demand a number the design does not need, and would put a red box on every
   * ring in an imported file, which is exactly what it used to do: the importer
   * read `auto` as a missing number, so the whole design was refused with "a
   * required dimension is zero".
   */
  it('never marks a radius the kernel derives', () => {
    const derived: [string, string][] = [
      ['centeringring', 'outerRadius'],
      ['centeringring', 'innerRadius'],
      ['bulkhead', 'outerRadius'],
      ['engineblock', 'outerRadius'],
      ['tubecoupler', 'outerRadius'],
    ];
    for (const [type, key] of derived) {
      expect(keys(type), `${type} should still offer ${key}`).toContain(key);
      expect(req(type), `${type}.${key} is automatic, not required`).not.toContain(key);
    }
  });

  it('marks nothing on a stage, whose fields are all triggers and delays', () => {
    expect(req('stage')).toEqual([]);
  });

  it('only ever marks numeric fields, since a select always holds a value', () => {
    for (const [type, fields] of Object.entries(FIELDS)) {
      for (const f of fields) {
        if (!f.required) continue;
        expect(f.kind, `${type}.${f.key}`).not.toBe('select');
        expect(f.kind, `${type}.${f.key}`).not.toBe('bool');
      }
    }
  });
});
