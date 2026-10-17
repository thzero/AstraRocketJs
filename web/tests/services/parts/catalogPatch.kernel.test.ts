import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { catalogPatch, defaultNode, presetRef, updateNode } from '../../../src/services/design/treeEdit';
import { isComponentRow, type Component, type ParachuteComponent } from '../../../src/services/parts/componentDb';
import { KERNEL_MATERIALS } from '../../../src/tree/kernelDefaults';
import type { ComponentNode, ComponentType, RocketTree } from '../../../src/engine/openRocketEngine';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import { loadEngine, type KernelGeometry } from '../../testing/kernelGeometry';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * Every kind of catalog row, applied to a part and built by the real engine.
 *
 * `catalogPatch` writes node keys the bridge reads by name, so a key spelled
 * wrong (or one the bridge does not know) is simply ignored: the part keeps its
 * default size and the picker looks like it did nothing. Building each row and
 * reading back the length the kernel gives the part catches that, and a
 * positive mass says the material reached it too.
 */

const catalog = (
  JSON.parse(readFileSync(join(__dirname, '../../../public/data/components.generated.json'), 'utf8')) as {
    components: unknown[];
  }
).components.filter(isComponentRow) as Component[];

/** A few rows of a type, spread across the catalog rather than the first maker's. */
const sample = (type: string): Component[] => {
  const rows = catalog.filter((p) => p.type === type);
  return [0, 0.5, 0.999].map((at) => rows[Math.floor(at * (rows.length - 1))]!);
};

const node = (type: ComponentType, id: string, extra: Partial<ComponentNode> = {}, children: ComponentNode[] = []) =>
  ({ ...defaultNode(type), id, ...extra, children }) as ComponentNode;

/** The part inside something that may hold it, inside a stage. */
function design(probe: ComponentNode): unknown {
  const body = { outerRadius: 0.1, length: 1 } as Partial<ComponentNode>;
  const holders: Record<string, (p: ComponentNode) => ComponentNode[]> = {
    transition: (p) => [node('bodytube', 'tube', body), p],
    nosecone: (p) => [p],
    bodytube: (p) => [p],
    engineblock: (p) => [node('bodytube', 'tube', body, [node('innertube', 'mmt', { outerRadius: 0.05 }, [p])])],
  };
  const chain = (holders[probe.type] ?? ((p) => [node('bodytube', 'tube', body, [p])]))(probe);
  return { components: [node('stage' as ComponentType, 'st', {}, chain)] };
}

/**
 * A design holding a new part with the row picked onto it, as the property
 * panel applies a pick: the patch and the link in one `updateNode`, so every
 * rule the editor runs on an edit (shoulder seeding, the automatic radii)
 * runs on the pick too.
 */
function picked(row: Component): RocketTree {
  const probe = node(row.type as ComponentType, 'probe');
  const tree = design(probe) as RocketTree;
  return updateNode(tree, 'probe', { ...catalogPatch(row, probe), ...presetRef(row) });
}

/** The kernel's geometry and info for one part, picked onto a new part and built. */
function build(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the TeaVM bundle is untyped
  engine: any,
  row: Component,
): { geo: KernelGeometry & { error?: string }; info: Record<string, number> } {
  engine.reset();
  const handle = engine.buildRocket(JSON.stringify(picked(row)));
  return {
    geo: JSON.parse(engine.getComponentGeometry(handle, 'probe')),
    info: JSON.parse(engine.getComponentInfo(handle, 'probe')),
  };
}

/**
 * What the desktop's `loadFromPreset` makes of a row's stated sizes, as
 * `[what, kernel value, expected]` triples, written out from the Java:
 *
 * - `BodyTube`, `ThicknessRingComponent` (coupler, engine block) and
 *   `LaunchLug`: the outer radius is half the outer diameter, and a stated
 *   inner diameter sets the wall to `(od - id) / 2`, so the bore is half the
 *   inner diameter (a stated 0 is a solid part). A lug's radii reach the bridge
 *   only through its mass, `LaunchLug.getComponentVolume` times the density of
 *   the material it states.
 * - `RadiusRingComponent` (centering ring, bulkhead): both radii as stated.
 * - `Transition.loadFromPreset` (and a nose cone through it): both ends as
 *   stated, and the wall a hollow part states, so the bore at the aft end is
 *   `max(r - t, 0)` (`Transition.getInnerRadius`). That method ignores
 *   `filled`, so a filled part's bore is not compared; its volume is, through
 *   the stated mass test below.
 * - `RailButton.loadFromPreset`: every stated size as is.
 * - A streamer's strip: its area in the surface material it states.
 *
 * A part that states no material keeps the one it had (`StructuralComponent`
 * and `ExternalComponent.loadFromPreset` set it only from the preset), so its
 * mass says nothing about its size and is not compared.
 */
