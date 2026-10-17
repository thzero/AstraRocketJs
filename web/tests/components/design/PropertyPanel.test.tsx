// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { PropertyPanel } from '../../../src/components/design/PropertyPanel';
import { renderWithProviders, seedSettings } from '../../testing/renderWithProviders';
import { SettingsProvider } from '../../../src/state/SettingsProvider';
import { serveData } from '../../testing/serveData';
import { readData } from '../../testing/dataDir';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import type { MaterialRow } from '../../../src/services/materials/materialTypes';
import { FIELDS, PANEL_SCOPE_KEYS } from '../../../src/services/design/componentFields';
import { REQUIRED_COMPONENT_FIELDS } from '../../../src/services/design/requiredComponent';
import { isAxial, updateNode } from '../../../src/services/design/treeEdit';
import { unitScope } from '../../../src/prefs/units';
import { MAX_LINE_COUNT } from '../../../src/tree/nodeProps';
import { shapeSelect } from '../../../src/tree/shapeProfile';
import { useWorkspaceStore, type WorkspaceState } from '../../../src/state/store';

const show = (node: ComponentNode, extra: { parentRadius?: number } = {}) => {
  const onChange = vi.fn();
  renderWithProviders(
    <PropertyPanel node={node} onChange={onChange} onCommit={() => {}} onRemove={() => {}} {...extra} />,
  );
  return onChange;
};

// The panel renders a MaterialPicker, which fetches the material catalog.
beforeAll(serveData);

