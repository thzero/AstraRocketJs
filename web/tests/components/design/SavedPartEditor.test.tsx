// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';
import type { CustomPart } from '../../../src/services/parts/presetStore';
import { renderWithProviders } from '../../testing/renderWithProviders';

/**
 * Applying a saved part spreads its whole stored node onto the part it fills,
 * shoulders and overrides included, so the My Parts editor has to show and
 * edit them like every other field the part carries.
 */

const update = vi.fn((_id: string, _meta: unknown, node: Partial<ComponentNode>) => Promise.resolve(node));
vi.mock('../../../src/services/parts/customParts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/services/parts/customParts')>()),
  updateCustomPart: (id: string, meta: unknown, node: Partial<ComponentNode>) => update(id, meta, node),
}));

const { SavedPartEditor } = await import('../../../src/components/design/SavedPartEditor');

const part: CustomPart = {
  id: 'p1',
  type: 'nosecone',
  mfr: 'Custom',
  partNo: 'NC-1',
  desc: '',
  node: {
    length: 0.2,
    aftRadius: 0.025,
    thickness: 0.002,
    shape: 'ogive',
    shoulderLength: 0.03,
    shoulderRadius: 0.024,
    shoulderThickness: 0.002,
    overrideMass: 0.05,
  },
} as unknown as CustomPart;

describe('SavedPartEditor', () => {
  it('shows a saved nose cone shoulder and mass override, and saves edits to both', async () => {
    renderWithProviders(<SavedPartEditor part={part} onDirtyChange={() => {}} onDelete={() => {}} onBack={() => {}} />);

    expect(screen.getByText('Shoulder')).toBeTruthy();
    const shoulderLength = screen.getByRole('spinbutton', { name: 'Shoulder length' }) as HTMLInputElement;
    expect(Number(shoulderLength.value)).toBeGreaterThan(0);

    expect(screen.getByText('Overrides')).toBeTruthy();
    const mass = screen.getByRole('spinbutton', { name: 'Mass' }) as HTMLInputElement;
    expect(mass.disabled).toBe(false);
    expect(Number(mass.value)).toBeGreaterThan(0);

    // Edited in each box's own unit; the saved node holds SI either way, so
    // the assertion is on the change rather than on a unit's numbers.
    fireEvent.focus(shoulderLength);
    fireEvent.change(shoulderLength, { target: { value: String(Number(shoulderLength.value) * 2) } });
    fireEvent.blur(shoulderLength);
    fireEvent.focus(mass);
    fireEvent.change(mass, { target: { value: String(Number(mass.value) * 3) } });
    fireEvent.blur(mass);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const saved = update.mock.calls[0]![2];
    expect(saved['shoulderLength']).toBeCloseTo(0.06, 9);
    expect(saved['overrideMass']).toBeCloseTo(0.15, 9);
  });
});
