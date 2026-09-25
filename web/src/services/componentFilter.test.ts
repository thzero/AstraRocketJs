import { describe, it, expect } from 'vitest';
import { readData } from '../testing/dataDir';
import {
  DEFAULT_CHUTE_CD,
  boreClears,
  materialFamilies,
  materialFamily,
  noseShapes,
  describeNotes,
  emptyQuery,
  fitRuleFor,
  fitScore,
  manufacturers,
  odBounds,
  queryComponents,
  queryIsEmpty,
  type ComponentQuery,
  type FitContext,
} from './componentFilter';
import { isComponentRow, type BodyTubeComponent, type Component, type TubeComponent } from './componentDb';

/**
 * The shipped catalog, read off disk, so the fit rules are checked against the
 * numbers real manufacturers publish rather than against tidy invented ones.
 * The point of the ranking is that catalog diameters do NOT line up exactly:
 * five couplers fit a 51.51 mm bore and they sit between 50.65 and 50.80 mm.
 */
const catalog: Component[] = readData<{ components: unknown[] }>('components.generated.json').components.filter(
  isComponentRow,
);

const ofType = <T extends Component['type']>(t: T) =>
  catalog.filter((p): p is Extract<Component, { type: T }> => p.type === t);

const byPartNo = (pn: string) => {
  const hit = catalog.find((p) => p.partNo === pn);
  if (!hit) throw new Error(`catalog no longer has ${pn}; pick another anchor`);
  return hit;
};

const q = (over: Partial<ComponentQuery> = {}): ComponentQuery => ({ ...emptyQuery, ...over });

describe('the catalog this file is anchored to', () => {
  it('still has rows of every type', () => {
    expect(catalog.length).toBeGreaterThan(2000);
    for (const t of ['bodytube', 'nosecone', 'centeringring', 'tubecoupler', 'parachute', 'bulkhead'] as const)
      expect(ofType(t).length).toBeGreaterThan(50);
  });
});

describe('describeNotes', () => {
  // Every expectation below is the SECOND line of a picker row. The numbers it
  // drops are the ones the columns now carry, and what survives is the part of
  // the description that is nowhere else.
  it('drops what the columns already say and keeps what only the prose has', () => {
    const cases: [partNo: string, desc: string, notes: string][] = [
      // Trade name and role survive; the bore/OD pair and the length do not.
      ['BT_1.15_12_MMT', 'Blue Tube, 1.15"/29mm, MMT, 12" len', 'Blue Tube · MMT'],
      // "Centering ring" names the type, and "29mm to 38mm" IS the OD/ID columns.
      ['CR-38/29', 'Centering ring, plywood, 29mm to 38mm, .25"', 'plywood'],
      // The part number is already a column, so `PN ...` is noise.
      ['CHUTE12-N', 'Parachute, nylon, 12 in., 6 lines, PN CHUTE12-N', 'nylon · 6 lines'],
      // `ogive` has a Shape column of its own, so spelling it here is the same
      // duplication as a diameter, and `PN BMS50V2C` is the Part no. column.
      [
        'BMS50V2C',
        'Nose cone, balsa, BT50, ogive, 3.0" long, V2 nose cone, PN BMS50V2C',
        'balsa · BT50 · V2 nose cone',
      ],
      ['PS-2.1', 'Body tube, phenolic, 2.1, piston, 2.0"', 'phenolic · piston'],
    ];
    for (const [partNo, desc, notes] of cases) {
      const p = byPartNo(partNo);
      expect(p.desc, `${partNo} description changed upstream`).toBe(desc);
      expect(describeNotes(p), partNo).toBe(notes);
    }
  });

  it('drops a part number however the description punctuates it', () => {
    // Real catalog rows give the part number unhyphenated in its own field and
    // hyphenated after a `PN` in the prose, so comparing the two literally
    // leaves a copy in the Notes column beside the Part no. column.
    const p = byPartNo('CHUTE12-N');
    expect(describeNotes({ ...p, desc: 'nylon, PN CHUTE-12-N' })).toBe('nylon');
    expect(describeNotes({ ...p, desc: 'nylon, PN CHUTE12N' })).toBe('nylon');
  });

  it('drops a part number spread across the field two different ways', () => {
    // 417 rows put two identifiers in the one part-number field, and the
    // description names them either singly (`PN BNC-20R`) or slash-joined
    // (`PN 30400/30408`). Comparing the whole field literally missed both.
    const p = byPartNo('BNC-20R, 70240');
    expect(describeNotes(p)).not.toContain('PN');
    expect(describeNotes({ ...p, partNo: '30400, 30408', desc: 'paper, PN 30400/30408' })).toBe('paper');
  });

  it('keeps a PN that names an identifier the part-number column does not carry', () => {
    // 90 rows do this, and it is the opposite of a duplicate: the description
    // cites a DIFFERENT code, which is the only place that code appears.
    const p = byPartNo('BNC-20J');
    expect(p.desc).toContain('PN BNC-20L');
    expect(describeNotes(p)).toContain('PN BNC-20L');
  });

  it('does not mistake a unit hiding inside a word for a measurement', () => {
    // `mm` inside MMT and `len` inside "lines" are the two that a naive
    // substring rule eats, and both are signal: MMT says motor mount rather
    // than airframe, and the line count is a real spec.
    expect(describeNotes({ ...byPartNo('BT_1.15_12_MMT'), desc: 'MMT' } as BodyTubeComponent)).toBe('MMT');
    expect(describeNotes({ ...byPartNo('CHUTE12-N'), desc: '6 lines' })).toBe('6 lines');
  });

  it('leaves a row with nothing but measurements empty rather than repeating them', () => {
    expect(describeNotes({ ...byPartNo('PS-2.1'), desc: 'Body tube, 2.0", 24" len' } as BodyTubeComponent)).toBe('');
  });
});