/**
 * The cluster options list (`tree/cluster.ts`) and the tube-fin collision
 * limits (`tree/tubefins.ts`) are wired into this panel; the next two groups
 * check that they stay reachable.
 */
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
    // 12 tubes of r=20 mm around the same body overlap: the touching radius for
    // 12 is about 17.5 mm.
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

  it("groups an inner tube's mount, overhang, ignition and cluster", () => {
    show({ id: 'm1', type: 'innertube', motorMount: true } as unknown as ComponentNode);
    const box = within(motor());
    expect(box.getByLabelText('Motor mount')).toBeTruthy();
    expect(box.getByLabelText('Motor overhang')).toBeTruthy();
    expect(box.getByLabelText('Ignition at')).toBeTruthy();
    expect(box.getByLabelText('Ignition delay')).toBeTruthy();
    expect(box.getByLabelText('Cluster')).toBeTruthy();
  });

  // Desktop grays them out until the tube is a mount, and the file carries them
  // only for a mount, so off one they would edit nothing.
  it('shows the overhang and ignition only on a motor mount', () => {
    show({ id: 'm1', type: 'innertube' } as unknown as ComponentNode);
    const box = within(motor());
    expect(box.getByLabelText('Motor mount')).toBeTruthy();
    expect(box.queryByLabelText('Motor overhang')).toBeNull();
    expect(box.queryByLabelText('Ignition at')).toBeNull();
    expect(box.queryByLabelText('Ignition delay')).toBeNull();
  });

  it('drops the ignition delay when the mount never ignites', () => {
    show({ id: 'm1', type: 'innertube', motorMount: true, ignitionEvent: 'never' } as unknown as ComponentNode);
    const box = within(motor());
    expect(box.getByLabelText('Ignition at')).toBeTruthy();
    expect(box.queryByLabelText('Ignition delay')).toBeNull();
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

describe('catalog part', () => {
  it('names a preset with no manufacturer by its part number alone', () => {
    show({ id: 'b1', type: 'bodytube', preset: { partNo: 'BT-50' } } as unknown as ComponentNode);
    const part = screen.getByText('BT-50');
    expect(part.getAttribute('title')).toBe('BT-50');
    cleanup();
  });
});

describe('fin cant', () => {
  it.each(['trapezoidfinset', 'ellipticalfinset', 'freeformfinset'])(
    'stops %s at the kernel limit of 15 degrees either way',
    (type) => {
      const onChange = show({ id: 'f1', type } as unknown as ComponentNode);
      const box = screen.getByLabelText('Cant angle');
      fireEvent.change(box, { target: { value: '40' } });
      const last = onChange.mock.calls.at(-1)![0] as { cant: number };
      expect(last.cant).toBeCloseTo((15 * Math.PI) / 180, 12);
      fireEvent.change(box, { target: { value: '-40' } });
      const neg = onChange.mock.calls.at(-1)![0] as { cant: number };
      expect(neg.cant).toBeCloseTo((-15 * Math.PI) / 180, 12);
      cleanup();
    },
  );
});

/**
 * Fin fillets are editable, and the fillet material row is shown whatever the
 * radius.
 *
 * The value round-trips through `.ork`, is scaled with the rocket, and the
 * engine bridge hands it to the kernel. The fillet cases in
 * `engine/engineBoundary.test.ts` check the kernel half: a field that changed
 * the file and nothing else would pass here.
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

/**
 * A length only the kernel resolves. A shock cord on Auto is three times the
 * rocket's length, and the node keeps whatever number it last stored, so the
 * box shows the kernel's figure from the live build, and turning Auto off keeps
 * that figure rather than jumping back to the stored one.
 */
describe('a kernel-resolved automatic length', () => {
  const RESOLVED = 1.8;
  const cordBox = () => screen.getByRole('spinbutton', { name: 'Cord length' }) as HTMLInputElement;

  it('shows the kernel figure while on Auto, and keeps it when Auto is turned off', () => {
    useWorkspaceStore.setState({
      rocket: { componentInfo: () => ({ cordLength: RESOLVED }) } as unknown as WorkspaceState['rocket'],
    });
    try {
      // What the box reads for the resolved length typed in by hand, in whatever unit is on.
      show({ id: 'sc', type: 'shockcord', cordLength: RESOLVED } as unknown as ComponentNode);
      const typed = cordBox().value;
      cleanup();

      const onChange = show({
        id: 'sc',
        type: 'shockcord',
        cordLength: 0.3,
        cordLengthAuto: true,
      } as unknown as ComponentNode);
      expect(cordBox().value).toBe(typed);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Cord length: Auto' }));
      expect(onChange).toHaveBeenCalledWith({ cordLengthAuto: false, cordLength: RESOLVED });
    } finally {
      useWorkspaceStore.setState({ rocket: null });
    }
  });

  /**
   * A streamer on Auto flies the drag coefficient `Streamer.getComponentCD`
   * works out, not the number the node stores, so the box shows the kernel's,
   * and turning Auto off keeps it, as desktop does.
   */
  it("shows a streamer's computed drag coefficient while on Auto, and keeps it when Auto is turned off", () => {
    useWorkspaceStore.setState({
      rocket: { componentInfo: () => ({ cd: 0.104 }) } as unknown as WorkspaceState['rocket'],
    });
    try {
      const onChange = show({ id: 'st', type: 'streamer', cdAuto: true } as unknown as ComponentNode);
      expect(Number((screen.getByRole('spinbutton', { name: 'Drag coeff' }) as HTMLInputElement).value)).toBeCloseTo(
        0.104,
        9,
      );
      fireEvent.click(screen.getByRole('checkbox', { name: 'Drag coeff: Auto' }));
      expect(onChange).toHaveBeenCalledWith({ cdAuto: false, cd: 0.104 });
    } finally {
      useWorkspaceStore.setState({ rocket: null });
    }
  });

  it('reads the kernel once per build, not once per render', () => {
    const componentInfo = vi.fn(() => ({ cordLength: RESOLVED }));
    useWorkspaceStore.setState({ rocket: { componentInfo } as unknown as WorkspaceState['rocket'] });
    try {
      const node = { id: 'sc', type: 'shockcord', cordLength: 0.3, cordLengthAuto: true } as unknown as ComponentNode;
      const { rerender } = renderWithProviders(
        <PropertyPanel node={node} onChange={() => {}} onCommit={() => {}} onRemove={() => {}} />,
      );
      const calls = componentInfo.mock.calls.length;
      expect(calls).toBeGreaterThan(0);
      // An edit to another field re-renders the panel with a new node object.
      for (const name of ['A', 'B', 'C']) {
        rerender(
          <SettingsProvider>
            <PropertyPanel node={{ ...node, name }} onChange={() => {}} onCommit={() => {}} onRemove={() => {}} />
          </SettingsProvider>,
        );
      }
      expect(componentInfo.mock.calls.length).toBe(calls);
    } finally {
      useWorkspaceStore.setState({ rocket: null });
    }
  });
});

/**
 * The kernel clamps a rail button's heights and bore, and a centering ring's
 * radii, against each other. The panel holds each value inside the same range,
 * so what it shows and stores is what flies (linkedDimensions.kernel.test.ts
 * checks the ranges against the kernel itself).
 */
describe('linked dimensions', () => {
  const box = (name: string) => screen.getByRole('spinbutton', { name }) as HTMLInputElement;
  const type = (input: HTMLInputElement, v: number) => {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: String(v) } });
  };

  it('stops a rail button base at the height left by the flange', () => {
    const onChange = show({
      id: 'rb',
      type: 'railbutton',
      outerDiameter: 0.01,
      innerDiameter: 0.006,
      height: 0.01,
      baseHeight: 0.002,
      flangeHeight: 0.002,
    } as unknown as ComponentNode);
    const base = box('Base height');
    expect(Number(base.max)).toBeCloseTo(Number(box('Height').value) * 0.8, 9);
    type(base, Number(box('Height').value) * 10);
    expect(onChange).toHaveBeenLastCalledWith({ baseHeight: 0.008 });
  });

  it('keeps a rail button height at least its base and flange', () => {
    const onChange = show({
      id: 'rb',
      type: 'railbutton',
      height: 0.01,
      baseHeight: 0.003,
      flangeHeight: 0.002,
    } as unknown as ComponentNode);
    type(box('Height'), 0);
    expect(onChange).toHaveBeenLastCalledWith({ height: 0.005 });
  });

  it('keeps a rail button bore inside its outer diameter', () => {
    const onChange = show({ id: 'rb', type: 'railbutton', outerDiameter: 0.01 } as unknown as ComponentNode);
    type(box('Inner diameter'), Number(box('Outer diameter').value) * 2);
    expect(onChange).toHaveBeenLastCalledWith({ innerDiameter: 0.01 });
  });

  it('shows the dimensions a rail button flies at when the node leaves them out', () => {
    show({ id: 'rb', type: 'railbutton' } as unknown as ComponentNode);
    // RailButton(): outer diameter and total height are both 9.7 mm.
    expect(Number(box('Height').value)).toBeGreaterThan(0);
    expect(box('Height').value).toBe(box('Outer diameter').value);
  });

  it('keeps a centering ring bore inside its outer diameter', () => {
    const onChange = show({
      id: 'cr',
      type: 'centeringring',
      outerRadius: 0.02,
      innerRadius: 0.01,
    } as unknown as ComponentNode);
    type(box('Inner diameter'), Number(box('Outer diameter').value) * 3);
    expect(onChange).toHaveBeenLastCalledWith({ innerRadius: 0.02 });
  });
});

