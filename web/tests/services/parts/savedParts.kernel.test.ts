import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentNode, ComponentType, RocketTree } from '../../../src/engine/openRocketEngine';
import { catalogPatch, defaultNode, findNode, syncDerived, updateNode } from '../../../src/services/design/treeEdit';
import { repairValues } from '../../../src/services/design/repairValues';
import { isComponentRow, type Component, type PickerType } from '../../../src/services/parts/componentDb';
import { customPartToRow, saveCustomPart } from '../../../src/services/parts/customParts';
import { setPresetStore, type CustomPart, type PresetStore } from '../../../src/services/parts/presetStore';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import { loadEngine } from '../../testing/kernelGeometry';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * A part saved from the editor, read back as a picker row and applied again,
 * against what the kernel builds from the same node.
 */

class MemoryPresetStore implements PresetStore {
  parts: CustomPart[] = [];
  async list() {
    return this.parts;
  }
  async add(part: CustomPart) {
    this.parts = [part, ...this.parts.filter((p) => p.id !== part.id)];
  }
  async remove(id: string) {
    this.parts = this.parts.filter((p) => p.id !== id);
  }
}
beforeEach(() => setPresetStore(new MemoryPresetStore()));

const catalog = (
  JSON.parse(readFileSync(join(__dirname, '../../../public/data/components.generated.json'), 'utf8')) as {
    components: unknown[];
  }
).components.filter(isComponentRow) as Component[];

const AIRFRAME = new Set(['nosecone', 'bodytube', 'transition']);

/** The part, as the editor creates it, where it can sit, synced as the store holds a design. */
function design(probe: ComponentNode): RocketTree {
  const tube = (children: ComponentNode[] = []) =>
    ({ ...defaultNode('bodytube'), id: 'tube', outerRadius: 0.03, outerRadiusAuto: false, children }) as ComponentNode;
  const chain = AIRFRAME.has(probe.type)
    ? [tube(), probe]
    : probe.type === 'engineblock'
      ? [tube([{ ...defaultNode('innertube'), id: 'mmt', outerRadius: 0.012, children: [probe] } as ComponentNode])]
      : [tube([probe])];
  return syncDerived({ components: [{ ...defaultNode('stage'), id: 'st', children: chain }] } as RocketTree);
}

const probeOf = (type: ComponentType, extra: Partial<ComponentNode> = {}): ComponentNode =>
  ({ ...defaultNode(type), id: 'probe', ...extra }) as ComponentNode;

/** The kernel's fields for the probe part of a design. */
async function kernelFields(tree: RocketTree): Promise<Record<string, number | boolean | string>> {
  const engine = await loadEngine();
  engine.reset();
  const handle = engine.buildRocket(JSON.stringify(tree));
  return JSON.parse(engine.getComponentFields(handle, 'probe') as string) as Record<string, number | boolean | string>;
}

const meta = { mfr: 'Mine', partNo: 'P1', desc: '' };

describe('saving a part from the editor', () => {
  const types = [...new Set(catalog.map((p) => p.type))].sort() as ComponentType[];

  it.each(types)('saves the editor default %s and lists it', async (type) => {
    const tree = design(probeOf(type));
    const part = await saveCustomPart(findNode(tree, 'probe')!, type as PickerType, meta);
    expect(customPartToRow(part)?.type).toBe(type);
  });

  /** Rail buttons the editor builds: its default, and every catalog button picked onto one. */
  const buttons = (): [string, ComponentNode][] => [
    ['an editor default', probeOf('railbutton')],
    ...catalog
      .filter((p) => p.type === 'railbutton')
      .map((row): [string, ComponentNode] => {
        const probe = probeOf('railbutton');
        return [`${row.mfr} ${row.partNo}`, { ...probe, ...catalogPatch(row, probe) } as ComponentNode];
      }),
  ];

  it.each(buttons())('lists %s rail button at the sizes the kernel builds it at', async (_what, probe) => {
    const tree = design(probe);
    const node = findNode(tree, 'probe')!;
    const row = customPartToRow(await saveCustomPart(node, 'railbutton', meta));
    const k = await kernelFields(tree);
    expect(row).toMatchObject({
      type: 'railbutton',
      outerDiameter: expect.closeTo(k['outerDiameter'] as number, 12) as unknown as number,
      innerDiameter: expect.closeTo(k['innerDiameter'] as number, 12) as unknown as number,
      height: expect.closeTo(k['height'] as number, 12) as unknown as number,
      baseHeight: expect.closeTo(k['baseHeight'] as number, 12) as unknown as number,
      flangeHeight: expect.closeTo(k['flangeHeight'] as number, 12) as unknown as number,
      screwHeight: expect.closeTo(k['screwHeight'] as number, 12) as unknown as number,
    });
  });

  // The kernel reads solidness from the flag (`ComponentFactory` calls
  // `setFilled`), whatever the wall says.
  it.each([
    ['filled with a thin wall', { filled: true, thickness: 0.001 }],
    ['hollow with a wall as thick as the base', { filled: false, thickness: 0.013 }],
    ['hollow with a thin wall', { filled: false, thickness: 0.001 }],
  ])('lists a nose cone %s as solid exactly when the kernel flies it solid', async (_what, extra) => {
    const tree = design(probeOf('nosecone', { aftRadius: 0.013, ...extra }));
    const row = customPartToRow(await saveCustomPart(findNode(tree, 'probe')!, 'nosecone', meta));
    expect((row as { filled: boolean }).filled).toBe((await kernelFields(tree))['filled']);
  });
});

/**
 * A saved part's node comes back out of the browser's storage, which a design
 * loaded from storage does too; applied, it carries what the load would have
 * repaired, not what was stored.
 */
describe('applying a saved part', () => {
  const stored = (node: Partial<ComponentNode>): Component => {
    const row = customPartToRow({ id: 'x', type: 'bodytube', mfr: 'm', partNo: 'p', desc: '', node });
    if (!row) throw new Error('the stored part does not list');
    return row;
  };

  it.each([1e9, 5e5, 2e4])('flies a stored density of %d kg/m³ as a loaded design repairs it', async (density) => {
    const node = { ...defaultNode('bodytube'), outerRadius: 0.02, outerRadiusAuto: false, density };
    const target = probeOf('bodytube', { outerRadius: 0.02, outerRadiusAuto: false });
    const picked = updateNode(design(target), 'probe', catalogPatch(stored(node), target));
    const loaded = repairValues(design({ ...node, id: 'probe' } as ComponentNode)).tree;
    expect(findNode(picked, 'probe')!['density']).toBe(findNode(loaded, 'probe')!['density']);
    const engine = await loadEngine();
    const mass = (tree: RocketTree) => {
      engine.reset();
      return (
        JSON.parse(engine.getComponentInfo(engine.buildRocket(JSON.stringify(tree)), 'probe')) as { mass: number }
      ).mass;
    };
    expect(mass(picked)).toBeCloseTo(mass(loaded), 12);
  });
});
