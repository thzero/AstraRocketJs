// @vitest-environment jsdom
import { beforeAll, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { PropertyPanel } from '../../../src/components/design/PropertyPanel';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { serveData } from '../../testing/serveData';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';
import { FIELDS } from '../../../src/services/design/componentFields';

const show = (node: ComponentNode, extra: { parentRadius?: number } = {}) => {
  const onChange = vi.fn();
  renderWithProviders(
    <PropertyPanel node={node} onChange={onChange} onCommit={() => {}} onRemove={() => {}} {...extra} />,
  );
  return onChange;
};

/**
 * The two design-panel validators the panel exposes.
 *
 * `tree/cluster.ts` and `tree/tubefins.ts` export tested helpers (the cluster
 * options list and the tube-fin collision limits). Both are wired into this
 * panel, and these tests check that they stay reachable.
 */
// The panel renders a MaterialPicker, which fetches the material catalog.
beforeAll(serveData);

describe('cluster selection', () => {
  /**
   * `cluster` round-trips through .ork and every view (2D, aft, 3D) draws the
   * tube at each cluster offset, so the panel has to be able to set it; without
   * this control the only way to have a cluster is to import a file that does.
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
 * One name, one place. A part's angle around the body is the same kernel property
 * whatever the part is (`FinSet.getBaseRotation()` returns `getAngleOffset()`), so
 * it carries one label, in the section that answers where the part goes, rather
 * than "Angle around body" on a lug and "Base rotation" on a fin set halfway down
 * the dimension list.
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
      // Neither per-type name appears in the panel.
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
 * Overrides sit at the bottom of every part's description, without exception,
 * and Comment sits below even them.
 *
 * Overrides are not a property of the part the way its dimensions, material and
 * placement are; they override what those add up to. Rendered in the middle,
 * they would push a lug's placement rows below three rows nobody was looking
 * for, and where they fell would vary by type, since a parachute has two
 * sections between them and a body tube has none.
 *
 * Comment is the one section that is not about the part at all (it is a note
 * from the builder), so nothing the panel says about the part may be under it,
 * and no free-text box sits between the part's dimensions and what it is made
 * of.
 */
describe('bottom of the panel', () => {
  /** A section by its heading. Comment cannot be found by text: the section and
   *  its single field carry the same label, so `getByText` sees two. */
  const section = (name: string) =>
    [...document.querySelectorAll('h3')].find((h) => (h.textContent ?? '').trim() === name)?.parentElement ?? null;

  it.each(Object.keys(FIELDS))('ends a %s with the overrides and then the comment', (type) => {
    show({ id: 'o1', type } as unknown as ComponentNode);
    const panel = document.querySelector('section')!;
    const overrides = screen.getByText('Overrides').parentElement!;
    const comment = section('Comment');
    expect(comment, `${type} has no Comment section`).not.toBeNull();
    expect(panel.lastElementChild).toBe(comment);
    expect(comment!.previousElementSibling).toBe(overrides);
  });
});

/**
 * The automatic switch says what it is.
 *
 * With the word only in a `title`, a bare checkbox at the end of the row reads
 * as an unexplained tick, and on a centering ring (which has one on each of its
 * two diameters) as two of them. The accessible name keeps the field's own name
 * in front of the word, so the two rows are still told apart when the page is
 * read aloud.
 */
describe('the automatic switch', () => {
  const switches = () =>
    [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].filter((c) =>
      /: Auto$/.test(c.getAttribute('aria-label') ?? ''),
    );

  it.each([
    ['centeringring', ['Outer diameter: Auto', 'Inner diameter: Auto']],
    ['bulkhead', ['Diameter: Auto']],
    ['tubecoupler', ['Diameter: Auto']],
    ['engineblock', ['Diameter: Auto']],
  ] as const)('gives a %s one per automatic diameter, worded', (type, names) => {
    show({ id: 'a1', type } as unknown as ComponentNode);
    const found = switches();
    expect(found.map((c) => c.getAttribute('aria-label'))).toEqual([...names]);
    for (const c of found) {
      // The word is on the page, in the switch's own label, not only in a title.
      const worded = c.closest('label');
      expect(worded, `${type}: ${c.getAttribute('aria-label')} has no label`).not.toBeNull();
      expect(worded!.textContent?.trim()).toBe('Auto');
      // And that label binds to the switch, not to the number box beside it:
      // one label cannot serve two controls, so the row cannot be a single
      // <label>.
      expect(worded!.querySelectorAll('input').length).toBe(1);
    }
  });

  it('leaves a part with no automatic dimension no switch at all', () => {
    show({ id: 'i1', type: 'innertube' } as unknown as ComponentNode);
    expect(switches()).toEqual([]);
  });
});

/**
 * The through-the-wall tab is its own section.
 *
 * Its four fields describe a separate piece of the fin, the part buried in the
 * airframe. Run on under the planform they read as four more dimensions of the same
 * shape: root chord, tip chord, sweep, height, thickness, cant, then fin tab length.
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
 * What a tube does for a motor, as against what the tube is.
 *
 * A body tube's "Motor mount" and "Motor overhang", and an inner tube's cluster
 * with them, are not three more dimensions of the tube and do not run on under its
 * radius and thickness.
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

  /**
   * And it sits below the material.
   *
   * Everything above it describes the tube itself (its dimensions, then what
   * it is made of), and this is the first section about the job the tube has
   * been given. Between the wall thickness and the material it would split the
   * description of one object in half, and on an inner tube the six cluster
   * rows would push the material picker most of a screen down.
   */
  it.each(['bodytube', 'innertube'])('sits below the material on a %s', (type) => {
    show({ id: 'm1', type } as unknown as ComponentNode);
    // MaterialSection has no heading of its own, so the picker's own label is
    // what marks where it starts.
    const material = screen.getByText('Material');
    const heading = screen.getByText('Motor');
    // Node.DOCUMENT_POSITION_FOLLOWING: the motor heading comes after it.
    expect(material.compareDocumentPosition(heading) & 4).toBe(4);
  });
});

/**
 * The name and the catalog picker are one section: they answer what the part
 * is, as against its dimensions. They are also the only rows the panel builds
 * itself rather than declaring in FIELDS, so without the section they float loose
 * above everything else.
 *
 * Color is not one of them. It sits in Appearance, below, because it says how
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
 * Appearance: how the part is drawn. Second to last on every part, directly
 * above Overrides, for the same reason Overrides is last: it is read far less
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
 * The value round-trips through `.ork`, is scaled with the rocket, and the
 * engine bridge hands it to the kernel. See the fillet cases in
 * `engine/engineBoundary.test.ts` for the half that makes this one worth
 * having: a field that changed the file and nothing else would pass here.
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
    // The default length unit is cm (prefs/units.ts) and the tree is
    // always SI, so a typed 6 has to land as 0.06 m and not as 6.
    expect(onChange).toHaveBeenCalledWith({ filletRadius: 0.06 });
  });

  it('shows the material whether or not a radius has been typed yet', () => {
    // Shown whatever the radius: a control gated on a non-zero radius cannot be
    // found on the screen, and which of the two rows the builder fills first is
    // their choice, not the panel's.
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
 * render `{m}`. Either way the nose cone's Shape would read `ogive / conical /
 * ellipsoid / ...` or Placement's "Position from" `top / middle / bottom /
 * absolute`, in lower case, under capitalized and translated labels.
 *
 * `componentFields.options.test.ts` fences off the FIELDS half. It cannot see
 * the second, because that select is written out in PlacementSection rather
 * than declared anywhere. This looks at what is actually rendered, so it covers
 * both and anything added later.
 *
 * The rule is narrow on purpose: an option whose text is exactly its own value,
 * where that value is a lower case identifier. A material reads
 * `Plywood (birch) · 630 kg/m³` and a custom one is starred, so neither trips
 * it; `ogive` and `bottom` do.
 */
describe('dropdown options', () => {
  /** The unit choosers, whose options are unit symbols (`in`, `ft`, `cm`) and
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
    // parentRadius so the nested parts render their Placement section, which
    // holds the hand-built "Position from" select.
    show({ id: 'x', type } as unknown as ComponentNode, { parentRadius: 0.013 });
    expect(rawOptions()).toEqual([]);
  });

  it('excludes nothing but the unit choosers', () => {
    // The filter above is the only way this test can be wrong in the quiet
    // direction, so it is checked: a titled select that is not a unit chip
    // would be skipped without anyone knowing.
    show({ id: 'n1', type: 'nosecone' } as unknown as ComponentNode, { parentRadius: 0.013 });
    const titled = [...document.querySelectorAll('select')].filter((s) => s.title);
    expect(titled.length).toBeGreaterThan(0);
    for (const s of titled) expect(isUnitChip(s), `titled select: ${s.title}`).toBe(true);
  });
});