describe('bore and profile flags', () => {
  /**
   * The tube dimensions as the panel states them: an outer diameter, an
   * inner diameter, and the wall between them.
   *
   * Two different translations are under test and they run opposite ways. The
   * outer diameter is a stored radius doubled for display and halved on the way
   * back in, so the box and the node hold different numbers for the same
   * dimension. The inner diameter is not stored at all: it is read from the
   * outer radius and the wall, and typing one writes the wall, which is the only
   * one of the three the `.ork` and the kernel actually carry.
   */
  const tube = (): ComponentNode =>
    ({
      id: 'tube',
      type: 'bodytube',
      name: 'Body tube',
      length: 0.2,
      outerRadius: 0.013,
      thickness: 0.0005,
    }) as unknown as ComponentNode;

  const render = (onChange: (p: Partial<ComponentNode>) => void) =>
    renderWithProviders(
      <PropertyPanel node={tube()} onChange={onChange} onRemove={() => {}} canRemove isFirstStage={false} />,
    );

  const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

  describe('a tube states its bore', () => {
    it('shows the outer dimension as a diameter', () => {
      render(vi.fn());
      // 13 mm of stored radius is a 26 mm tube, which is what a tube is called.
      expect(box('Diameter').value).toBe('2.6');
    });

    it('shows the bore the outer radius and the wall leave', () => {
      render(vi.fn());
      // 26 mm across, 0.5 mm of wall each side: 25 mm of usable bore. Nothing in
      // the node says 25; it is the pair of the other two.
      expect(box('Inner diameter').value).toBe('2.5');
    });

    it('writes the WALL when the bore is typed, and leaves the outside alone', () => {
      const onChange = vi.fn();
      render(onChange);

      fireEvent.change(box('Inner diameter'), { target: { value: '2' } });

      // A 20 mm bore in a 26 mm tube is a 3 mm wall. The outer radius is not in
      // the patch at all: what a tube slides into is already decided.
      const patch = onChange.mock.calls[0]![0] as { thickness: number };
      expect(Object.keys(patch)).toEqual(['thickness']);
      expect(patch.thickness).toBeCloseTo(0.003, 9);
    });

    it('will not let the bore swallow the wall', () => {
      const onChange = vi.fn();
      render(onChange);

      fireEvent.change(box('Inner diameter'), { target: { value: '5' } });

      // A bore wider than the tube is not a tube. Clamped at the outer diameter,
      // which is a zero wall (already marked as degenerate on its own row),
      // rather than a negative one, which would flow into the mass, the mesh and
      // the .ork as a number no consumer checks for.
      const patch = onChange.mock.calls[0]![0] as { thickness: number };
      expect(patch.thickness).toBeCloseTo(0, 9);
      expect(patch.thickness).toBeGreaterThanOrEqual(0);
    });

    it('halves a typed outer diameter back into the stored radius', () => {
      const onChange = vi.fn();
      render(onChange);

      fireEvent.change(box('Diameter'), { target: { value: '5' } });

      expect(onChange).toHaveBeenCalledWith({ outerRadius: 0.025 });
    });
  });

  /**
   * A control that cannot do anything must not be offered.
   *
   * `Transition.isClipped()` returns false outright for a shape that is not
   * clippable, so on a conical or ogive transition the clipped flag is read by
   * nothing: not the kernel, not the schematic, not the 3D build. The shape
   * parameter is filtered the same way.
   */
  const transition = (shape: string): ComponentNode =>
    ({
      id: 'tr',
      type: 'transition',
      name: 'Transition',
      shape,
      length: 0.05,
      foreRadius: 0.013,
      aftRadius: 0.019,
      thickness: 0.0005,
    }) as unknown as ComponentNode;

  describe('the clipped-profile flag', () => {
    const render = (shape: string) =>
      renderWithProviders(
        <PropertyPanel
          node={transition(shape)}
          onChange={() => {}}
          onRemove={() => {}}
          canRemove
          isFirstStage={false}
        />,
      );

    it('is offered on a shape that can be clipped', () => {
      render('ellipsoid');
      expect(screen.queryByLabelText('Clipped profile')).not.toBeNull();
    });

    it('is not offered on one that cannot', () => {
      render('conical');
      expect(screen.queryByLabelText('Clipped profile')).toBeNull();
    });
  });

  /**
   * A filled part has no wall and no bore, so neither row is offered: the
   * desktop grays them out, and leaving them here would let you type a
   * thickness the kernel is ignoring.
   */
  describe('the filled flag', () => {
    const tube = (filled: boolean) =>
      ({
        id: 'bt',
        type: 'bodytube',
        name: 'Body tube',
        length: 0.2,
        outerRadius: 0.013,
        thickness: 0.0005,
        filled,
      }) as unknown as ComponentNode;

    const render = (filled: boolean) =>
      renderWithProviders(
        <PropertyPanel node={tube(filled)} onChange={() => {}} onRemove={() => {}} canRemove isFirstStage={false} />,
      );

    it('offers the wall and the bore on a hollow tube', () => {
      render(false);
      expect(screen.queryByLabelText('Thickness')).not.toBeNull();
      expect(screen.queryByLabelText('Inner diameter')).not.toBeNull();
    });

    it('drops both once the part is solid', () => {
      render(true);
      expect(screen.queryByLabelText('Thickness')).toBeNull();
      expect(screen.queryByLabelText('Inner diameter')).toBeNull();
      expect(screen.queryByLabelText('Filled')).not.toBeNull();
    });
  });
});

