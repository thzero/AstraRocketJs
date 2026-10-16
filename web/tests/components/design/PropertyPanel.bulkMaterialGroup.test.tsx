// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { PropertyPanel } from '../../../src/components/design/PropertyPanel';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { serveData } from '../../testing/serveData';
import { readData } from '../../testing/dataDir';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';
import type { MaterialRow } from '../../../src/services/materials/materialTypes';

beforeAll(serveData);

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