function expectedSizes(
  row: Component,
  geo: KernelGeometry,
  info: Record<string, number>,
): [string, number | undefined, number][] {
  const out: [string, number | undefined, number][] = [];
  const add = (what: string, got: number | undefined, want: number | null | undefined) => {
    if (want != null) out.push([what, got, want]);
  };
  switch (row.type) {
    case 'bodytube':
    case 'tubecoupler':
    case 'engineblock':
      add('length', geo.length, row.length);
      add('outer radius', geo.outerRadius, row.outerDiameter / 2);
      add('inner radius', geo.innerRadius, row.innerDiameter != null ? row.innerDiameter / 2 : null);
      break;
    case 'launchlug': {
      add('length', geo.length, row.length);
      const bore = (row.innerDiameter ?? 0) / 2;
      if (row.innerDiameter != null && row.material != null)
        add(
          'mass',
          info['mass'],
          row.length * Math.PI * ((row.outerDiameter / 2) ** 2 - bore ** 2) * row.materialDensity,
        );
      break;
    }
    case 'centeringring':
      add('length', geo.length, row.length);
      add('outer radius', geo.outerRadius, row.outerDiameter / 2);
      add('inner radius', geo.innerRadius, row.innerDiameter != null ? row.innerDiameter / 2 : null);
      break;
    case 'bulkhead':
      add('length', geo.length, row.length);
      add('outer radius', geo.outerRadius, row.outerDiameter / 2);
      add('inner radius', geo.innerRadius, 0);
      break;
    case 'nosecone': {
      const r = row.outerDiameter / 2;
      add('length', geo.length, row.length);
      add('aft radius', geo.aftRadius, r);
      if (!row.filled && row.thickness != null)
        add('aft bore', geo.innerProfile?.at(-1) ?? undefined, Math.max(r - row.thickness, 0));
      break;
    }
    case 'transition': {
      add('length', geo.length, row.length);
      add('fore radius', geo.foreRadius, row.foreOuterDiameter / 2);
      add('aft radius', geo.aftRadius, row.aftOuterDiameter / 2);
      if (!row.filled && row.thickness != null)
        add('aft bore', geo.innerProfile?.at(-1) ?? undefined, Math.max(row.aftOuterDiameter / 2 - row.thickness, 0));
      break;
    }
    case 'railbutton':
      add('outer diameter', geo.outerDiameter, row.outerDiameter);
      add('inner diameter', geo.innerDiameter, row.innerDiameter);
      add('height', geo.totalHeight, row.height);
      add('base height', geo.baseHeight, row.baseHeight);
      add('flange height', geo.flangeHeight, row.flangeHeight);
      break;
    case 'streamer':
      if (row.material != null) add('mass', info['mass'], row.stripLength * row.stripWidth * row.materialDensity);
      break;
    case 'parachute':
      // The canopy's diameter reaches the kernel only through its mass; see 'a catalog parachute'.
      break;
  }
  return out;
}

/**
 * Whether a row is a part with a body. Upstream states a few that are not: a
 * ring or coupler whose inner diameter is larger than its outer one (desktop
 * gives it a negative wall and a negative volume), and a transition whose two
 * ends are both under 0.01 mm.
 */
function buildable(p: Component): boolean {
  if ('innerDiameter' in p && 'outerDiameter' in p && p.innerDiameter != null && p.innerDiameter > p.outerDiameter)
    return false;
  if (p.type === 'transition') return Math.max(p.foreOuterDiameter, p.aftOuterDiameter) > 1e-5;
  return true;
}