describe('bulk material', () => {
  const CATALOG = readData<MaterialRow[]>('materials.generated.json');

  /**
   * A bulk material carries its catalog group, which the `.ork` writer puts in
   * the `group` attribute. Picking a new material has to replace the group too,
   * or the part keeps the previous material's category.
   */
  describe('bulk material group', () => {
    const render = (onChange: (p: Partial<ComponentNode>) => void) =>
      renderWithProviders(
        <PropertyPanel
          node={
            {
              id: 'f',
              type: 'trapezoidfinset',
              materialName: 'Balsa',
              density: 170,
              materialGroup: 'Woods',
            } as unknown as ComponentNode
          }
          onChange={onChange}
          onCommit={() => {}}
          onRemove={() => {}}
        />,
      );

    it("writes the chosen material's catalog group", async () => {
      const aluminum = CATALOG.find((m) => m.name === 'Aluminum' && m.type === 'bulk')!;
      const onChange = vi.fn();
      render(onChange);
      const picker = screen.getByLabelText('Material') as HTMLSelectElement;
      await waitFor(() => expect(picker.querySelector('option[value="Aluminum"]')).not.toBeNull());
      fireEvent.change(picker, { target: { value: 'Aluminum' } });
      const patch = onChange.mock.calls.at(-1)![0] as Partial<ComponentNode>;
      expect(patch.materialName).toBe('Aluminum');
      expect(patch.materialGroup).toBe(aluminum.group);
    });

    it('clears the group with the material', async () => {
      const onChange = vi.fn();
      render(onChange);
      const picker = screen.getByLabelText('Material') as HTMLSelectElement;
      await waitFor(() => expect(picker.querySelector('option[value="Aluminum"]')).not.toBeNull());
      fireEvent.change(picker, { target: { value: '__default__' } });
      const patch = onChange.mock.calls.at(-1)![0] as Partial<ComponentNode>;
      expect('materialGroup' in patch).toBe(true);
      expect(patch.materialGroup).toBeUndefined();
    });
  });
});

describe('catalog part link', () => {
  /**
   * Which catalog part a component is, on screen.
   *
   * The picker writes the link (`presetRef`) and the `.ork` writer carries it, so
   * the panel shows it too: otherwise a design built from real Estes parts, the
   * default one included, reads as though every dimension had been typed by hand.
   * The desktop's own config dialog names the preset, which is the whole point of
   * picking one.
   *
   * The last test is the other half of the contract: the link is only true while
   * the dimensions are the part's, so the row has to go when an edit breaks it.
   */

  const nose = (extra: Record<string, unknown> = {}) =>
    ({
      id: 'nose',
      type: 'nosecone',
      shape: 'ogive',
      length: 0.06985,
      aftRadius: 0.0123952,
      thickness: 0.0013,
      ...extra,
    }) as unknown as ComponentNode;

  const LINK = { type: 'nosecone', manufacturer: 'Estes', partNo: 'PNC-50KA' };

  const show = (node: ComponentNode) =>
    renderWithProviders(<PropertyPanel node={node} onChange={vi.fn()} onCommit={() => {}} onRemove={() => {}} />);

  describe('the catalog part a component came from', () => {
    it('names the part and its manufacturer', () => {
      show(nose({ preset: LINK }));
      const row = screen.getByText('Catalog part').parentElement!;
      expect(row.textContent).toContain('PNC-50KA');
      expect(row.textContent).toContain('Estes');
    });

    it('says nothing for a part that was typed rather than picked', () => {
      show(nose());
      expect(screen.queryByText('Catalog part')).toBeNull();
    });

    it('goes away when an edit breaks the link', () => {
      // `breaksPreset` drops the link on an edit whose kernel setter clears it, as
      // a nose cone's length does. The row is driven by the link alone, so this
      // is what a reader sees when they retype a length.
      const tree = { components: [nose({ preset: LINK })] } as unknown as RocketTree;
      const edited = updateNode(tree, 'nose', { length: 0.08 });
      const node = (edited as unknown as { components: ComponentNode[] }).components[0]!;
      expect(node['preset']).toBeUndefined();

      show(node);
      expect(screen.queryByText('Catalog part')).toBeNull();
    });
  });
});

/**
 * A shock cord is weighed by its line material: the bridge flies
 * `lineMaterialName` and `lineDensity`, and the desktop shock cord dialog has a
 * selector for it. Without a picker, a cord's material could not be changed.
 */
describe('shock cord material', () => {
  it('offers the line catalog and writes the choice to the cord', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <PropertyPanel
        node={{ id: 'c', type: 'shockcord', cordLength: 0.5, length: 0.03 } as unknown as ComponentNode}
        onChange={onChange}
        onCommit={() => {}}
        onRemove={() => {}}
      />,
    );
    const picker = screen.getByLabelText('Shock cord material') as HTMLSelectElement;
    await waitFor(() => expect(picker.querySelectorAll('optgroup option').length).toBeGreaterThan(0));
    const choice = picker.querySelector('optgroup option') as HTMLOptionElement;
    fireEvent.change(picker, { target: { value: choice.value } });
    const patch = onChange.mock.calls.at(-1)![0] as { lineMaterialName: string; lineDensity: number };
    expect(patch.lineMaterialName).toBe(choice.value);
    expect(patch.lineDensity).toBeGreaterThan(0);
  });
});

