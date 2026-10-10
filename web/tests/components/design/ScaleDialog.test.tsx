// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { ScaleDialog } from '../../../src/components/design/ScaleDialog';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { useWorkspaceStore } from '../../../src/state/store';
import type { RocketTree } from '../../../src/engine/openRocketEngine';

const design = (child: object) =>
  ({
    name: 'T',
    components: [
      {
        id: 's',
        type: 'stage',
        children: [{ id: 'b', type: 'bodytube', length: 0.3, outerRadius: 0.02, children: [child] }],
      },
    ],
  }) as unknown as RocketTree;

const open = (child: object, selectedId: string) => {
  useWorkspaceStore.setState({ tree: design(child), selectedId });
  renderWithProviders(<ScaleDialog onClose={() => {}} />);
};

const initial = useWorkspaceStore.getState();
afterEach(() => {
  useWorkspaceStore.setState(initial, true);
  vi.restoreAllMocks();
});

describe('ScaleDialog from/to', () => {
  it('starts From at a fin set root chord, as desktop reads FinSet.getLength()', () => {
    open({ id: 'f', type: 'trapezoidfinset', rootChord: 0.08 }, 'f');
    // Default length unit is cm.
    expect((screen.getByLabelText('Scale from') as HTMLInputElement).value).toBe('8');
    expect((screen.getByLabelText('Scale to') as HTMLInputElement).disabled).toBe(false);
  });

  it('disables To while From has no size to divide by', () => {
    open({ id: 'p', type: 'podset', radiusOffset: 0 }, 'p');
    expect((screen.getByLabelText('Scale to') as HTMLInputElement).disabled).toBe(true);
  });
});

describe('ScaleDialog factor bounds', () => {
  it('caps the factor at desktop SCALE_MAX, so a mistyped exponent cannot scale masses to Infinity', () => {
    const scaleDesign = vi.fn();
    useWorkspaceStore.setState({ scaleDesign });
    open({ id: 'f', type: 'trapezoidfinset', rootChord: 0.08 }, 'f');
    const box = screen.getByLabelText('Scale by');
    fireEvent.change(box, { target: { value: '1e300' } });
    fireEvent.click(screen.getByRole('button', { name: /^Scale to \d/ }));
    expect(scaleDesign).toHaveBeenCalledTimes(1);
    expect(scaleDesign.mock.calls[0]![0]).toBe(100);
  });
});
