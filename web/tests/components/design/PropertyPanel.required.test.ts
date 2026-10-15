import { describe, it, expect } from 'vitest';
import { FIELDS } from '../../../src/services/design/componentFields';
import { REQUIRED_COMPONENT_FIELDS } from '../../../src/services/design/requiredComponent';

const req = (type: string) =>
  (FIELDS[type] ?? [])
    .filter((f) => f.required)
    .map((f) => f.key)
    .sort();

const keys = (type: string) => (FIELDS[type] ?? []).map((f) => f.key);

/**
 * Which component values the panel marks required: exactly the ones the run
 * refuses, which are the ones the kernel cannot fly
 * (requiredComponent.kernel.test.ts flies each one at 0).
 */
describe('required component fields', () => {
  it('marks each field the run refuses, and no other', () => {
    for (const type of Object.keys(FIELDS)) {
      expect(req(type), type).toEqual([...(REQUIRED_COMPONENT_FIELDS[type] ?? [])].sort());
    }
  });

  it('leaves the airframe dimensions the kernel flies at 0 unmarked', () => {
    // A nose cone, body tube or transition of no length, radius or wall builds
    // and flies; the bundled pods example carries a body tube with all three at 0.
    expect(req('nosecone')).toEqual([]);
    expect(req('bodytube')).toEqual([]);
    expect(req('transition')).toEqual([]);
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
      ['masscomponent', 'mass'], // 0 g is desktop's new part, which it flies
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
   * from the motor mount through it, which is what the `.ork` spells `auto` and
   * what `ComponentFactory` leaves the kernel to compute. Marking them would
   * demand a number the design does not need, and would put a red box on every ring
   * in an imported file: read as a missing number, `auto` gets the whole design
   * refused with "a required dimension is zero".
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