describe('derived dimensions', () => {
  /**
   * The rows that are a second way of typing a number the part already stores:
   * OpenRocket offers them, because they are how people actually have the figure.
   * Nothing here is a node key, so each one is checked both ways round: the value
   * it shows, and the stored keys a typed value writes.
   */

  const node = (o: Record<string, unknown>): ComponentNode => o as unknown as ComponentNode;

  const render = (n: ComponentNode, onChange: (p: Partial<ComponentNode>) => void) =>
    renderWithProviders(
      <PropertyPanel node={n} onChange={onChange} onRemove={() => {}} canRemove isFirstStage={false} />,
    );

  const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

  describe('a fin sweep as an angle', () => {
    const fin = () =>
      node({
        id: 'f',
        type: 'trapezoidfinset',
        name: 'Fins',
        finCount: 3,
        rootChord: 0.05,
        tipChord: 0.03,
        sweep: 0.02,
        height: 0.02,
        thickness: 0.003,
      });

    it('shows the angle the stored sweep makes, in degrees', () => {
      render(fin(), vi.fn());
      // 20 mm back over 20 mm of span is 45 degrees. Nothing in the node says 45.
      expect(box('Sweep angle').value).toBe('45');
    });

    it('writes the SWEEP LENGTH when an angle is typed', () => {
      const onChange = vi.fn();
      render(fin(), onChange);

      fireEvent.change(box('Sweep angle'), { target: { value: '30' } });

      const patch = onChange.mock.calls.at(-1)![0] as Record<string, number>;
      expect(Object.keys(patch)).toEqual(['sweep']);
      expect(patch['sweep']).toBeCloseTo(0.02 * Math.tan(Math.PI / 6), 9);
    });

    it('takes a negative angle, which every other numeric row refuses', () => {
      const onChange = vi.fn();
      render(fin(), onChange);

      // A forward-swept fin. The shared NumberField floors at 0, so this row has
      // to open its floor or the shape could not be entered at all.
      expect(box('Sweep angle').min).toBe('-89');
      fireEvent.change(box('Sweep angle'), { target: { value: '-45' } });

      expect((onChange.mock.calls.at(-1)![0] as Record<string, number>)['sweep']).toBeCloseTo(-0.02, 9);
    });
  });

  describe('a streamer by area and aspect ratio', () => {
    const streamer = () =>
      node({ id: 's', type: 'streamer', name: 'Streamer', stripLength: 0.5, stripWidth: 0.05, cd: 0.6 });

    it('shows the area in square centimeters and the ratio as a bare number', () => {
      render(streamer(), vi.fn());
      // 50 cm by 5 cm: 250 cm squared, ten times as long as it is wide.
      expect(box('Strip area').value).toBe('250');
      expect(box('Aspect ratio').value).toBe('10');
    });

    it('re-cuts both sides and keeps the ratio when the area is typed', () => {
      const onChange = vi.fn();
      render(streamer(), onChange);

      fireEvent.change(box('Strip area'), { target: { value: '1000' } });

      const patch = onChange.mock.calls.at(-1)![0] as Record<string, number>;
      // Four times the fabric at the same 10:1, so both sides double.
      expect(patch['stripWidth']).toBeCloseTo(0.1, 9);
      expect(patch['stripLength']).toBeCloseTo(1, 9);
    });

    it('re-cuts both sides and keeps the area when the ratio is typed', () => {
      const onChange = vi.fn();
      render(streamer(), onChange);

      fireEvent.change(box('Aspect ratio'), { target: { value: '40' } });

      const patch = onChange.mock.calls.at(-1)![0] as Record<string, number>;
      const w = patch['stripWidth']!;
      const l = patch['stripLength']!;
      expect(w * l).toBeCloseTo(0.025, 12);
      expect(l / w).toBeCloseTo(40, 9);
    });
  });

  describe('a mass component by density', () => {
    // 12 mm across the packed lump, 20 mm long, 8 g.
    const lump = () =>
      node({ id: 'm', type: 'masscomponent', name: 'Ballast', mass: 0.008, radius: 0.006, length: 0.02 });

    it('shows what the lump would be made of', () => {
      render(lump(), vi.fn());
      const volume = Math.PI * 0.006 ** 2 * 0.02;
      // Shown in g/cm cubed, the metric default, so kg/m cubed over a thousand.
      expect(Number(box('Approximate density').value)).toBeCloseTo(0.008 / volume / 1000, 2);
    });

    it('writes the MASS when a density is typed', () => {
      const onChange = vi.fn();
      render(lump(), onChange);

      fireEvent.change(box('Approximate density'), { target: { value: '2.7' } });

      const patch = onChange.mock.calls.at(-1)![0] as Record<string, number>;
      expect(Object.keys(patch)).toEqual(['mass']);
      // Aluminum through a 12 by 20 mm cylinder.
      expect(patch['mass']).toBeCloseTo(2700 * Math.PI * 0.006 ** 2 * 0.02, 9);
    });
  });

  describe('a motor cluster states its gap both ways', () => {
    const tube = (extra: Record<string, unknown> = {}) =>
      node({
        id: 'i',
        type: 'innertube',
        name: 'Motor mount',
        length: 0.07,
        outerRadius: 0.0095,
        thickness: 0.0005,
        cluster: 'double',
        clusterScale: 1.5,
        ...extra,
      });

    it('shows the multiple and the distance side by side', () => {
      render(tube(), vi.fn());
      expect(box('Cluster spacing').value).toBe('1.5');
      // Half a 19 mm diameter of air between neighbors, in the metric default.
      expect(box('Tube separation').value).toBe('0.95');
    });

    it('writes the stored SCALE when the distance is typed', () => {
      const onChange = vi.fn();
      render(tube(), onChange);

      fireEvent.change(box('Tube separation'), { target: { value: '1.9' } });

      const patch = onChange.mock.calls.at(-1)![0] as Record<string, number>;
      expect(Object.keys(patch)).toEqual(['clusterScale']);
      // A whole 19 mm diameter of air between neighbors is a scale of 2.
      expect(patch['clusterScale']).toBeCloseTo(2, 9);
    });

    it('takes a negative gap, for tubes packed into each other', () => {
      render(tube(), vi.fn());
      // One whole diameter in, where the kernel clamps the scale to zero.
      expect(box('Tube separation').min).toBe('-1.9');
    });

    it('offers no cluster rows at all on a single tube', () => {
      render(tube({ cluster: 'single' }), vi.fn());
      // All three describe where the other tubes go, and there are none.
      expect(screen.queryByLabelText('Cluster spacing')).toBeNull();
      expect(screen.queryByLabelText('Tube separation')).toBeNull();
      expect(screen.queryByLabelText('Cluster rotation')).toBeNull();
    });
  });
});

