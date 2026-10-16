// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { DefaultMaterials } from '../../../src/components/layout/DefaultMaterials';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { serveData } from '../../testing/serveData';
import { readData } from '../../testing/dataDir';
import type { MaterialRow } from '../../../src/services/materials/materialTypes';

beforeAll(serveData);

const CATALOG = readData<MaterialRow[]>('materials.generated.json');

/** A default material keeps its catalog group, as one picked in the property panel does. */
describe('Settings default materials', () => {
  it("stores the chosen material's catalog group", async () => {
    const aluminum = CATALOG.find((m) => m.name === 'Aluminum' && m.type === 'bulk')!;
    const onChange = vi.fn();
    renderWithProviders(<DefaultMaterials defaults={{}} onChange={onChange} />);
    const picker = screen.getByLabelText('Body tube') as HTMLSelectElement;
    await waitFor(() => expect(picker.querySelector('option[value="Aluminum"]')).not.toBeNull());
    fireEvent.change(picker, { target: { value: 'Aluminum' } });
    expect(onChange.mock.calls.at(-1)![0]).toEqual({
      'bodytube:bulk': { name: 'Aluminum', density: aluminum.density, group: aluminum.group },
    });
  });
});