describe('fitRuleFor', () => {
  const fit: FitContext = { parentInner: 0.0515, parentOuter: 0.0546, airframeOuter: [0.0546] };

  it('measures the parts that live inside an airframe against its bore', () => {
    for (const t of ['tubecoupler', 'centeringring', 'bulkhead'] as const)
      expect(fitRuleFor(t, fit)).toEqual({ kind: 'inside', target: 0.0515 });
  });

  it('measures the parts that ARE the airframe against its outer diameter', () => {
    for (const t of ['bodytube', 'nosecone'] as const)
      expect(fitRuleFor(t, fit)).toEqual({ kind: 'match', targets: [0.0546] });
  });

  it('falls back to the airframe already in the design when there is no enclosing body', () => {
    // A body tube dropped straight onto a stage has no parent geometry, but the
    // 54 mm tube already in the rocket is still the size that continues it.
    expect(fitRuleFor('bodytube', { airframeOuter: [0.0546, 0.0663] })).toEqual({
      kind: 'match',
      targets: [0.0546, 0.0663],
    });
  });

  it('abstains rather than guessing', () => {
    // No context at all.
    expect(fitRuleFor('tubecoupler', undefined)).toBeNull();
    // Context that cannot answer THIS type: a bore says nothing about a tube
    // that continues the stack.
    expect(fitRuleFor('bodytube', { parentInner: 0.0515 })).toBeNull();
    // A parachute's fit is packed volume, which the model does not carry.
    expect(fitRuleFor('parachute', fit)).toBeNull();
  });
});

describe('fitScore', () => {
  const inside = { kind: 'inside' as const, target: 0.0515112 };
  const tube = (od: number) => ({ ...byPartNo('PS-2.1'), outerDiameter: od }) as BodyTubeComponent;

  it('scores a snug fit best and rejects one that rattles', () => {
    expect(fitScore(tube(0.0515112), inside)).toBeCloseTo(0, 6); // exact
    expect(fitScore(tube(0.0508), inside)!).toBeCloseTo(0.0007112, 6); // 0.7 mm under, fits
    expect(fitScore(tube(0.048), inside)).toBeNull(); // 3.5 mm under, falls through
  });

  it('allows a hair over the bore but not a real interference', () => {
    expect(fitScore(tube(0.0515412), inside)).not.toBeNull(); // 0.03 mm over
    expect(fitScore(tube(0.053), inside)).toBeNull(); // 1.5 mm over, will not go in
  });

  it('matches an airframe from either side', () => {
    const match = { kind: 'match' as const, targets: [0.0546608] };
    expect(fitScore(tube(0.0546608), match)).toBeCloseTo(0, 6);
    expect(fitScore(tube(0.0546108), match)!).toBeCloseTo(0.00005, 6); // 0.05 mm, nominal rounding
    expect(fitScore(tube(0.0556608), match)).toBeNull(); // 1 mm out: a step, not the same tube
    expect(fitScore(tube(0.0576608), match)).toBeNull(); // 3 mm out
  });

  it('never scores a parachute, which has no outer diameter to measure', () => {
    expect(fitScore(byPartNo('CHUTE12-N'), inside)).toBeNull();
  });
});