describe('required dimensions', () => {
  const tube = (): ComponentNode =>
    ({
      id: 'tube',
      type: 'bodytube',
      name: 'Body tube',
      length: 0.2,
      outerRadius: 0.013,
      thickness: 0.0005,
    }) as unknown as ComponentNode;

  /** A tube fin set: its length is a value the kernel cannot fly at 0, so it is required. */
  const tubeFins = (): ComponentNode =>
    ({
      id: 'fins',
      type: 'tubefinset',
      name: 'Tube fins',
      finCount: 6,
      length: 0.05,
      outerRadius: 0.005,
      thickness: 0.0005,
    }) as unknown as ComponentNode;

  const render = (onChange: (p: Partial<ComponentNode>) => void, node: ComponentNode = tubeFins()) =>
    renderWithProviders(
      <PropertyPanel node={node} onChange={onChange} onRemove={() => {}} canRemove isFirstStage={false} />,
    );

  /**
   * Emptying a required dimension must not commit anything.
   *
   * Refusing to let focus leave the field would be a keyboard trap (WCAG 2.1.2)
   * and would fight anyone who clears a box in order to retype it. Withholding the
   * write gets the same guarantee (no accidental zero can reach the tree) without
   * trapping the keyboard.
   */

  describe('an emptied required dimension', () => {
    it('writes nothing when the box is cleared', () => {
      const onChange = vi.fn();
      render(onChange);
      const box = screen.getByLabelText('Length') as HTMLInputElement;

      fireEvent.focus(box);
      fireEvent.change(box, { target: { value: '' } });

      // Coerced to 0, an empty box would hand a zero to the tree.
      expect(onChange).not.toHaveBeenCalled();
    });

    it('still writes a real value typed into the same box', () => {
      const onChange = vi.fn();
      render(onChange);
      const box = screen.getByLabelText('Length') as HTMLInputElement;

      fireEvent.focus(box);
      fireEvent.change(box, { target: { value: '' } });
      fireEvent.change(box, { target: { value: '2' } });

      expect(onChange).toHaveBeenCalledTimes(1);
      const written = onChange.mock.calls[0]![0] as Record<string, number>;
      expect(Object.keys(written)).toEqual(['length']);
      expect(written['length']).toBeGreaterThan(0);
    });

    it('still lets a DELIBERATE zero through, for the run gate to refuse', () => {
      // Clearing is an accident; typing 0 is a statement. The gate names it and
      // blocks the flight, so it does not need to be forbidden at the keystroke.
      const onChange = vi.fn();
      render(onChange);
      const box = screen.getByLabelText('Length') as HTMLInputElement;

      fireEvent.focus(box);
      fireEvent.change(box, { target: { value: '0' } });

      expect(onChange).toHaveBeenCalledWith({ length: 0 });
    });

    it('does not guard an OPTIONAL dimension, where clearing means zero', () => {
      // Motor overhang 0 is flush, and clearing it is a reasonable way to say so.
      // The box is there only on a motor mount.
      const onChange = vi.fn();
      render(onChange, { ...tube(), motorMount: true } as ComponentNode);
      const overhang = screen.getByLabelText('Motor overhang') as HTMLInputElement;

      fireEvent.focus(overhang);
      fireEvent.change(overhang, { target: { value: '' } });

      expect(onChange).toHaveBeenCalledWith({ motorOverhang: 0 });
    });
  });
});

/**
 * A parachute may have no shroud lines: Parachute.setLineCount takes 0 and the
 * desktop spinner starts there. A floor of one would snap an imported 0 to 1
 * on the first edit.
 */
describe('shroud line count', () => {
  it('accepts zero', () => {
    const onChange = vi.fn();
    const node = { id: 'p', type: 'parachute', lineCount: 6 } as unknown as ComponentNode;
    renderWithProviders(<PropertyPanel node={node} onChange={onChange} onCommit={() => {}} onRemove={() => {}} />);
    const box = screen.getByLabelText('Shroud lines');
    fireEvent.change(box, { target: { value: '0' } });
    fireEvent.blur(box);
    expect(onChange).toHaveBeenCalledWith({ lineCount: 0 });
  });

  // The importers' ceiling, which engineBoundary.test.ts holds to the bridge:
  // the editor admits every count a file can carry, and no more.
  it('takes the shared ceiling, not the instance ceiling', () => {
    const onChange = vi.fn();
    const node = { id: 'p', type: 'parachute', lineCount: 6 } as unknown as ComponentNode;
    renderWithProviders(<PropertyPanel node={node} onChange={onChange} onCommit={() => {}} onRemove={() => {}} />);
    const box = screen.getByLabelText('Shroud lines');
    fireEvent.change(box, { target: { value: '100' } });
    fireEvent.blur(box);
    expect(onChange).toHaveBeenLastCalledWith({ lineCount: 100 });
    fireEvent.change(box, { target: { value: String(MAX_LINE_COUNT + 500) } });
    fireEvent.blur(box);
    expect(onChange).toHaveBeenLastCalledWith({ lineCount: MAX_LINE_COUNT });
  });
});

describe('unit overflow', () => {
  const chute = (): ComponentNode =>
    ({
      id: 'c',
      type: 'parachute',
      name: 'Main',
      diameter: 0.5,
      cd: 0.8,
      deployEvent: 'altitude',
      deployAltitude: 150,
    }) as unknown as ComponentNode;

  /**
   * A finite entry is not a finite stored value.
   *
   * `NumberInput.parseFieldValue` refuses a non-finite entry, so Infinity cannot
   * be typed. But the box holds display units and the node holds SI, and the
   * conversion between them overflows on its own wherever the display unit is the
   * larger of the two: 1e306 km is 1e309 m, which is Infinity. Written through, it
   * would be persisted and go out to the `.ork` as `Infinity`, which the reader
   * takes back as 0, so the field would show a number the geometry never had.
   */
  describe('a dimension whose unit conversion overflows', () => {
    // Kilometers on this one field: in meters (the default) the conversion is a
    // multiply by one and cannot overflow.
    beforeEach(() => seedSettings({ unitOverrides: { [unitScope('prop', 'parachute', 'deployAltitude')]: 'km' } }));

    const render = (onChange: (p: Partial<ComponentNode>) => void) =>
      renderWithProviders(
        <PropertyPanel node={chute()} onChange={onChange} onRemove={() => {}} canRemove isFirstStage={false} />,
      );

    it('writes nothing', () => {
      const onChange = vi.fn();
      render(onChange);
      const box = screen.getByLabelText('Deploy altitude (AGL)') as HTMLInputElement;

      fireEvent.focus(box);
      fireEvent.change(box, { target: { value: '1e306' } });

      expect(onChange).not.toHaveBeenCalled();
    });

    it('still writes an ordinary value in the same box', () => {
      const onChange = vi.fn();
      render(onChange);
      const box = screen.getByLabelText('Deploy altitude (AGL)') as HTMLInputElement;

      fireEvent.focus(box);
      fireEvent.change(box, { target: { value: '1e306' } });
      fireEvent.change(box, { target: { value: '0.2' } });

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0]![0]).toEqual({ deployAltitude: 200 });
    });
  });
});

