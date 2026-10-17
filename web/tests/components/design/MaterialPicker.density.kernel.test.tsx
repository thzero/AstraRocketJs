// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import { MaterialPicker } from '../../../src/components/design/MaterialPicker';
import { importOrk } from '../../../src/services/files/orkFile';
import { setMaterialStore } from '../../../src/services/materials/materialStore';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { serveData } from '../../testing/serveData';
import { loadEngine } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * A part whose material shares a name with a list entry but not its density
 * shows the density it flies with.
 *
 * The file below is a desktop user's own "Balsa" at 200 kg/m³; the list's Balsa
 * is another density. The figure the picker has to show is the one the kernel
 * holds for the part after the build.
 */

const XML = `<?xml version="1.0"?><openrocket version="1.8"><rocket><name>T</name><subcomponents><stage><name>S</name><subcomponents>
<bodytube><name>B</name><length>0.3</length><radius>0.012</radius><thickness>0.001</thickness>
<material type="bulk" density="200.0">Balsa</material></bodytube>
</subcomponents></stage></subcomponents></rocket></openrocket>`;

const ork = (xml: string): ArrayBuffer => {
  const zipped = zipSync({ 'rocket.ork': strToU8(xml) });
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
};

const flatten = (nodes: ComponentNode[]): ComponentNode[] =>
  nodes.flatMap((n) => [n, ...flatten((n.children ?? []) as ComponentNode[])]);

/** The material select, not the density unit chip beside it. */
const materialSelect = () =>
  screen
    .getAllByRole('combobox')
    .find((s) => (s as HTMLSelectElement).querySelector('option[value="__default__"]')) as HTMLSelectElement;

describe('a material named like a list entry at another density', () => {
  beforeAll(serveData);
  beforeEach(() => setMaterialStore({ list: async () => [], add: async () => {}, remove: async () => {} }));

  it('shows the density the kernel flies, not the list entry’s', async () => {
    const { tree } = importOrk(ork(XML));
    const tube = flatten(tree.components).find((n) => n.type === 'bodytube')!;
    const engine = await loadEngine();
    engine.reset();
    const h = engine.buildRocket(JSON.stringify(tree));
    const fields = JSON.parse(engine.getComponentFields(h, tube.id)) as { materialName: string; density: number };
    expect(fields.materialName).toBe('Balsa');

    renderWithProviders(
      <MaterialPicker value={tube['materialName'] as string} density={tube['density'] as number} onChange={vi.fn()} />,
    );
    const select = materialSelect();
    await waitFor(() => expect(select.options.length).toBeGreaterThan(3));
    // The list does hold a Balsa, at a density the kernel does not fly.
    const listed = [...select.querySelectorAll('optgroup:not([label="From this part"]) option')].find((o) =>
      o.textContent?.startsWith('Balsa ·'),
    );
    expect(listed).toBeTruthy();
    // Shown in g/cm³, the default density unit.
    const shown = (o: Element) => Number(/· ([\d.]+) g\/cm³/.exec(o.textContent ?? '')?.[1]);
    expect(shown(listed!)).not.toBeCloseTo(fields.density / 1000, 6);
    expect(select.value).toBe('Balsa');
    expect(shown(select.selectedOptions[0]!)).toBeCloseTo(fields.density / 1000, 6);
    expect(select.selectedOptions[0]!.parentElement!.getAttribute('label')).toBe('From this part');
  });
});