describe('catalogPatch through the kernel', () => {
  const types = [...new Set(catalog.map((p) => p.type))].sort();

  it('covers every catalog type', () => {
    expect(types).toEqual([
      'bodytube',
      'bulkhead',
      'centeringring',
      'engineblock',
      'launchlug',
      'nosecone',
      'parachute',
      'railbutton',
      'streamer',
      'transition',
      'tubecoupler',
    ]);
  });

  for (const type of types)
    it(`builds every ${type} row at its stated length, radii and wall`, async () => {
      const engine = await loadEngine();
      const rows = catalog.filter((p) => p.type === type && buildable(p));
      const wrong: string[] = [];
      let compared = 0;
      for (const row of rows) {
        const { geo, info } = build(engine, row);
        const id = `${row.mfr} ${row.partNo}`;
        if (geo.error || (info as { error?: string }).error) {
          wrong.push(`${id}: ${geo.error ?? (info as { error?: string }).error}`);
          continue;
        }
        if (!(info['mass']! > 0)) wrong.push(`${id}: weighs ${info['mass']}`);
        for (const [what, got, want] of expectedSizes(row, geo, info)) {
          compared++;
          const scale = Math.max(Math.abs(want), 1e-6);
          if (got == null || !(Math.abs(got - want) <= 1e-9 + 1e-6 * scale))
            wrong.push(`${id} ${what}: stated ${want}, kernel ${got}`);
        }
      }
      expect(wrong).toEqual([]);
      if (type !== 'parachute') expect(compared).toBeGreaterThanOrEqual(rows.length - 2);
    });

  // A row that names a material with no density (`BaseComponentDTO.find` gives
  // it 0, and desktop weighs the part at nothing) takes the nearest built-in
  // material in the sync (scripts/lib/nearestMaterial.mjs). A part that states
  // its mass takes its density from that mass, so only the rest can be left at 0.
  it('weighs every part that states no mass by a material with a density', () => {
    const weightless = catalog
      .filter((p) => 'material' in p && p.material != null && p.materialDensity === 0 && p.mass == null)
      .map((p) => `${p.type} ${p.mfr} ${p.partNo}: ${p.material}`);
    expect(weightless).toEqual([]);
  });
});

/**
 * A catalog part that states a mass weighs that mass when it flies, as on the
 * desktop: `ComponentPresetFactory` turns the mass of a tube, ring, bulkhead,
 * nose cone or transition into its material's density, and
 * `Parachute.loadPreset` takes a parachute's as its mass override. Every such
 * row is picked onto a new part through updateNode and built in the kernel, so a node that
 * reaches the kernel with a different shape, wall or volume than the desktop
 * gave the preset shows up as a different mass.
 */
describe('a stated catalog mass', () => {
  it('is the mass the part flies at', async () => {
    const engine = await loadEngine();
    const massed = catalog.filter((p) => typeof p.mass === 'number');
    expect(massed.length).toBeGreaterThan(100);
    const wrong: string[] = [];
    for (const row of massed) {
      engine.reset();
      const handle = engine.buildRocket(JSON.stringify(picked(row)));
      const info = JSON.parse(engine.getComponentInfo(handle, 'probe'));
      if (info.error || !(Math.abs(info.mass / row.mass! - 1) < 0.005))
        wrong.push(`${row.type} ${row.mfr} ${row.partNo}: catalog ${row.mass} kg, flies ${info.mass ?? info.error}`);
    }
    expect(wrong).toEqual([]);
  });

  // A degenerate shape (a reversed nose cone whose ends are 0 and 2.54 µm, with
  // a 21.6 mm shoulder on its 0 end) has no volume once its shoulder is held to
  // that end: PresetDump on the 24.12 jar reports the density
  // `ComponentPresetFactory` gave SEMROC `BC-08542 [R]` as Infinity. Its stated
  // mass applies in neither build, so the row carries none.
  it('is not carried for a reversed SEMROC cone that no build gives a volume', async () => {
    const engine = await loadEngine();
    const row = catalog.find((p) => p.mfr === 'SEMROC Astronautics' && p.partNo === 'BC-08542 [R]')!;
    expect(row).toBeDefined();
    expect(row.mass).toBeUndefined();
    engine.reset();
    const h = engine.buildRocket(JSON.stringify(picked(row)));
    const fields = JSON.parse(engine.getComponentFields(h, 'probe')) as Record<string, number>;
    expect(fields['foreShoulderRadius']).toBe(0);
  });
});

/**
 * A stated shoulder, held to the end it plugs as the 24.12 release's
 * `Transition.loadFromPreset` applies it: `setForeShoulderRadius(double)` and
 * `setAftShoulderRadius(double)` clamp to `Math.min(radius, getForeRadius())`
 * and `getAftRadius()` (`javap -c` on `info.openrocket.core.rocketcomponent.Transition`
 * in OpenRocket-24.12.jar), after the end radius is set, and a nose cone is
 * loaded unflipped so its one shoulder is the aft one. The bridge builds the
 * shoulder unclamped, so the node has to carry the clamped radius itself.
 */