describe('boreClears', () => {
  const ring = (id: number | null) => ({ ...byPartNo('CR-38/29'), innerDiameter: id }) as TubeComponent;

  it('rejects a centering ring whose bore is too small for what it centers', () => {
    // A 29 mm ring cannot center a 38 mm motor mount, however well its OD fits.
    expect(boreClears(ring(0.0324866), { mountOuter: 0.0418846 })).toBe(false);
    expect(boreClears(ring(0.0418846), { mountOuter: 0.0418846 })).toBe(true);
  });

  it('says nothing about types that do not ring anything, or when there is no child', () => {
    expect(boreClears(byPartNo('PS-2.1'), { mountOuter: 0.0418846 })).toBe(true);
    expect(boreClears(ring(0.0324866), {})).toBe(true);
  });
});

describe('queryComponents', () => {
  const tubes = ofType('bodytube');
  const couplers = ofType('tubecoupler');

  it('narrows 237 couplers to the handful that fit a real bore', () => {
    // This is the whole point of the feature. The bore is a real Public Missiles
    // 2.1" tube; before this, picking its coupler meant reading 237 rows.
    const fit: FitContext = { parentInner: 0.0515112 };
    const all = queryComponents(couplers, q(), 'tubecoupler', fit);
    const fits = queryComponents(couplers, q({ fitsOnly: true }), 'tubecoupler', fit);
    expect(all.length).toBe(couplers.length);
    expect(fits.length).toBeGreaterThan(0);
    expect(fits.length).toBeLessThan(12);
    // Every survivor is within the band, and they come back best-first.
    for (const r of fits) expect(r.fit).not.toBeNull();
    expect(fits.map((r) => r.fit!)).toEqual([...fits.map((r) => r.fit!)].sort((a, b) => a - b));
  });

  it('puts the fitting parts first without hiding the rest', () => {
    const ranked = queryComponents(couplers, q(), 'tubecoupler', { parentInner: 0.0515112 });
    expect(ranked.length).toBe(couplers.length); // nothing dropped
    expect(ranked[0]!.fit).not.toBeNull(); // best fit leads
    expect(ranked.at(-1)!.fit).toBeNull(); // rows with no score sink
  });

  it('keeps the rows with no score last even when the sort is reversed', () => {
    // They are not "the worst fit", they are absent from the ranking, so
    // flipping the arrow must not float them to the top.
    const desc = queryComponents(couplers, q({ dir: -1 }), 'tubecoupler', { parentInner: 0.0515112 });
    expect(desc[0]!.fit).not.toBeNull();
    expect(desc.at(-1)!.fit).toBeNull();
  });

  it('ANDs free-text terms across manufacturer, part number and description', () => {
    const hits = queryComponents(tubes, q({ text: 'blue tube mmt' }), 'bodytube');
    expect(hits.length).toBeGreaterThan(0);
    for (const { part } of hits) {
      const hay = `${part.mfr} ${part.partNo} ${part.desc}`.toLowerCase();
      for (const term of ['blue', 'tube', 'mmt']) expect(hay).toContain(term);
    }
  });

  it('filters by manufacturer exactly', () => {
    const hits = queryComponents(tubes, q({ mfr: 'Estes' }), 'bodytube');
    expect(hits.length).toBeGreaterThan(0);
    expect(new Set(hits.map((r) => r.part.mfr))).toEqual(new Set(['Estes']));
  });

  it('filters by outer-diameter bounds, inclusive', () => {
    const hits = queryComponents(tubes, q({ odMin: 0.05, odMax: 0.06 }), 'bodytube');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThan(tubes.length);
    for (const { part } of hits) {
      expect(part.outerDiameter).toBeGreaterThanOrEqual(0.05);
      expect(part.outerDiameter).toBeLessThanOrEqual(0.06);
    }
  });

  it('sorts by each dimension, both ways', () => {
    for (const key of ['od', 'id', 'length'] as const) {
      const up = queryComponents(tubes, q({ sort: key }), 'bodytube').map((r) =>
        key === 'od' ? r.part.outerDiameter : key === 'id' ? r.part.innerDiameter : r.part.length,
      );
      const down = queryComponents(tubes, q({ sort: key, dir: -1 }), 'bodytube').map((r) =>
        key === 'od' ? r.part.outerDiameter : key === 'id' ? r.part.innerDiameter : r.part.length,
      );
      const nums = (xs: (number | null)[]) => xs.filter((x): x is number => x != null);
      expect(nums(up), key).toEqual([...nums(up)].sort((a, b) => a - b));
      expect(nums(down), key).toEqual([...nums(down)].sort((a, b) => b - a));
    }
  });

  it('sorts by manufacturer and part number as text', () => {
    const mfrs = queryComponents(tubes, q({ sort: 'mfr' }), 'bodytube').map((r) => r.part.mfr.toLowerCase());
    expect(mfrs).toEqual([...mfrs].sort((a, b) => a.localeCompare(b)));
  });

  it('returns every match, leaving any capping to the caller', () => {
    // The old picker sliced to 300 and then reported 300 as the total, so a
    // 1088-row type read as though the catalog were small.
    expect(queryComponents(tubes, q(), 'bodytube').length).toBe(tubes.length);
    expect(tubes.length).toBeGreaterThan(300);
  });
});

