// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { PlacementSection } from '../../../src/components/design/PlacementSection';
import { FieldRow } from '../../../src/components/design/DimensionFields';
import { FIELDS } from '../../../src/services/design/componentFields';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { useWorkspaceStore } from '../../../src/state/store';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';

const RING = {
  id: 'r',
  type: 'centeringring',
  length: 0.01,
  position: { method: 'top', offset: 0.02 },
} as unknown as ComponentNode;

const TREE = {
  components: [
    {
      id: 's',
      type: 'stage',
      children: [
        { id: 'n', type: 'nosecone', length: 0.1 },
        { id: 't', type: 'bodytube', length: 0.3, children: [RING] },
      ],
    },
  ],
} as unknown as RocketTree;

/**
 * Changing "Position from" keeps the part where it is, as the kernel's
 * setAxialMethod does. Keeping the number would move a ring at top 20 mm to
 * 20 mm past the end of its tube when switched to bottom.
 */
describe('PlacementSection, position from', () => {
  const before = useWorkspaceStore.getState().tree;
  afterEach(() => act(() => useWorkspaceStore.setState({ tree: before })));

  it('re-measures the offset under the new reference', () => {
    act(() => useWorkspaceStore.setState({ tree: TREE }));
    const onChange = vi.fn();
    renderWithProviders(<PlacementSection node={RING} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Position from'), { target: { value: 'bottom' } });
    const pos = onChange.mock.calls[0]![0].position;
    expect(pos.method).toBe('bottom');
    expect(pos.offset).toBeCloseTo(-0.27, 12);
  });
});

const FIN = {
  id: 'f',
  type: 'trapezoidfinset',
  rootChord: 0.06,
  tabLength: 0.02,
  tabHeight: 0.01,
  tabOffset: 0,
} as unknown as ComponentNode;
const field = (key: string) => FIELDS.trapezoidfinset!.find((f) => f.key === key)!;

describe('fin tab reference and offset', () => {
  it('shows an unset reference as the middle, which is what flies', () => {
    renderWithProviders(<FieldRow node={FIN} field={field('tabOffsetMethod')} onChange={() => {}} />);
    expect((screen.getByLabelText('Fin tab reference') as HTMLSelectElement).value).toBe('middle');
  });

  it('keeps the tab in place when the reference changes', () => {
    const onChange = vi.fn();
    renderWithProviders(<FieldRow node={FIN} field={field('tabOffsetMethod')} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Fin tab reference'), { target: { value: 'top' } });
    const patch = onChange.mock.calls[0]![0] as { tabOffsetMethod: string; tabOffset: number };
    expect(patch.tabOffsetMethod).toBe('top');
    expect(patch.tabOffset).toBeCloseTo(0.02, 12);
  });

  /** The kernel takes any tab offset; from the middle, a tab ahead of center is negative. */
  it('accepts a negative offset', () => {
    const onChange = vi.fn();
    renderWithProviders(<FieldRow node={FIN} field={field('tabOffset')} onChange={onChange} />);
    const input = screen.getByLabelText('Fin tab offset') as HTMLInputElement;
    // Centimeters, the field's metric unit: 1 cm ahead of the root's middle.
    fireEvent.change(input, { target: { value: '-1' } });
    fireEvent.blur(input);
    const last = onChange.mock.calls.at(-1)![0] as { tabOffset: number };
    expect(last.tabOffset).toBeCloseTo(-0.01, 9);
  });
});
