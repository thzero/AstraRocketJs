// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { ResultPicker } from '../../../src/components/sim/ResultPicker';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { useWorkspaceStore } from '../../../src/state/store';

/** The flight picker follows the ARIA menu keyboard model its role promises. */
describe('ResultPicker menu keys', () => {
  it('opens onto the first flight and walks the rest with the arrows', () => {
    const base = useWorkspaceStore.getState().sims[0]!;
    useWorkspaceStore.setState({
      sims: [
        { ...base, id: 'a', name: 'Alpha', result: {} as never },
        { ...base, id: 'b', name: 'Bravo', result: {} as never },
      ],
      lastRunIds: ['a', 'b'],
    });
    renderWithProviders(<ResultPicker fallbackName="Results" />);
    fireEvent.click(screen.getByRole('button'));
    const items = screen.getAllByRole('menuitemradio');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
  });
});