describe('materialFamily', () => {
  it('files every material in the shipped catalog, with nothing left over', () => {
    // The facet is only usable because the raw names collapse. If a sync brings
    // in a material no rule matches, it would silently drop out of the facet, so
    // this is the assertion that makes that loud.
    const unmatched = catalog.filter((p) => 'material' in p && p.material && materialFamily(p) === null);
    expect(unmatched.map((p) => ('material' in p ? p.material : ''))).toEqual([]);
  });

  it('collapses the near-duplicate names that made a raw-name filter useless', () => {
    // Body tubes carry 39 distinct material names, including eight variants of
    // vulcanized fiber and three spellings of one balsa density.
    const tubes = ofType('bodytube');
    const raw = new Set(tubes.map((p) => p.material));
    expect(raw.size).toBeGreaterThan(30);
    expect(materialFamilies(tubes).length).toBeLessThan(10);
  });

  it('reads the family from the material, not from the leading word', () => {
    // These are the three the ordering exists for: both composites contain the
    // word "fiber", and a glassed phenolic is a phenolic.
    const of = (name: string) => materialFamily({ ...byPartNo('PS-2.1'), material: name } as Component);
    expect(of('Fiberglass, G12, filament wound tube, bulk')).toBe('Fiberglass');
    expect(of('Carbon fiber epoxy composite, filament wound, bulk')).toBe('Carbon fiber');
    expect(of('PML glassed phenolic')).toBe('Phenolic');
    expect(of('Vulcanized Fiber')).toBe('Fiber');
    expect(of('Aircraft plywood (Birch)')).toBe('Plywood');
    expect(of('Birch')).toBe('Birch');
  });

  it('has no family for a part that carries no material', () => {
    expect(materialFamily(byPartNo('CHUTE12-N'))).toBeNull();
  });
});

describe('the material and shape facets', () => {
  it('filters body tubes by material family', () => {
    const tubes = ofType('bodytube');
    const hits = queryComponents(tubes, q({ material: 'Fiberglass' }), 'bodytube');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThan(tubes.length);
    for (const { part } of hits) expect(materialFamily(part)).toBe('Fiberglass');
  });

  it('filters nose cones by shape', () => {
    const cones = ofType('nosecone');
    const hits = queryComponents(cones, q({ shape: 'ogive' }), 'nosecone');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThan(cones.length);
    for (const { part } of hits) expect(part.shape).toBe('ogive');
  });

  it('offers only the shapes and families this type actually has', () => {
    // A dropdown that lists a value returning nothing is worse than no dropdown.
    expect(noseShapes(ofType('nosecone')).length).toBeGreaterThan(1);
    expect(noseShapes(ofType('bodytube'))).toEqual([]); // no shape control there
    const ringFamilies = materialFamilies(ofType('centeringring'));
    const tubeFamilies = materialFamilies(ofType('bodytube'));
    expect(ringFamilies).not.toEqual(tubeFamilies);
    for (const f of ringFamilies)
      expect(queryComponents(ofType('centeringring'), q({ material: f }), 'centeringring').length).toBeGreaterThan(0);
  });

  it('shape narrows nothing on a type that has none', () => {
    // The control is not rendered for other types, but the query must not filter
    // every row away if a stale shape is still set when the type changes.
    expect(queryComponents(ofType('bodytube'), q({ shape: 'ogive' }), 'bodytube')).toEqual([]);
  });

  it('still finds a specific grade by name, which the family hides', () => {
    // `Fiberglass` groups G10 and G12, which are not the same thing to build
    // with, so the material joins the free-text haystack.
    const g12 = queryComponents(ofType('bodytube'), q({ text: 'g12' }), 'bodytube');
    expect(g12.length).toBeGreaterThan(0);
    for (const { part } of g12) expect(part.material).toContain('G12');
  });
});