describe('a stated shoulder', () => {
  const sides = (p: Component): { key: string; stated: number; end: number }[] =>
    p.type === 'nosecone'
      ? p.shoulderDiameter != null
        ? [{ key: 'shoulderRadius', stated: p.shoulderDiameter / 2, end: p.outerDiameter / 2 }]
        : []
      : p.type === 'transition'
        ? [
            ...(p.foreShoulderDiameter != null
              ? [{ key: 'foreShoulderRadius', stated: p.foreShoulderDiameter / 2, end: p.foreOuterDiameter / 2 }]
              : []),
            ...(p.aftShoulderDiameter != null
              ? [{ key: 'aftShoulderRadius', stated: p.aftShoulderDiameter / 2, end: p.aftOuterDiameter / 2 }]
              : []),
          ]
        : [];

  it('flies at its radius held to the end it plugs, on every row that states one', async () => {
    const engine = await loadEngine();
    const rows = catalog.filter((p) => sides(p).length > 0);
    expect(rows.length).toBeGreaterThan(500);
    // The rows the clamp is for are among them.
    expect(rows.some((p) => sides(p).some((sd) => sd.stated > sd.end))).toBe(true);
    const wrong: string[] = [];
    for (const row of rows) {
      engine.reset();
      const tree = picked(row);
      const h = engine.buildRocket(JSON.stringify(tree));
      const fields = JSON.parse(engine.getComponentFields(h, 'probe')) as Record<string, number>;
      for (const { key, stated, end } of sides(row)) {
        const want = Math.min(stated, end);
        if (!(Math.abs(fields[key]! - want) <= 1e-12))
          wrong.push(`${row.type} ${row.mfr} ${row.partNo} ${key}: 24.12 ${want}, kernel ${fields[key]}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

/**
 * A catalog rail button weighs, without its mass override, the button's own
 * stated mass: `ComponentPresetFactory.makeRailButton` divides the preset's
 * `MASS` by `RailButton.getComponentVolume` and gives the material that
 * density (`javap -c` on OpenRocket-24.12.jar). `MASS` is the button alone, as
 * PresetDump on that jar reports it below; the override adds the screw and nut.
 */
describe('a catalog rail button', () => {
  // [maker, part number, MASS in kg], PresetDump on the 24.12 release jar.
  const PRESET_MASS: [string, string, number][] = [
    ['Binder Design-Rail Button Supply House', 'Std 1010 RB', 4.4500000000000003e-4],
    ['Binder Design-Rail Button Supply House', 'Std 1515 RB', 0.0014650000000000002],
    ['Rail-Buttons.com', '1P1010DLX', 3.2e-4],
    ['Rail-Buttons.com', '1PMB', 8.999999999999999e-5],
    ['Rail-Buttons.com', 'RB-10-D', 3.05e-4],
    ['Rail-Buttons.com', 'RB-Micro', 1.0e-5],
    ['Rail-Buttons.com', 'RB1515S', 0.001355],
    ['Wildman Rocketry', '2052-LG', 0.003215],
  ];

  it('covers every rail button in the catalog', () => {
    const keys = catalog.filter((p) => p.type === 'railbutton').map((p) => `${p.mfr} ${p.partNo}`);
    expect(keys.sort()).toEqual(PRESET_MASS.map(([m, pn]) => `${m} ${pn}`).sort());
  });

  it.each(PRESET_MASS)('%s %s weighs its own stated mass with the override off', async (mfr, partNo, mass) => {
    const row = catalog.find((p) => p.type === 'railbutton' && p.mfr === mfr && p.partNo === partNo)!;
    const tree = picked(row);
    const probe = (tree.components[0]!.children ?? [])
      .flatMap((c) => [c, ...(c.children ?? [])])
      .find((c) => c.id === 'probe')!;
    delete probe['overrideMass'];
    const engine = await loadEngine();
    engine.reset();
    const info = JSON.parse(engine.getComponentInfo(engine.buildRocket(JSON.stringify(tree)), 'probe'));
    expect(info.mass / mass).toBeCloseTo(1, 3);
  });
});

/**
 * A pick onto a part whose shoulder is capped keeps the cap. The 24.12
 * release's `Transition.loadFromPreset` (which `NoseCone.loadFromPreset` calls)
 * sets each stated shoulder's length and radius, and a filled part's shoulder
 * wall, and never its cap (`javap -c` on
 * `info.openrocket.core.rocketcomponent.Transition` in OpenRocket-24.12.jar).
 * The kernel's `loadFromPreset` also never sets the cap, and its shoulder length
 * setter leaves the cap alone on a shoulder that already has a length: the
 * oracle is the kernel's `setShoulderLength` on the part as it was before the
 * pick.
 */
describe('a pick onto a capped shoulder', () => {
  const stated = (p: Component, side: '' | 'fore' | 'aft'): boolean => {
    const r = p as unknown as Record<string, number | null | undefined>;
    const k = (n: string) => (side ? `${side}Shoulder${n}` : `shoulder${n}`);
    return (r[k('Diameter')] ?? 0) > 0 && (r[k('Length')] ?? 0) > 0;
  };
  const rows = (): { what: string; row: Component; side: '' | 'fore' | 'aft' }[] => [
    { what: "a nose cone's", row: catalog.find((p) => p.type === 'nosecone' && stated(p, ''))!, side: '' },
    {
      what: "a transition's fore",
      row: catalog.find((p) => p.type === 'transition' && stated(p, 'fore'))!,
      side: 'fore',
    },
    { what: "a transition's aft", row: catalog.find((p) => p.type === 'transition' && stated(p, 'aft'))!, side: 'aft' },
  ];
  it.each(rows())('keeps the cap on $what shoulder', async ({ row, side }) => {
    const key = (k: string) => (side ? `${side}Shoulder${k}` : `shoulder${k}`);
    const length = (row as unknown as Record<string, number>)[key('Length')]!;
    const probe = node(row.type as ComponentType, 'probe', {
      [key('Length')]: 0.02,
      [key('Radius')]: 0.01,
      [key('Thickness')]: 0.001,
      [key('Capped')]: true,
    });
    const tree = design(probe) as RocketTree;

    const engine = await loadEngine();
    engine.reset();
    const h = engine.buildRocket(JSON.stringify(tree));
    const kernel = JSON.parse(engine.setShoulderLength(h, 'probe', side, length)) as Record<string, unknown>;
    expect(kernel['error']).toBeUndefined();
    expect(kernel[key('Capped')]).toBe(true);

    const after = updateNode(tree, 'probe', { ...catalogPatch(row, probe), ...presetRef(row) });
    const got = (after.components[0]!.children ?? [])
      .flatMap((c) => [c, ...(c.children ?? [])])
      .find((c) => c.id === 'probe')!;
    expect(got[key('Length')]).toBe(length);
    expect(got[key('Capped')]).toBe(kernel[key('Capped')]);
  });
});

/**
 * A catalog parachute with no stated mass weighs what the desktop gives it:
 * `Parachute.loadFromPreset` applies the part's line count and length and its
 * canopy and line materials, so the canopy's area in its material plus the
 * lines in theirs is the mass desktop flies. A row that loses any of those on
 * the way to the kernel weighs a new parachute's lines or nylon instead.
 */
describe('a catalog parachute', () => {
  it('flies at the mass of its own canopy and lines', async () => {
    const engine = await loadEngine();
    const chutes = catalog.filter((p): p is ParachuteComponent => p.type === 'parachute' && p.mass == null);
    expect(chutes.length).toBeGreaterThan(100);
    // Every field the desktop applies is carried, or the rows test nothing.
    expect(chutes.every((p) => p.lineCount != null && p.lineLength != null)).toBe(true);
    const wrong: string[] = [];
    for (const row of chutes) {
      const probe = { ...node('parachute', 'probe'), ...catalogPatch(row) } as ComponentNode;
      engine.reset();
      const handle = engine.buildRocket(JSON.stringify(design(probe)));
      const info = JSON.parse(engine.getComponentInfo(handle, 'probe'));
      // Parachute.getComponentMass: the canopy's area in its material, plus the lines in theirs.
      const canopy = ((Math.PI * row.diameter ** 2) / 4) * (row.materialDensity ?? KERNEL_MATERIALS.surface.density);
      const lines = row.lineCount! * row.lineLength! * (row.lineMaterialDensity ?? KERNEL_MATERIALS.line.density);
      const expected = canopy + lines;
      if (info.error || !(Math.abs(info.mass / expected - 1) < 0.005))
        wrong.push(`${row.mfr} ${row.partNo}: expected ${expected} kg, flies ${info.mass ?? info.error}`);
    }
    expect(wrong).toEqual([]);
  });
});

const JAVA_ROOT = join(__dirname, '../../../../engine-java/src/java/info/openrocket/core/rocketcomponent/');
/** Java source with runs of whitespace collapsed, so the guards survive reformatting. */
const javaSource = (file: string): string => readFileSync(join(JAVA_ROOT, file), 'utf8').replace(/\s+/g, ' ');

/**
 * A recovery part picked from the catalog, against `Streamer.loadFromPreset`,
 * `RecoveryDevice.loadFromPreset` and `Parachute.loadFromPreset`.
 */
describe('a picked recovery part', () => {
  it('is generated from the rules the patch was written against', () => {
    expect(javaSource('Streamer.java')).toContain('this.length = this.stripWidth;');
    expect(javaSource('RecoveryDevice.java')).toContain('} else { this.material = defaultMaterial; }');
    expect(javaSource('Parachute.java')).toContain(
      'if (size > 0) { this.name = preset.get(ComponentPreset.DESCRIPTION); } else { this.name = getComponentName(); }',
    );
  });

  it('packs a streamer to its strip width, whatever the part before it had', async () => {
    const engine = await loadEngine();
    for (const row of sample('streamer')) {
      if (row.type !== 'streamer') throw new Error('sample returned another type');
      const probe = { ...node('streamer', 'probe', { length: 0.37 }), ...catalogPatch(row) } as ComponentNode;
      engine.reset();
      const info = JSON.parse(engine.getComponentInfo(engine.buildRocket(JSON.stringify(design(probe))), 'probe'));
      expect(info.length, `${row.mfr} ${row.partNo}`).toBeCloseTo(row.stripWidth, 9);
    }
  });

  it('gives a streamer that states no material the kernel default, not the previous one', async () => {
    const engine = await loadEngine();
    const strip = { stripLength: 1, stripWidth: 0.1 };
    const bare = { ...node('streamer', 'probe'), ...strip } as Record<string, unknown>;
    delete bare['surfaceMaterialName'];
    delete bare['surfaceDensity'];
    engine.reset();
    const fresh = JSON.parse(
      engine.getComponentInfo(engine.buildRocket(JSON.stringify(design(bare as never))), 'probe'),
    );
    const row = { type: 'streamer', mfr: 'X', partNo: 'Y', desc: '', materialDensity: 0, ...strip } as Component;
    const probe = {
      ...node('streamer', 'probe', { surfaceMaterialName: 'Heavy', surfaceDensity: 0.5 }),
      ...catalogPatch(row),
    } as ComponentNode;
    engine.reset();
    const picked = JSON.parse(engine.getComponentInfo(engine.buildRocket(JSON.stringify(design(probe))), 'probe'));
    expect(picked.mass).toBeCloseTo(fresh.mass, 9);
  });

  it('names a parachute after the description it states', () => {
    const row = catalog.find((p): p is ParachuteComponent => p.type === 'parachute' && p.desc.length > 0)!;
    expect(catalogPatch(row, node('parachute', 'probe', { name: 'Main' }))['name']).toBe(row.desc);
    // An empty description falls back to the type's own name.
    expect(catalogPatch({ ...row, desc: '' }, node('parachute', 'probe', { name: 'Main' }))['name']).toBeUndefined();
  });
});

/**
 * A row's text as desktop's JAXB loader reads the `.orc`: XML references
 * resolved, and of an element a part repeats, the last one.
 */
describe("a catalog row's text", () => {
  it('carries no unresolved XML reference', () => {
    const raw = catalog.filter((p) =>
      [p.mfr, p.partNo, p.desc, (p as { material?: string }).material ?? ''].some((s) =>
        /&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(s),
      ),
    );
    expect(raw.map((p) => `${p.mfr} ${p.partNo}: ${p.desc}`)).toEqual([]);
    expect(catalog.filter((p) => p.mfr === 'Public Missiles' && p.desc === '29>38mm Adapter')).toHaveLength(1);
  });

  it('takes the last of a repeated description, as desktop does', () => {
    // The part list PresetDump.java reads from the 24.12 release jar gives these descriptions.
    const desc = (mfr: string, partNo: string) => catalog.find((p) => p.mfr === mfr && p.partNo === partNo)?.desc;
    expect(desc('BalsaMachining', 'NB80-4')).toBe('2.558X4.00, BT80 Nose Block 4 inch, fits BT80');
    expect(desc('Giant Leap', 'CR-3.00/38')).toBe('CR 3.00/38mm');
    expect(desc('Giant Leap', 'CR-54/38')).toBe('CR 54/38mm');
  });
});