describe('overrides', () => {
  /**
   * Desktop's override tab: when an ancestor's override decides a value, the part
   * says which ancestor in red and its own override for that value is locked.
   */

  const ring = {
    id: 'r',
    type: 'centeringring',
    outerRadius: 0.012,
    innerRadius: 0.009,
    length: 0.003,
  } as unknown as ComponentNode;

  const show = (coveredBy?: Partial<Record<'mass' | 'cg' | 'cd', string>>) =>
    renderWithProviders(
      <PropertyPanel node={ring} onChange={vi.fn()} onCommit={() => {}} onRemove={() => {}} coveredBy={coveredBy} />,
    );

  describe('an override decided by an ancestor', () => {
    it('names the ancestor and locks that override only', () => {
      show({ mass: 'Sustainer' });
      const note = screen.getByText('Mass overridden by Sustainer');
      expect(note.getAttribute('title')).toBe(
        'The mass of this component is determined by the mass override value of Sustainer',
      );
      const [mass, cg] = screen.getAllByRole('checkbox', { name: /^(Mass|CG)/ });
      expect((mass as HTMLInputElement).disabled).toBe(true);
      expect((cg as HTMLInputElement).disabled).toBe(false);
    });

    it('says nothing when no ancestor decides it', () => {
      show();
      expect(screen.queryByText(/overridden by/)).toBeNull();
    });
  });
});

describe('required fields', () => {
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
     * The other half of the judgment: these are all legitimately zero, so
     * marking one would put a red box on a correct design.
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
});

/**
 * Unit scopes are strings assembled at the call site (`unitScope('prop',
 * node.type, field.key)`), which is flexible but unchecked by the compiler.
 * The realistic way that bites is a copy-paste: two fields on one component
 * type sharing a key, which silently makes them share one unit choice, so
 * changing the unit on one moves the other. These guard that.
 */
describe('property-panel unit scopes', () => {
  it('gives every field of a type its own scope', () => {
    for (const [type, fields] of Object.entries(FIELDS)) {
      const scopes = fields.map((f) => unitScope('prop', type, f.key));
      expect(new Set(scopes).size, `duplicate field key in FIELDS.${type}`).toBe(scopes.length);
    }
  });

  it('keeps the panel rows from colliding with a type-specific field', () => {
    // The mass/CG overrides and the placement offset are rendered alongside the
    // fields and scoped the same way, so a field keyed 'offset' would share the
    // placement row's unit.
    for (const [type, fields] of Object.entries(FIELDS)) {
      for (const reserved of PANEL_SCOPE_KEYS) {
        expect(
          fields.some((f) => f.key === reserved),
          `FIELDS.${type} reuses the reserved scope key '${reserved}'`,
        ).toBe(false);
      }
    }
  });

  it('only puts a field in `placement` on a type whose panel shows that section', () => {
    // PropertyPanel renders PlacementSection for nested parts only
    // (`type !== 'stage' && !isAxial(type)`), and `visibleFields` drops every
    // sectioned field from the dimension list. Mark one on a body tube and it
    // falls out of both: not editable anywhere, with nothing to say so.
    //
    // The other sections need no such test: FieldSection is rendered
    // unconditionally and draws nothing when the part has no field in it.
    for (const [type, fields] of Object.entries(FIELDS)) {
      if (!fields.some((f) => f.section === 'placement')) continue;
      expect(type === 'stage' || isAxial(type), `FIELDS.${type} has a placement field but no placement section`).toBe(
        false,
      );
    }
  });

  it('separates the same field name on different component types', () => {
    // Deliberate: a nose cone's Length and a body tube's Length are different
    // fields on different cards, and get their own units.
    expect(unitScope('prop', 'nosecone', 'length')).not.toBe(unitScope('prop', 'bodytube', 'length'));
  });
});