describe('sorting the columns that were not sortable', () => {
  it('sorts nose cones by shape', () => {
    const cones = ofType('nosecone');
    const shapes = queryComponents(cones, q({ sort: 'shape' }), 'nosecone').map((r) => r.part.shape);
    expect(new Set(shapes).size).toBeGreaterThan(1);
    expect(shapes).toEqual([...shapes].sort((a, b) => a.localeCompare(b)));
    const down = queryComponents(cones, q({ sort: 'shape', dir: -1 }), 'nosecone').map((r) => r.part.shape);
    expect(down).toEqual([...down].sort((a, b) => b.localeCompare(a)));
  });

  it('sorts parachutes by drag coefficient, using the default the picker applies', () => {
    const chutes = ofType('parachute');
    const cds = queryComponents(chutes, q({ sort: 'cd' }), 'parachute').map((r) => r.part.cd ?? DEFAULT_CHUTE_CD);
    expect(cds).toEqual([...cds].sort((a, b) => a - b));
  });

  it('leaves a shape sort alone on a type that has no shape', () => {
    // Every value is null, so the order must simply not change or throw.
    const tubes = ofType('bodytube');
    expect(queryComponents(tubes, q({ sort: 'shape' }), 'bodytube').length).toBe(tubes.length);
  });
});

describe('the catalog has no drag coefficients to filter by', () => {
  it('ships a null Cd for every parachute, which is why there is no Cd facet', () => {
    // OpenRocket's preset files carry no DragCoefficient for a parachute, so all
    // 151 rows are null and the picker applies its own default. A Cd filter would
    // offer exactly one value and narrow nothing; this is the assertion that says
    // so, and that will fail the day upstream starts publishing them.
    const chutes = ofType('parachute');
    expect(chutes.length).toBeGreaterThan(100);
    expect(chutes.filter((p) => p.cd != null)).toEqual([]);
  });
});

describe('an inner tube is served by the body tubes', () => {
  it('abstains from a fit rule, because the motor it has to take is not in the tree', () => {
    // Not an oversight: scoring an inner tube's OUTER diameter against the
    // enclosing bore would rank a snug 51 mm sleeve above the 29 mm mount wanted.
    expect(fitRuleFor('innertube', { parentInner: 0.0515112, parentOuter: 0.0546608 })).toBeNull();
  });

  it('reaches the motor mount tubes the catalog files as body tubes', () => {
    // 51 body tube rows are explicitly motor mount tubes.
    const mmt = queryComponents(ofType('bodytube'), q({ text: 'mmt' }), 'innertube');
    expect(mmt.length).toBeGreaterThan(10);
    for (const { part } of mmt) expect(`${part.partNo} ${part.desc}`.toLowerCase()).toContain('mmt');
  });
});

describe('facets', () => {
  it('lists manufacturers alphabetically, deduplicated', () => {
    const ms = manufacturers(ofType('bodytube'));
    expect(ms.length).toBeGreaterThan(5);
    expect(ms).toEqual([...new Set(ms)]);
    expect(ms).toEqual([...ms].sort((a, b) => a.localeCompare(b)));
  });

  it('reports the outer-diameter span, and nothing for an empty list', () => {
    const b = odBounds(ofType('bodytube'))!;
    expect(b.min).toBeGreaterThan(0);
    expect(b.max).toBeGreaterThan(b.min);
    expect(odBounds([])).toBeNull();
  });

  it('knows when nothing is narrowing the list', () => {
    expect(queryIsEmpty(emptyQuery)).toBe(true);
    // Sort is not a filter: changing it must not light up a "clear filters"
    // affordance, because there is nothing to clear.
    expect(queryIsEmpty(q({ sort: 'od', dir: -1 }))).toBe(true);
    expect(queryIsEmpty(q({ text: '  ' }))).toBe(true);
    for (const over of [
      { text: 'bt' },
      { mfr: 'Estes' },
      { material: 'Paper' },
      { shape: 'ogive' },
      { odMin: 0.05 },
      { odMax: 0.05 },
      { fitsOnly: true },
    ])
      expect(queryIsEmpty(q(over)), JSON.stringify(over)).toBe(false);
  });
});
