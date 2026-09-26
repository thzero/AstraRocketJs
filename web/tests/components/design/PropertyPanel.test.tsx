// @vitest-environment jsdom
import { beforeAll, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { PropertyPanel } from '../../../src/components/design/PropertyPanel';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { serveData } from '../../testing/serveData';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';
import { FIELDS } from '../../../src/services/componentFields';

const show = (node: ComponentNode, extra: { parentRadius?: number } = {}) => {
  const onChange = vi.fn();
  renderWithProviders(
    <PropertyPanel node={node} onChange={onChange} onCommit={() => {}} onRemove={() => {}} {...extra} />,
  );
  return onChange;
};

/**
 * The two design-panel validators that shipped with no way to reach them.
 *
 * `tree/cluster.ts` and `tree/tubefins.ts` both had exported, tested helpers
 * that nothing in the app called — the cluster options list and the tube-fin
 * collision limits. Each is wired into this panel now, and these tests are what
 * stop them going quiet again.
 */
// The panel renders a MaterialPicker, which fetches the material catalog.
beforeAll(serveData);

describe('cluster selection', () => {
  /**
   * `cluster` round-trips through .ork and every view (2D, aft, 3D) already
   * drew the tube at each cluster offset — but nothing could SET it, so the
   * only way to have a cluster was to import a file that already did.
   */
  it('offers every cluster pattern on a motor mount', () => {
    show({ id: 'm1', type: 'innertube', motorMount: true } as unknown as ComponentNode);
    const sel = screen.getByLabelText('Cluster') as HTMLSelectElement;
    const values = [...sel.options].map((o) => o.value);
    expect(values).toContain('single');
    expect(values).toContain('double');
    expect(values).toContain('9-grid');
  });

  it('labels each pattern with how many motors it holds', () => {
    show({ id: 'm1', type: 'innertube' } as unknown as ComponentNode);
    const sel = screen.getByLabelText('Cluster') as HTMLSelectElement;
    const text = Object.fromEntries([...sel.options].map((o) => [o.value, o.textContent]));
    expect(text.single).toBe('Single');
    expect(text.double).toBe('double (2 motors)');
    expect(text['9-grid']).toBe('9-grid (9 motors)');
  });

  it('writes the chosen pattern to the node', () => {
    const onChange = show({ id: 'm1', type: 'innertube' } as unknown as ComponentNode);
    fireEvent.change(screen.getByLabelText('Cluster'), { target: { value: '4-ring' } });
    expect(onChange).toHaveBeenCalledWith({ cluster: '4-ring' });
  });

  it('shows the stored pattern rather than defaulting the control to single', () => {
    show({ id: 'm1', type: 'innertube', cluster: '3-ring' } as unknown as ComponentNode);
    expect((screen.getByLabelText('Cluster') as HTMLSelectElement).value).toBe('3-ring');
  });
});

describe('tube fin collision warning', () => {
  const tubeFins = (finCount: number, outerRadius: number) =>
    ({ id: 'tf', type: 'tubefinset', finCount, outerRadius, length: 0.1 }) as unknown as ComponentNode;
  const warning = () => screen.queryByText(/tubes overlap/i);

  it('says nothing while the tubes fit', () => {
    // 6 tubes of r=10 mm around a 50 mm body: the touching radius there is
    // 50·sin(30°)/(1−sin(30°)) = 50 mm, so 10 mm is comfortable.
    show(tubeFins(6, 0.01), { parentRadius: 0.05 });
    expect(warning()).toBeNull();
  });

  it('warns once they overlap, and says what does fit', () => {
    // 12 tubes of r=20 mm around the same body cannot physically close.
    show(tubeFins(12, 0.02), { parentRadius: 0.05 });
    const w = warning();
    expect(w).toBeTruthy();
    // Both ways out are offered: fewer tubes, or thinner ones.
    expect(w!.textContent).toMatch(/at most 10 fit/);
    expect(w!.textContent).toMatch(/largest that fits is/);
  });

  it('stays quiet when the body radius is unknown', () => {
    // A tube fin set with no parent radius (not yet attached, or a parent with
    // no radius) must not accuse the user of a collision it cannot check.
    show(tubeFins(12, 0.02));
    expect(warning()).toBeNull();
  });

  it('allows an exactly-touching set', () => {
    // 3 tubes at precisely the touching radius is a legal, if tight, build.
    const s = Math.sin(Math.PI / 3);
    show(tubeFins(3, (0.05 * s) / (1 - s)), { parentRadius: 0.05 });
    expect(warning()).toBeNull();
  });

  it('does not warn on other part types', () => {
    show({ id: 'f1', type: 'trapezoidfinset', finCount: 12 } as unknown as ComponentNode, { parentRadius: 0.05 });
    expect(warning()).toBeNull();
  });
});

/**
 * One name, one place. A part's angle around the body is the same kernel
 * property whatever the part is (`FinSet.getBaseRotation()` returns
 * `getAngleOffset()`), but the panel used to call it "Angle around body" on a
 * lug and "Base rotation" on a fin set, and render both in the middle of the
 * dimension list between a radius and a thickness. It is one label now, in the
 * section that already answers WHERE the part goes.
 */
describe('placement section', () => {
  const placement = () => screen.getByText('Placement').parentElement!;

  it.each(['launchlug', 'railbutton', 'trapezoidfinset', 'ellipticalfinset', 'freeformfinset', 'tubefinset', 'podset'])(
    'puts %s rotation beside its position, under one name',
    (type) => {
      show({ id: 'p1', type } as unknown as ComponentNode);
      const box = within(placement());
      expect(box.getByLabelText('Position from')).toBeTruthy();
      expect(box.getByLabelText('Offset')).toBeTruthy();
      expect(box.getByLabelText('Rotation')).toBeTruthy();
      // The old names are gone from the panel entirely.
      expect(screen.queryByLabelText('Angle around body')).toBeNull();
      expect(screen.queryByLabelText('Base rotation')).toBeNull();
    },
  );

  it('leaves a part with no angle its position rows alone', () => {
    show({ id: 'c1', type: 'centeringring' } as unknown as ComponentNode);
    const box = within(placement());
    expect(box.getByLabelText('Offset')).toBeTruthy();
    expect(box.queryByLabelText('Rotation')).toBeNull();
  });
});

/**
 * Overrides sit at the bottom of every part, without exception.
 *
 * They are not a property of the part the way its dimensions, material and
 * placement are; they override what those add up to. Rendered in the middle,
 * they pushed a lug's placement rows below three rows nobody was looking for,
 * and where they fell varied by type, since a parachute has two sections
 * between them and a body tube has none.
 */
describe('override section placement', () => {
  it.each(Object.keys(FIELDS))('puts the overrides last on a %s', (type) => {
    show({ id: 'o1', type } as unknown as ComponentNode);
    const panel = document.querySelector('section')!;
    const overrides = screen.getByText('Overrides').parentElement!;
    expect(panel.lastElementChild).toBe(overrides);
  });
});

/**
 * The through-the-wall tab is its own section.
 *
 * Its four fields describe a separate piece of the fin, the part buried in the
 * airframe, and they used to run on under the planform where they read as four
 * more dimensions of the same shape: root chord, tip chord, sweep, height,
 * thickness, cant, then fin tab length.
 */
describe('fin tab section', () => {
  const finTab = () => screen.getByText('Fin tab').parentElement!;

  it.each(['trapezoidfinset', 'ellipticalfinset', 'freeformfinset'])('groups the %s tab fields', (type) => {
    show({ id: 'f1', type } as unknown as ComponentNode);
    const box = within(finTab());
    expect(box.getByLabelText('Fin tab length')).toBeTruthy();
    expect(box.getByLabelText('Fin tab height')).toBeTruthy();
    expect(box.getByLabelText('Fin tab offset')).toBeTruthy();
    expect(box.getByLabelText('Fin tab reference')).toBeTruthy();
  });

  it('gives a tube fin set no tab section, since a tube has no tab', () => {
    show({ id: 't1', type: 'tubefinset' } as unknown as ComponentNode);
    expect(screen.queryByText('Fin tab')).toBeNull();
  });
});

/**
 * What a tube does for a MOTOR, as against what the tube is.
 *
 * A body tube's "Motor mount" and "Motor overhang", and an inner tube's
 * cluster with them, used to run on under the radius and thickness as though
 * they were three more dimensions of the tube.
 */
describe('motor section', () => {
  const motor = () => screen.getByText('Motor').parentElement!;

  it("groups an inner tube's mount, overhang and cluster", () => {
    show({ id: 'm1', type: 'innertube' } as unknown as ComponentNode);
    const box = within(motor());
    expect(box.getByLabelText('Motor mount')).toBeTruthy();
    expect(box.getByLabelText('Motor overhang')).toBeTruthy();
    expect(box.getByLabelText('Cluster')).toBeTruthy();
  });

  it('gives a body tube the same section, without a cluster', () => {
    show({ id: 'b1', type: 'bodytube' } as unknown as ComponentNode);
    const box = within(motor());
    expect(box.getByLabelText('Motor mount')).toBeTruthy();
    expect(box.queryByLabelText('Cluster')).toBeNull();
  });

  it('gives a tube that never holds a motor no section at all', () => {
    show({ id: 'c1', type: 'tubecoupler' } as unknown as ComponentNode);
    expect(screen.queryByText('Motor')).toBeNull();
  });
});

/**
 * The name and the catalog picker are one section: they answer what the part
 * IS, as against its dimensions. They are also the only rows the panel builds
 * itself rather than declaring in FIELDS, which is why they used to float
 * loose above everything else.
 *
 * Color is NOT one of them. It sits in Appearance, below, because it says how
 * the part is drawn rather than what it is, and nothing about it reaches the
 * simulation.
 */
describe('part section', () => {
  it('holds the name row', () => {
    show({ id: 'b1', type: 'bodytube' } as unknown as ComponentNode);
    const box = within(screen.getByText('Part').parentElement!);
    expect(box.getByLabelText('Name')).toBeTruthy();
    expect(box.queryByLabelText('Color')).toBeNull();
  });

  it('still shows the name on a stage', () => {
    show({ id: 's1', type: 'stage' } as unknown as ComponentNode);
    expect(within(screen.getByText('Part').parentElement!).getByLabelText('Name')).toBeTruthy();
  });
});

/**
 * Appearance: how the part is DRAWN. Second to last on every part, directly
 * above Overrides, for the same reason Overrides is last - it is read far less
 * often than anything describing the part.
 */
describe('appearance section', () => {
  const headings = () => [...document.querySelectorAll('h3')].map((h) => (h.textContent ?? '').trim()).filter(Boolean);

  it('holds the color row', () => {
    show({ id: 'b1', type: 'bodytube' } as unknown as ComponentNode);
    expect(within(screen.getByText('Appearance').parentElement!).getByLabelText('Color')).toBeTruthy();
  });

  it('sits directly above Overrides, on every part type that has one', () => {
    for (const type of ['nosecone', 'bodytube', 'trapezoidfinset', 'parachute', 'launchlug', 'bulkhead']) {
      cleanup();
      show({ id: 'x', type } as unknown as ComponentNode);
      const h = headings();
      const appearance = h.indexOf('Appearance');
      const overrides = h.indexOf('Overrides');
      expect(appearance, `${type} has no Appearance section`).toBeGreaterThanOrEqual(0);
      expect(overrides, `${type} has no Overrides section`).toBeGreaterThanOrEqual(0);
      expect(overrides - appearance, `${type} order: ${h.join(' | ')}`).toBe(1);
    }
  });

  it('is absent on a stage, which has no color of its own', () => {
    show({ id: 's1', type: 'stage' } as unknown as ComponentNode);
    expect(screen.queryByText('Appearance')).toBeNull();
    expect(screen.queryByLabelText('Color')).toBeNull();
  });
});

/**
 * Fin fillets are editable, and only offer a material once there is a bead.
 *
 * Before, nothing in the app could set one: the value round-tripped through
 * `.ork` and was scaled with the rocket, but there was no field, and the
 * engine bridge never handed it to the kernel either. See the fillet cases in
 * `engine/engineBoundary.test.ts` for the half that makes this one worth
 * having — a field that changed the file and nothing else would pass here.
 */
describe('fin fillet', () => {
  const fillet = () => screen.getByText('Fillet').parentElement!;

  it.each(['trapezoidfinset', 'ellipticalfinset', 'freeformfinset'])('offers %s a fillet radius', (type) => {
    show({ id: 'f1', type } as unknown as ComponentNode);
    expect(within(fillet()).getByLabelText('Fillet radius')).toBeTruthy();
  });

  it("writes the radius in meters from the field's unit", () => {
    const onChange = show({ id: 'f1', type: 'trapezoidfinset' } as unknown as ComponentNode);
    const box = screen.getByLabelText('Fillet radius');
    fireEvent.change(box, { target: { value: '6' } });
    // The default length unit is cm (prefs/units.ts:187) and the tree is
    // always SI, so a typed 6 has to land as 0.06 m and not as 6.
    expect(onChange).toHaveBeenCalledWith({ filletRadius: 0.06 });
  });

  it('shows the material whether or not a radius has been typed yet', () => {
    // It used to appear only once the radius was non-zero, which hid it: you
    // cannot find a control that is not on the screen, and which of the two
    // rows you fill first is the builder's choice, not the panel's.
    show({ id: 'f1', type: 'trapezoidfinset' } as unknown as ComponentNode);
    expect(within(fillet()).getByText('Fillet material')).toBeTruthy();
    show({ id: 'f2', type: 'trapezoidfinset', filletRadius: 0.006 } as unknown as ComponentNode);
    expect(screen.getAllByText('Fillet material').length).toBe(2);
  });

  it('gives a tube fin set none: a TubeFinSet is a Tube, so the kernel has no fillet for it', () => {
    show({ id: 't1', type: 'tubefinset' } as unknown as ComponentNode);
    expect(screen.queryByText('Fillet')).toBeNull();
  });
});

/**
 * No dropdown in the panel shows a raw enum value.
 *
 * `DimensionFields` falls back to the option's own value when a select field
 * declares neither `optI18n` nor `optLabel`, and a hand-built select can simply
 * render `{m}`. Both shipped: the nose cone's Shape read `ogive / conical /
 * ellipsoid / ...` and Placement's "Position from" read `top / middle /
 * bottom / absolute`, in lower case, under capitalized and translated labels.
 *
 * `componentFields.options.test.ts` fences off the FIELDS half. It could not
 * see the second one, because that select is written out in PlacementSection
 * rather than declared anywhere. This looks at what is actually RENDERED, so it
 * covers both and anything added later.
 *
 * The rule is narrow on purpose: an option whose text is exactly its own value,
 * where that value is a lower case identifier. A material reads
 * `Plywood (birch) · 630 kg/m³` and a custom one is starred, so neither trips
 * it; `ogive` and `bottom` do.
 */
describe('dropdown options', () => {
  /** The unit choosers, whose options are unit SYMBOLS (`in`, `ft`, `cm`) and
   *  are lower case because that is what those units are called. It is the only
   *  titled select in the panel, and the assertion below re-checks that rather
   *  than trusting it. */
  const isUnitChip = (s: HTMLSelectElement) => /^(Change the unit for this field|This field only)/.test(s.title);

  const rawOptions = () =>
    [...document.querySelectorAll('select')]
      .filter((s) => !isUnitChip(s))
      .flatMap((s) => [...s.querySelectorAll('option')])
      .filter((o) => /^[a-z][a-z0-9_]*$/.test(o.value) && (o.textContent ?? '').trim() === o.value)
      .map((o) => o.value);

  it.each(Object.keys(FIELDS))('are all labeled on a %s', (type) => {
    // parentRadius so the nested parts render their Placement section, which is
    // where the one this test was written for lives.
    show({ id: 'x', type } as unknown as ComponentNode, { parentRadius: 0.013 });
    expect(rawOptions()).toEqual([]);
  });

  it('excludes nothing but the unit choosers', () => {
    // The filter above is the only way this test can be wrong in the quiet
    // direction, so it is checked: a titled select that is NOT a unit chip
    // would be skipped without anyone knowing.
    show({ id: 'n1', type: 'nosecone' } as unknown as ComponentNode, { parentRadius: 0.013 });
    const titled = [...document.querySelectorAll('select')].filter((s) => s.title);
    expect(titled.length).toBeGreaterThan(0);
    for (const s of titled) expect(isUnitChip(s), `titled select: ${s.title}`).toBe(true);
  });
});