describe('shape parameter', () => {
  /**
   * The Shape parameter field.
   *
   * `shapeParameter` is read by the mesh, the report, the schematic, the 3D view
   * and both .ork paths, and this field is the one place that writes it: a
   * power/haack/ogive nose carries a parameter that changes its whole profile.
   * `shapeUsesParameter` and `shapeParamMax` are unit-tested in
   * `tree/shapeProfile`; what is tested here is the wiring into the panel.
   */

  const LABEL = 'Shape parameter';

  function panel(node: Partial<ComponentNode>, onChange = vi.fn()) {
    renderWithProviders(<PropertyPanel node={node as ComponentNode} onChange={onChange} onRemove={() => {}} />);
    return onChange;
  }

  /** The spinbutton itself, so the `max` attribute can be read off it. */
  const field = () => screen.getByRole('spinbutton', { name: LABEL }) as HTMLInputElement;

  describe('the field appears only for shapes that use a parameter', () => {
    it.each(['ogive', 'power', 'parabolic', 'haack'])('shows it for a %s nose cone', (shape) => {
      panel({ type: 'nosecone', shape, length: 0.1, aftRadius: 0.012 });
      expect(screen.queryByRole('spinbutton', { name: LABEL })).not.toBeNull();
    });

    it.each(['conical', 'ellipsoid'])('hides it for a %s nose cone', (shape) => {
      panel({ type: 'nosecone', shape, length: 0.1, aftRadius: 0.012 });
      expect(screen.queryByRole('spinbutton', { name: LABEL })).toBeNull();
    });

    it('shows it for a power transition', () => {
      panel({ type: 'transition', shape: 'power', length: 0.05, foreRadius: 0.012, aftRadius: 0.02 });
      expect(screen.queryByRole('spinbutton', { name: LABEL })).not.toBeNull();
      screen.getByRole('spinbutton', { name: 'Length' }); // the panel really rendered
    });

    it('hides it for a conical transition', () => {
      panel({ type: 'transition', shape: 'conical', length: 0.05, foreRadius: 0.012, aftRadius: 0.02 });
      expect(screen.queryByRole('spinbutton', { name: LABEL })).toBeNull();
    });

    it('assumes the per-type default shape when the node declares none', () => {
      // The two defaults differ, and getting them the wrong way round would show
      // the field on exactly the parts that cannot use it.
      panel({ type: 'nosecone', length: 0.1, aftRadius: 0.012 }); // -> ogive, uses one
      expect(screen.queryByRole('spinbutton', { name: LABEL })).not.toBeNull();
    });

    it('assumes conical for a transition that declares no shape', () => {
      panel({ type: 'transition', length: 0.05, foreRadius: 0.012, aftRadius: 0.02 });
      expect(screen.queryByRole('spinbutton', { name: LABEL })).toBeNull();
    });
  });

  describe('the ceiling is the shape-dependent one the kernel enforces', () => {
    it('tops an ogive out at 1', () => {
      panel({ type: 'nosecone', shape: 'ogive', length: 0.1, aftRadius: 0.012, shapeParameter: 1 });
      expect(field().max).toBe('1');
    });

    it('tops a haack out at LV-Haack, 1/3', () => {
      // Shape.maxParameter() in the kernel. A haack at 1 is not a shape the
      // desktop can represent, so a design edited past it would not round-trip.
      panel({ type: 'nosecone', shape: 'haack', length: 0.1, aftRadius: 0.012, shapeParameter: 0.3 });
      expect(Number(field().max)).toBeCloseTo(1 / 3, 12);
    });

    it('clamps a typed value down to the shape ceiling', () => {
      const onChange = panel({
        type: 'nosecone',
        shape: 'haack',
        length: 0.1,
        aftRadius: 0.012,
        shapeParameter: 0.3,
      });
      fireEvent.change(field(), { target: { value: '0.9' } });
      expect(onChange).toHaveBeenCalled();
      expect(onChange.mock.calls.at(-1)![0]).toEqual({ shapeParameter: 1 / 3 });
    });

    it('clamps a negative value up to zero', () => {
      const onChange = panel({
        type: 'nosecone',
        shape: 'power',
        length: 0.1,
        aftRadius: 0.012,
        shapeParameter: 0.5,
      });
      fireEvent.change(field(), { target: { value: '-2' } });
      expect(onChange.mock.calls.at(-1)![0]).toEqual({ shapeParameter: 0 });
    });

    it('passes an in-range value straight through', () => {
      const onChange = panel({
        type: 'nosecone',
        shape: 'ogive',
        length: 0.1,
        aftRadius: 0.012,
        shapeParameter: 1,
      });
      fireEvent.change(field(), { target: { value: '0.75' } });
      expect(onChange.mock.calls.at(-1)![0]).toEqual({ shapeParameter: 0.75 });
    });

    it('leaves an ordinary number field unbounded above', () => {
      // `paramMax` is undefined for every other key, so the clamp must not leak
      // onto, say, Length, which would silently cap a 2 m airframe at 1 m.
      panel({ type: 'nosecone', shape: 'ogive', length: 0.1, aftRadius: 0.012 });
      expect((screen.getByRole('spinbutton', { name: 'Length' }) as HTMLInputElement).max).toBe('');
    });
  });

  /**
   * The shape select writes what `shapeSelect` returns, so the new shape brings
   * its own parameter and clip. `shapePick.kernel.test.ts` checks those values
   * against the kernel's profile; what is tested here is that the panel sends
   * them.
   */
  describe('choosing a shape', () => {
    const shapeBox = () => screen.getByRole('combobox', { name: 'Shape' });

    it('sends the new shape with its own parameter and clip', () => {
      const node = {
        type: 'transition',
        shape: 'ogive',
        shapeParameter: 0.4,
        clipped: false,
        length: 0.05,
        foreRadius: 0.012,
        aftRadius: 0.02,
      } as ComponentNode;
      const onChange = panel(node);
      fireEvent.change(shapeBox(), { target: { value: 'power' } });
      const sent = onChange.mock.calls.at(-1)![0] as Partial<ComponentNode>;
      expect(sent).toEqual(shapeSelect(node, 'power'));
      expect(Object.keys(sent).sort()).toEqual(['clipped', 'shape', 'shapeParameter']);
    });

    it('sends a nose cone the new shape and its parameter', () => {
      const node = {
        type: 'nosecone',
        shape: 'ogive',
        shapeParameter: 0.4,
        length: 0.1,
        aftRadius: 0.012,
      } as ComponentNode;
      const onChange = panel(node);
      fireEvent.change(shapeBox(), { target: { value: 'haack' } });
      expect(onChange.mock.calls.at(-1)![0]).toEqual(shapeSelect(node, 'haack'));
      expect(onChange.mock.calls.at(-1)![0]).toHaveProperty('shapeParameter');
    });
  });
});
